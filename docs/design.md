# Design

## Problem

Browsing cloud storage today means each provider's own console (slow,
account-wide login) or a CLI, a different one per provider. Want a
lightweight Chrome side panel: pick a saved connection, land straight in a
bucket like a file explorer, do basic file ops, without leaving the browser
tab — regardless of which provider the bucket lives on.

## Goals

- Chrome side panel, always one click away.
- Multiple named, bucket-scoped connections (type + bucket + key pair +
  starting prefix), switchable. Adding one only strictly requires a type,
  bucket/container name and key pair — region (where applicable) is
  auto-detected, name defaults to the bucket name.
- Four connection types: Amazon S3, S3-compatible (custom endpoint), Azure
  Blob Storage (connection string), Google Cloud Storage (service account
  JSON key) — no interactive OAuth/browser sign-in for any of them.
- Keys stored locally only; exportable/importable as JSON.
- Browse folders → files under that bucket (prefix/delimiter navigation).
- File ops: download, copy, cut/move, paste, delete, multi-select bulk
  versions of each. Folder ops: create, recursive copy, recursive delete.
- Preview common file types inline (image/video/audio/PDF/text/Markdown);
  edit text/Markdown in place and save back.
- Share a file via a provider URI (s3://, az://), unsigned HTTP link, or a
  signed link.

## Non-goals (v0)

- Bucket creation/policy/ACL management.
- Multi-part upload for very large files.
- Sync/watch, in-browser video/audio transcoding.
- Cross-connection copy/move (clipboard paste is scoped to the connection
  items were copied from — cross-bucket copy would need credentials valid
  for both buckets).

## Options considered

**Cloud SDK bundles vs. hand-rolled REST calls.** SDKs need a build step
(webpack/esbuild) and ship hundreds of KB each, worse with four providers.
Chosen: hand-rolled request signing over `fetch`, using `SubtleCrypto` for
HMAC-SHA256 — SigV4 for S3/S3-compatible/GCS, Shared Key for Azure. No
bundler, no `node_modules` shipped in the extension — load unpacked or zip
straight from source. Trade-off: only the REST operations we implement are
supported, and only the auth schemes that don't need OAuth (see below).

**No interactive OAuth.** Azure AD's and Google's interactive sign-in are
both a browser consent flow — wrong fit for a side panel with no server to
hold a refresh token. Skipped in favor of each provider's non-interactive
credential: Azure's storage-account connection string (Shared Key auth) and
a GCS service-account JSON key (JWT Bearer Token flow — see below) — the
credential each provider hands out for server-to-server use, and what their
own SDKs accept. Trade-off: the user generates that credential themselves
once, outside the extension (Azure portal → Access keys; GCP console →
IAM & Admin → Service Accounts → Keys).

**GCS: service-account JWT, not HMAC interop keys.** GCS's XML API also
accepts HMAC keys signed AWS-SigV4-style, which would have let GCS reuse
`S3Client` outright. Not chosen — a service-account JSON key is the
credential GCP's own docs steer new projects toward, and it's what GCP's
client libraries take. The extension performs the same non-interactive
server-to-server OAuth2 flow those libraries do under the hood: sign a JWT
with the service account's RSA private key, exchange it for a short-lived
access token
(`lib/gcs-sig.js`) — no browser, no user consent screen, just the JSON key.

**Where credentials live.** `chrome.storage.local` (not `sync`) so keys never
leave the machine via Chrome sync. Export/import is an explicit user action,
plaintext JSON — acceptable for a personal tool, called out in the UI.

**Side panel vs. popup.** Popups close on focus loss, killing in-progress
transfers and forcing re-navigation. `chrome.sidePanel` persists alongside
the tab.

## Architecture

```
extension/
  manifest.json        MV3, side_panel + background service worker
  background.js         opens the side panel on the toolbar icon click
  sidepanel.html/.css/.js   the whole UI (vanilla JS, no framework)
  lib/client.js           picks S3Client/AzureClient/GcsClient for a connection's type
  lib/sigv4.js            AWS SigV4 request signing (SubtleCrypto) + presigning
  lib/s3-client.js         S3-dialect REST ops (S3, S3-compatible), XML parsing
  lib/azure-sig.js         Azure Shared Key signing + Service SAS presigning
  lib/azure-client.js      Azure Blob REST ops, XML parsing, connection-string parsing
  lib/gcs-sig.js           GCS service-account JWT auth + GOOG4-RSA-SHA256 presigning
  lib/gcs-client.js        GCS JSON Storage API ops
  lib/store.js            connections CRUD + export/import (chrome.storage.local)
  lib/format.js            byte-size formatting
  lib/icons.js             inline-SVG icon set + icon-by-extension lookup
  lib/preview.js           file name -> preview kind + save content-type
  lib/markdown.js          dependency-free Markdown -> HTML renderer
```

No background/content-script relay for API calls — the side panel is a full
document with `host_permissions`, so it calls the provider directly via
`fetch`. `S3Client`, `AzureClient` and `GcsClient` expose the same method
surface (`listObjects`, `getObjectBlob`, `copyObject`, `presignedUrl`, …) so
`sidepanel.js` never branches on connection type — `lib/client.js#createClient()`
is the only place that does.

## Data model

A connection is bucket-scoped — one connection browses one bucket/container
(starting at an optional prefix), not a whole account's bucket list. Simpler
mental model, and it's what the required fields (bucket, credential, prefix)
are for. S3/S3-compatible/Azure store into a common `accessKeyId`/
`secretAccessKey` shape (parsed down to that from a single connection string
for Azure — see below); GCS's service account JSON doesn't fit that shape,
so it gets its own field.

```js
// one entry in chrome.storage.local["connections"]
{
  id,
  type,              // "s3" | "s3-compat" | "azure" | "gcs"
  bucket,            // required (container name, for azure)
  accessKeyId, secretAccessKey,  // s3/s3-compat: key pair; azure: account name/key
  serviceAccountJson,             // gcs only: the raw pasted JSON key, as a string
  prefix,            // optional, starting folder, default ""
  name,              // optional, defaults to bucket at save time
  region,            // s3/s3-compat only, auto-detected for s3
  endpoint,          // s3-compat only: user-set custom host
  pathStyle,         // bool, s3/s3-compat only
}
```

**Region auto-detection** (S3 only). Bucket names don't encode a region, but
S3's legacy global endpoint (`https://{bucket}.s3.amazonaws.com/`) reports
the real region in an `x-amz-bucket-region` response header even on an
unauthenticated request — including on the 403 you get without credentials.
`detectBucketRegion()` uses that instead of asking the user, firing on blur
of the bucket field and again at save time if still empty. Falls back to
`us-east-1` if detection fails. S3-compatible connections skip this — region
is a manual field there. Azure and GCS have no region concept in this model.

**Azure Blob Storage**: the connection form takes one field, the storage
account's connection string (`DefaultEndpointsProtocol=...;AccountName=...;
AccountKey=...;...`) — `parseConnectionString()` in `lib/azure-client.js`
splits it into the account name/key stored as `accessKeyId`/`secretAccessKey`.
Auth from there is Shared Key: HMAC-SHA256 over Azure's canonicalized-
headers/-resource string (`lib/azure-sig.js`), and the Blob REST API
(`lib/azure-client.js`) — containers instead of buckets, blobs instead of
keys, but the same flat, prefix/delimiter browsing model. Host is derived
from the account name (`{account}.blob.core.windows.net`).

**Google Cloud Storage**: the connection form takes a pasted service account
JSON key, stored as-is in `serviceAccountJson`. `lib/gcs-sig.js` implements
the JWT Bearer Token flow: sign a JWT with the key's RSA private key
(`RSASSA-PKCS1-v1_5`/SHA-256 via SubtleCrypto), exchange it at Google's token
endpoint for a short-lived OAuth2 access token, cache it until near expiry.
`lib/gcs-client.js` uses that token (`Authorization: Bearer …`) against the
JSON Storage API (`storage.googleapis.com/storage/v1/...`), not the XML API —
JSON responses instead of the XML the other three clients parse.

## Endpoints & permissions

`host_permissions` is pre-granted for the known providers: `*.amazonaws.com`,
`*.r2.cloudflarestorage.com`, `storage.googleapis.com`,
`oauth2.googleapis.com` (GCS token exchange), `*.blob.core.windows.net`. A
custom S3-compatible endpoint (MinIO, self-hosted) is the one case requested
at runtime via `chrome.permissions.request` when the connection is saved —
keeps the install-time permission prompt narrow.

## Key flows

- **Browse**: pick a connection → straight into its bucket at `prefix` via
  a delimited listing (`ListObjectsV2` for S3-dialect, `List Blobs` for
  Azure, `objects.list` for GCS); breadcrumb tracks the prefix stack and can
  always jump back to the connection's starting prefix or the bucket root.
- **Download**: get-object → blob → `chrome.downloads.download` on an
  object URL.
- **Copy/Cut/Paste**: Copy or Cut marks item(s) on an in-memory clipboard
  (shown as a status pill); Paste into the current folder issues
  server-side copies (`x-amz-copy-source` for S3-dialect, `x-ms-copy-source`
  + status polling for Azure, `objects.copy` for GCS — folders: walk + copy
  every key under the prefix), then deletes the sources if it was a cut. No
  OS clipboard involved — state lives in the side panel only, cleared on
  cut-and-paste or explicitly.
- **Preview/edit**: image/video/audio/PDF get a presigned/SAS/signed URL as
  the `src`/`href` directly, so the browser streams and range-seeks against
  the provider itself — nothing is buffered through the extension.
  Text/Markdown is fetched as a blob, shown in an editable textarea, and
  written back with put-object on Save; files over 2MB skip this and point
  at Download.
- **Share**: a provider URI (`s3://`, `az://`, `gs://`, string only),
  unsigned HTTP URL (works only if the object/bucket is public), or a signed
  URL (`presignUrl()`/`signedUrlV4()` in `sigv4.js`/`azure-sig.js`/
  `gcs-sig.js`, query-string signing) with a chosen expiry.
- **Delete folder**: list every key under the prefix (paginated,
  non-delimited), delete one by one, no batch-delete API call (keeps the
  signer simple — no request body to sign).
