// Picks the right backend client for a connection's type. "s3", "s3-compat"
// and "gcs" all speak the S3 REST dialect (Google Cloud Storage's XML API
// accepts AWS SigV4 with HMAC keys, region "auto" — see saveConnectionFromForm
// in sidepanel.js for how a "gcs" connection is shaped); "azure" is genuinely
// different (Shared Key auth, Blob REST API).
import { S3Client } from "./s3-client.js";
import { AzureClient } from "./azure-client.js";

export function createClient(conn) {
  return conn.type === "azure" ? new AzureClient(conn) : new S3Client(conn);
}
