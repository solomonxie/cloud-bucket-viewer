import { signRequest } from "./sigv4.js";

function text(el, tag) {
  return el.getElementsByTagName(tag)[0]?.textContent ?? "";
}

// Bucket region isn't derivable from its name, but S3's legacy global
// endpoint reports it in a response header even on an unauthenticated,
// unsigned request — so we can look it up before the user supplies a region.
export async function detectBucketRegion(bucket) {
  try {
    const resp = await fetch(`https://${bucket}.s3.amazonaws.com/`, { method: "HEAD" });
    return resp.headers.get("x-amz-bucket-region") || null;
  } catch {
    return null;
  }
}

function parseListObjects(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const prefixes = [...doc.getElementsByTagName("CommonPrefixes")].map((p) =>
    text(p, "Prefix")
  );
  const objects = [...doc.getElementsByTagName("Contents")].map((c) => ({
    key: text(c, "Key"),
    size: Number(text(c, "Size") || 0),
    lastModified: text(c, "LastModified"),
  }));
  return {
    prefixes,
    objects,
    isTruncated: text(doc, "IsTruncated") === "true",
    nextToken: text(doc, "NextContinuationToken") || null,
  };
}

export class S3Client {
  constructor(conn) {
    this.conn = conn;
  }

  usesPathStyle() {
    return this.conn.pathStyle || !!this.conn.endpoint;
  }

  host() {
    if (this.conn.endpoint) return this.conn.endpoint;
    const region = this.conn.region || "us-east-1";
    return `s3.${region}.amazonaws.com`;
  }

  urlFor(bucket, key = "", query = {}) {
    const host = this.usesPathStyle()
      ? this.host()
      : bucket
      ? `${bucket}.${this.host()}`
      : this.host();
    const path = this.usesPathStyle()
      ? bucket
        ? `/${bucket}/${key}`
        : "/"
      : `/${key}`;
    const url = new URL(`https://${host}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    return url;
  }

  async request(method, bucket, key, { query = {}, headers = {}, body, payloadHash } = {}) {
    const url = this.urlFor(bucket, key, query);
    const signed = await signRequest({
      method,
      url: url.toString(),
      region: this.conn.region || "us-east-1",
      accessKeyId: this.conn.accessKeyId,
      secretAccessKey: this.conn.secretAccessKey,
      headers,
      payloadHash,
    });
    const resp = await fetch(url.toString(), { method, headers: signed, body });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      // S3 error bodies are small XML docs: <Error><Code>..</Code><Message>..</Message></Error>.
      // Surface that instead of dumping the raw XML when present.
      const code = body.match(/<Code>([^<]*)<\/Code>/)?.[1];
      const message = body.match(/<Message>([^<]*)<\/Message>/)?.[1];
      throw new Error(
        code && message ? `${code}: ${message}` : `S3 ${method} ${resp.status} ${resp.statusText}`
      );
    }
    return resp;
  }

  async listObjects(bucket, prefix, continuationToken) {
    const query = { "list-type": "2", delimiter: "/", prefix };
    if (continuationToken) query["continuation-token"] = continuationToken;
    const resp = await this.request("GET", bucket, "", { query });
    return parseListObjects(await resp.text());
  }

  // Non-delimited listing, used to walk every key under a prefix (for recursive delete).
  async *listAllKeys(bucket, prefix) {
    let token;
    do {
      const query = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;
      const resp = await this.request("GET", bucket, "", { query });
      const { objects, isTruncated, nextToken } = parseListObjects(await resp.text());
      for (const obj of objects) yield obj.key;
      token = isTruncated ? nextToken : null;
    } while (token);
  }

  async getObjectBlob(bucket, key) {
    const resp = await this.request("GET", bucket, key);
    return resp.blob();
  }

  async deleteObject(bucket, key) {
    await this.request("DELETE", bucket, key);
  }

  async deletePrefix(bucket, prefix, onProgress) {
    let count = 0;
    for await (const key of this.listAllKeys(bucket, prefix)) {
      await this.deleteObject(bucket, key);
      count += 1;
      onProgress?.(count);
    }
    return count;
  }

  async copyObject(bucket, key, sourceBucket, sourceKey) {
    const copySource = `/${sourceBucket}/${sourceKey}`
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    await this.request("PUT", bucket, key, {
      headers: { "x-amz-copy-source": copySource },
    });
  }

  async moveObject(bucket, key, sourceBucket, sourceKey) {
    await this.copyObject(bucket, key, sourceBucket, sourceKey);
    await this.deleteObject(sourceBucket, sourceKey);
  }

  async putObject(bucket, key, body, contentType) {
    const headers = {};
    if (contentType) headers["content-type"] = contentType;
    await this.request("PUT", bucket, key, {
      headers,
      body,
      payloadHash: "UNSIGNED-PAYLOAD",
    });
  }

  async createFolder(bucket, prefix) {
    const key = prefix.endsWith("/") ? prefix : `${prefix}/`;
    await this.putObject(bucket, key, new Uint8Array(0));
  }
}

export function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
