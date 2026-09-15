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
  Blob Storage, Google Cloud Storage — each authenticates with a static key
  pair, no OAuth/interactive sign-in.
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

**Key-pair auth only, no OAuth.** Azure AD and Google's native GCS auth are
both OAuth2 — a browser consent flow, token refresh, and (for GCS) usually a
service-account JSON. Skipped in favor of each provider's static-key escape
hatch: Azure Shared Key (storage account name + account key) and GCS's HMAC
key pair (S3-interoperable, Settings → Interoperability in the console).
Same mental model as an S3 access key, no sign-in flow inside the extension.
Trade-off: the user has to generate that key pair themselves once, outside
the extension.

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
  lib/client.js           picks S3Client or AzureClient for a connection's type
  lib/sigv4.js            AWS SigV4 request signing (SubtleCrypto) + presigning
  lib/s3-client.js         S3-dialect REST ops (S3, S3-compatible, GCS), XML parsing
  lib/azure-sig.js         Azure Shared Key signing + Service SAS presigning
  lib/azure-client.js      Azure Blob REST ops, XML parsing
  lib/store.js            connections CRUD + export/import (chrome.storage.local)
  lib/format.js            byte-size formatting
  lib/icons.js             inline-SVG icon set + icon-by-extension lookup
  lib/preview.js           file name -> preview kind + save content-type
  lib/markdown.js          dependency-free Markdown -> HTML renderer
```

No background/content-script relay for API calls — the side panel is a full
document with `host_permissions`, so it calls the provider directly via
`fetch`. `S3Client` and `AzureClient` expose the same method surface
(`listObjects`, `getObjectBlob`, `copyObject`, `presignedUrl`, …) so
`sidepanel.js` never branches on connection type — `lib/client.js#createClient()`
is the only place that does.

## Data model

A connection is bucket-scoped — one connection browses one bucket/container
(starting at an optional prefix), not a whole account's bucket list. Simpler
mental model, and it's what the required fields (bucket, key pair, prefix)
are for. Every type stores into the same field names so the rest of the app
(store.js, export/import, the manage list) stays type-agnostic; `accessKeyId`
holds an Azure storage account name for `azure` connections, an HMAC key ID
for `gcs`.

```js
// one entry in chrome.storage.local["connections"]
{
  id,
  type,              // "s3" | "s3-compat" | "azure" | "gcs"
  bucket,            // required (container name, for azure)
  accessKeyId, secretAccessKey,  // required key pair
  prefix,            // optional, starting folder, default ""
  name,              // optional, defaults to bucket at save time
  region,            // s3/s3-compat only; "auto" for gcs, unused for azure
  endpoint,          // custom host: user-set for s3-compat, fixed for gcs
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
is a manual field there. GCS uses the fixed pseudo-region `"auto"`
(see below); Azure has no region concept in this model.

**Google Cloud Storage** reuses `S3Client` outright: its XML API accepts AWS
SigV4 requests signed with an HMAC key pair, at a fixed endpoint
(`storage.googleapis.com`, path-style) and the pseudo-region `"auto"` — same
wire protocol as S3-compatible, just preset instead of user-entered.

**Azure Blob Storage** is genuinely different: Shared Key auth (HMAC-SHA256
over a different canonical string, `lib/azure-sig.js`) and the Blob REST API
(`lib/azure-client.js`) — containers instead of buckets, blobs instead of
keys, but the same flat, prefix/delimiter browsing model. Host is derived
from the account name (`{account}.blob.core.windows.net`), no custom
endpoint field.

## Endpoints & permissions

`host_permissions` is pre-granted for the known providers: `*.amazonaws.com`,
`*.r2.cloudflarestorage.com`, `storage.googleapis.com`,
`*.blob.core.windows.net`. A custom S3-compatible endpoint (MinIO,
self-hosted) is the one case requested at runtime via
`chrome.permissions.request` when the connection is saved — keeps the
install-time permission prompt narrow.

## Key flows

- **Browse**: pick a connection → straight into its bucket at `prefix` via
  a delimited listing (`ListObjectsV2` for S3-dialect, `List Blobs` for
  Azure); breadcrumb tracks the prefix stack and can always jump back to the
  connection's starting prefix or the bucket root.
- **Download**: get-object → blob → `chrome.downloads.download` on an
  object URL.
- **Copy/Cut/Paste**: Copy or Cut marks item(s) on an in-memory clipboard
  (shown as a status pill); Paste into the current folder issues
  server-side copies (`x-amz-copy-source` for S3-dialect, `x-ms-copy-source`
  + status polling for Azure — folders: walk + copy every key under the
  prefix), then deletes the sources if it was a cut. No OS clipboard
  involved — state lives in the side panel only, cleared on cut-and-paste or
  explicitly.
- **Preview/edit**: image/video/audio/PDF get a presigned/SAS URL as the
  `src`/`href` directly, so the browser streams and range-seeks against the
  provider itself — nothing is buffered through the extension. Text/Markdown
  is fetched as a blob, shown in an editable textarea, and written back with
  put-object on Save; files over 2MB skip this and point at Download.
- **Share**: a provider URI (`s3://`, `az://`, string only), unsigned HTTP
  URL (works only if the object/bucket is public), or a signed URL
  (`presignUrl()` in `sigv4.js` or `azure-sig.js`, query-string signing)
  with a chosen expiry.
- **Delete folder**: list every key under the prefix (paginated,
  non-delimited), delete one by one, no batch-delete API call (keeps the
  signer simple — no request body to sign).
