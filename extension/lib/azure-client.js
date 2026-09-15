import { signRequest, presignUrl } from "./azure-sig.js";

// "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
// — the connection-string shape Azure's own portal and SDKs hand out, so
// the connection form asks for this one string instead of two fields.
export function parseConnectionString(str) {
  const parts = {};
  for (const segment of str.split(";")) {
    const idx = segment.indexOf("=");
    if (idx < 0) continue;
    parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
  }
  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error("Invalid connection string: expected AccountName and AccountKey");
  }
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

const PAGE_SIZE = 100;

function text(el, tag) {
  return el.getElementsByTagName(tag)[0]?.textContent ?? "";
}

function bodyLength(body) {
  if (!body) return 0;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  return 0;
}

function parseListBlobs(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const prefixes = [...doc.getElementsByTagName("BlobPrefix")].map((p) => text(p, "Name"));
  const objects = [...doc.getElementsByTagName("Blob")].map((b) => {
    const props = b.getElementsByTagName("Properties")[0];
    return {
      key: text(b, "Name"),
      size: Number((props && text(props, "Content-Length")) || 0),
      lastModified: props ? text(props, "Last-Modified") : "",
      storageClass: null,
    };
  });
  const nextMarker = text(doc, "NextMarker") || null;
  return { prefixes, objects, isTruncated: !!nextMarker, nextToken: nextMarker };
}

// Container-scoped client for Azure Blob Storage, mirroring S3Client's
// method surface so sidepanel.js can treat any connection type the same
// way. Auth is a storage account name + Shared Key (see docs/design.md) —
// no OAuth/AD sign-in, matching how S3 access keys work.
export class AzureClient {
  constructor(conn) {
    this.conn = conn; // accessKeyId = account name, secretAccessKey = account key
  }

  get scheme() {
    return "az";
  }

  host() {
    return `${this.conn.accessKeyId}.blob.core.windows.net`;
  }

  urlFor(container, blob = "", query = {}) {
    const path = container ? `/${container}/${blob}` : "/";
    const url = new URL(`https://${this.host()}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    return url;
  }

  async request(method, container, blob, { query = {}, headers = {}, body, contentLength } = {}) {
    const url = this.urlFor(container, blob, query);
    const signed = await signRequest({
      method,
      url: url.toString(),
      accountName: this.conn.accessKeyId,
      accountKey: this.conn.secretAccessKey,
      headers,
      contentLength,
    });
    const resp = await fetch(url.toString(), { method, headers: signed, body });
    if (!resp.ok) {
      const respBody = await resp.text().catch(() => "");
      // Azure error bodies are small XML docs, same Code/Message shape as S3's.
      const code = respBody.match(/<Code>([^<]*)<\/Code>/)?.[1];
      const message = respBody.match(/<Message>([^<]*)<\/Message>/)?.[1];
      throw new Error(
        code && message ? `${code}: ${message}` : `Azure ${method} ${resp.status} ${resp.statusText}`
      );
    }
    return resp;
  }

  async listObjects(bucket, prefix, marker) {
    const query = { restype: "container", comp: "list", delimiter: "/", prefix, maxresults: String(PAGE_SIZE) };
    if (marker) query.marker = marker;
    const resp = await this.request("GET", bucket, "", { query });
    return parseListBlobs(await resp.text());
  }

  async *listAllKeys(bucket, prefix) {
    let marker;
    do {
      const query = { restype: "container", comp: "list", prefix };
      if (marker) query.marker = marker;
      const resp = await this.request("GET", bucket, "", { query });
      const { objects, isTruncated, nextToken } = parseListBlobs(await resp.text());
      for (const obj of objects) yield obj.key;
      marker = isTruncated ? nextToken : null;
    } while (marker);
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

  // Server-side "Copy Blob" — same storage account only (the destination
  // request's Shared Key auth doesn't grant read access to a source in a
  // different account; that would need a source SAS, not implemented here,
  // matching this app's same-connection clipboard model). Copy is async:
  // poll the destination's x-ms-copy-status until it settles.
  async copyObject(bucket, key, sourceBucket, sourceKey) {
    const sourceUrl = this.urlFor(sourceBucket, sourceKey).toString();
    await this.request("PUT", bucket, key, { headers: { "x-ms-copy-source": sourceUrl } });
    await this.waitForCopy(bucket, key);
  }

  async waitForCopy(bucket, key, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await this.request("HEAD", bucket, key);
      const status = resp.headers.get("x-ms-copy-status");
      if (!status || status === "success") return;
      if (status === "failed" || status === "aborted") throw new Error(`Copy ${status}`);
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("Copy timed out");
  }

  async moveObject(bucket, key, sourceBucket, sourceKey) {
    await this.copyObject(bucket, key, sourceBucket, sourceKey);
    await this.deleteObject(sourceBucket, sourceKey);
  }

  async copyPrefix(bucket, destPrefix, sourceBucket, sourcePrefix, onProgress) {
    let count = 0;
    for await (const key of this.listAllKeys(sourceBucket, sourcePrefix)) {
      const destKey = destPrefix + key.slice(sourcePrefix.length);
      await this.copyObject(bucket, destKey, sourceBucket, key);
      count += 1;
      onProgress?.(count);
    }
    return count;
  }

  async putObject(bucket, key, body, contentType) {
    const headers = { "x-ms-blob-type": "BlockBlob" };
    if (contentType) headers["content-type"] = contentType;
    await this.request("PUT", bucket, key, { headers, body, contentLength: bodyLength(body) });
  }

  async createFolder(bucket, prefix) {
    const key = prefix.endsWith("/") ? prefix : `${prefix}/`;
    await this.putObject(bucket, key, new Uint8Array(0));
  }

  // Share links: an az:// URI, an unsigned HTTP URL (only useful on a public
  // container/blob), and a time-limited SAS-signed URL.
  resourceUri(bucket, key) {
    return `az://${this.conn.accessKeyId}/${bucket}/${key}`;
  }

  unsignedUrl(bucket, key) {
    return this.urlFor(bucket, key).toString();
  }

  async presignedUrl(bucket, key, expiresIn = 3600) {
    return presignUrl({
      url: this.urlFor(bucket, key).toString(),
      accountName: this.conn.accessKeyId,
      accountKey: this.conn.secretAccessKey,
      container: bucket,
      blob: key,
      expiresIn,
    });
  }
}
