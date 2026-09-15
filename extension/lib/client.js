// Picks the right backend client for a connection's type. "s3" and
// "s3-compat" speak the S3 REST dialect; "azure" and "gcs" are genuinely
// different auth/APIs (Azure Shared Key + Blob REST; GCS service-account
// JWT + JSON Storage API) but expose the same method surface, so
// sidepanel.js never branches on type itself.
import { S3Client } from "./s3-client.js";
import { AzureClient } from "./azure-client.js";
import { GcsClient } from "./gcs-client.js";

export function createClient(conn) {
  if (conn.type === "azure") return new AzureClient(conn);
  if (conn.type === "gcs") return new GcsClient(conn);
  return new S3Client(conn);
}
