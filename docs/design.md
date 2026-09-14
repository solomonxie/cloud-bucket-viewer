# Design

## Problem

Browsing S3 today means the AWS console (slow, account-wide login) or a CLI.
Want a lightweight Chrome side panel: pick a saved connection, land straight
in a bucket like a file explorer, do basic file ops, without leaving the
browser tab.

## Goals

- Chrome side panel, always one click away.
- Multiple named, bucket-scoped connections (bucket + access key + secret
  key + starting prefix), switchable. Adding one only strictly requires
  those four — region is auto-detected from the bucket, name defaults to
  the bucket name.
- Keys stored locally only; exportable/importable as JSON.
- Browse folders → files under that bucket (prefix/delimiter navigation).
- File ops: download, copy, move, delete. Folder ops: create, recursive delete.
- Works against AWS S3 and S3-compatible services (R2, MinIO, etc).

## Non-goals (v0)

- Bucket creation/policy/ACL management.
- Multi-part upload for very large files.
- Sync/watch, drag-and-drop, thumbnails/previews.
- Cross-connection copy/move (same-connection only for now).

## Options considered

**AWS SDK bundle vs. hand-rolled REST calls.** The SDK needs a build step
(webpack/esbuild) and ships hundreds of KB. Chosen: hand-rolled SigV4 signing
over `fetch`, using `SubtleCrypto` for HMAC-SHA256. No bundler, no
`node_modules` shipped in the extension — load unpacked or zip straight from
source. Trade-off: only the S3 REST operations we implement are supported.

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
  lib/sigv4.js           AWS SigV4 request signing (SubtleCrypto)
  lib/s3-client.js       S3 REST operations (list/get/put/copy/delete), XML parsing
  lib/store.js           connections CRUD + export/import (chrome.storage.local)
```

No background/content-script relay for API calls — the side panel is a full
document with `host_permissions`, so it calls S3 directly via `fetch`.

## Data model

A connection is bucket-scoped — one connection browses one bucket (starting
at an optional prefix), not an AWS account's whole bucket list. Simpler
mental model, and it's what the four required fields (bucket, access key,
secret key, prefix) are for.

```js
// one entry in chrome.storage.local["connections"]
{
  id,
  bucket,            // required
  accessKeyId, secretAccessKey,  // required
  prefix,            // optional, starting folder, default ""
  name,              // optional, defaults to bucket at save time
  region,            // optional, auto-detected from bucket (see below)
  endpoint,          // optional custom host for S3-compatible services
  pathStyle,         // bool, force /bucket/key instead of bucket.host/key
}
```

**Region auto-detection.** Bucket names don't encode a region, but S3's
legacy global endpoint (`https://{bucket}.s3.amazonaws.com/`) reports the
real region in an `x-amz-bucket-region` response header even on an
unauthenticated request — including on the 403 you get without credentials.
`detectBucketRegion()` uses that instead of asking the user, firing on blur
of the bucket field and again at save time if still empty. Falls back to
`us-east-1` if detection fails (e.g. the bucket doesn't exist yet, or a
custom endpoint is set — region is a manual field there).

## Custom endpoints & permissions

`host_permissions` is pre-granted for `*.amazonaws.com` and
`*.r2.cloudflarestorage.com`. Any other endpoint (MinIO, self-hosted) is
requested at runtime via `chrome.permissions.request` when the connection is
saved — keeps the install-time permission prompt narrow.

## Key flows

- **Browse**: pick a connection → straight into its bucket at `prefix` via
  `ListObjectsV2` with `delimiter=/`; breadcrumb tracks the prefix stack and
  can always jump back to the connection's starting prefix or the bucket root.
- **Download**: `GetObject` → blob → `chrome.downloads.download` on an
  object URL.
- **Copy/Move**: `PUT` with `x-amz-copy-source`; move = copy + `DELETE`.
- **Delete folder**: list every key under the prefix (paginated,
  non-delimited), delete one by one, no batch-delete API call (keeps the
  signer simple — no request body to sign).
