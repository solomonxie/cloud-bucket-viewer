import { getAccessToken, signedUrlV4 } from "./gcs-sig.js";

const PAGE_SIZE = 100;
const API_BASE = "https://storage.googleapis.com/storage/v1";
const UPLOAD_BASE = "https://storage.googleapis.com/upload/storage/v1";

// Bucket-scoped client for Google Cloud Storage's JSON API, authenticated
// with a service account (see gcs-sig.js) — mirrors S3Client/AzureClient's
// method surface so sidepanel.js can treat any connection type the same way.
export class GcsClient {
  constructor(conn) {
    this.conn = conn;
    this.serviceAccount = JSON.parse(conn.serviceAccountJson);
  }

  get scheme() {
    return "gs";
  }

  async request(method, path, { query = {}, headers = {}, body, base = API_BASE } = {}) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const token = await getAccessToken(this.serviceAccount);
    const resp = await fetch(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let message;
      try {
        message = JSON.parse(text)?.error?.message;
      } catch {
        // not JSON — fall through to the generic message below
      }
      throw new Error(message || `GCS ${method} ${resp.status} ${resp.statusText}`);
    }
    return resp;
  }

  async listObjects(bucket, prefix, pageToken) {
    const query = { prefix, delimiter: "/", maxResults: String(PAGE_SIZE) };
    if (pageToken) query.pageToken = pageToken;
    const resp = await this.request("GET", `/b/${bucket}/o`, { query });
    const data = await resp.json();
    return {
      prefixes: data.prefixes || [],
      objects: (data.items || []).map((it) => ({
        key: it.name,
        size: Number(it.size || 0),
        lastModified: it.updated,
        storageClass: it.storageClass || null,
      })),
      isTruncated: !!data.nextPageToken,
      nextToken: data.nextPageToken || null,
    };
  }

  // Non-delimited listing, used to walk every key under a prefix.
  async *listAllKeys(bucket, prefix) {
    let token;
    do {
      const query = { prefix };
      if (token) query.pageToken = token;
      const resp = await this.request("GET", `/b/${bucket}/o`, { query });
      const data = await resp.json();
      for (const it of data.items || []) yield it.name;
      token = data.nextPageToken || null;
    } while (token);
  }

  async getObjectBlob(bucket, key) {
    const resp = await this.request("GET", `/b/${bucket}/o/${encodeURIComponent(key)}`, {
      query: { alt: "media" },
    });
    return resp.blob();
  }

  async deleteObject(bucket, key) {
    await this.request("DELETE", `/b/${bucket}/o/${encodeURIComponent(key)}`);
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
    await this.request(
      "POST",
      `/b/${sourceBucket}/o/${encodeURIComponent(sourceKey)}/copyTo/b/${bucket}/o/${encodeURIComponent(key)}`
    );
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

  // Simple (non-resumable) media upload — fine for the file sizes this app
  // edits/uploads inline; large files would want the resumable upload flow.
  async putObject(bucket, key, body, contentType) {
    await this.request("POST", `/b/${bucket}/o`, {
      base: UPLOAD_BASE,
      query: { uploadType: "media", name: key },
      headers: { "content-type": contentType || "application/octet-stream" },
      body,
    });
  }

  async createFolder(bucket, prefix) {
    const key = prefix.endsWith("/") ? prefix : `${prefix}/`;
    await this.putObject(bucket, key, new Uint8Array(0));
  }

  // Share links: a gs:// URI, an unsigned HTTP URL (only useful on a public
  // bucket/object), and a time-limited V4-signed URL.
  resourceUri(bucket, key) {
    return `gs://${bucket}/${key}`;
  }

  unsignedUrl(bucket, key) {
    return new URL(`https://storage.googleapis.com/${bucket}/${key}`).toString();
  }

  async presignedUrl(bucket, key, expiresIn = 3600) {
    return signedUrlV4({ serviceAccount: this.serviceAccount, bucket, object: key, expiresIn });
  }
}
