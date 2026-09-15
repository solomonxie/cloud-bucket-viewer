# Implementation notes

Companion to [design.md](design.md) — what's actually built and how to work
on it.

## Files

| File | Responsibility |
|---|---|
| `extension/manifest.json` | MV3 manifest: side panel, permissions, icons |
| `extension/background.js` | one line: opens side panel on action click |
| `extension/sidepanel.html` | markup: toolbar, breadcrumb, file list, two `<dialog>` modals |
| `extension/sidepanel.css` | all styling, no preprocessor |
| `extension/sidepanel.js` | app state + DOM rendering + event wiring |
| `extension/lib/client.js` | `createClient(conn)` — picks `S3Client` or `AzureClient` by `conn.type` |
| `extension/lib/sigv4.js` | `signRequest()` — AWS Signature V4; `presignUrl()` — query-string presigning |
| `extension/lib/s3-client.js` | `S3Client` class — S3-dialect REST calls (S3, S3-compatible, GCS) + XML parsing |
| `extension/lib/azure-sig.js` | `signRequest()` — Azure Shared Key; `presignUrl()` — Service SAS |
| `extension/lib/azure-client.js` | `AzureClient` class — Blob REST calls + XML parsing |
| `extension/lib/store.js` | connections CRUD, export/import, in `chrome.storage.local` |
| `extension/lib/format.js` | `formatSize()` |
| `extension/lib/icons.js` | inline-SVG icon set (`icon()`) + `iconForFileName()` by extension |
| `extension/lib/preview.js` | `previewKind()`, `isTooLargeForTextPreview()`, `mimeForName()` |
| `extension/lib/markdown.js` | `renderMarkdown()` — dependency-free Markdown → HTML |
| `scripts/gen_icons.py` | regenerates `extension/icons/*.png` (stdlib only, no Pillow) |

## SigV4 signer (`lib/sigv4.js`)

`signRequest({ method, url, region, accessKeyId, secretAccessKey, headers, payloadHash })`
returns the full header set including `Authorization`. Notes:

- Uses `crypto.subtle` for SHA-256 / HMAC — available in extension pages and
  service workers, no polyfill.
- `payloadHash` defaults to the well-known empty-body hash (GET/HEAD/DELETE).
  Uploads (`PutObject`) pass the literal string `"UNSIGNED-PAYLOAD"` instead
  of hashing the body — avoids reading large file blobs twice.
- Canonical query string sorts params; canonical URI percent-encodes each
  path segment per the AWS spec (`encodeRFC3986`, extra-encodes `! ' ( ) *`).
- `presignUrl({ method, url, region, accessKeyId, secretAccessKey, expiresIn })`
  signs into the query string (`X-Amz-Signature` etc.) instead of a header,
  so the returned URL works standalone (pasted into a browser, `<img src>`,
  `<video src>`). Payload hash is always `UNSIGNED-PAYLOAD` — presigned URLs
  are GETs, no body.

## Client dispatch (`lib/client.js`)

`createClient(conn)` returns `new AzureClient(conn)` for `conn.type === "azure"`,
`new S3Client(conn)` otherwise — `"s3"`, `"s3-compat"` and `"gcs"` all speak
the same S3-dialect wire protocol. Both classes expose the same method
surface (below), so `sidepanel.js` calls `state.client.listObjects(...)`
etc. without ever branching on type itself.

## S3 client (`lib/s3-client.js`)

Backs `"s3"`, `"s3-compat"` and `"gcs"` connections — GCS's XML API accepts
AWS SigV4 requests signed with an HMAC key pair, so it's just a preset
endpoint (`storage.googleapis.com`, path-style, region `"auto"`) rather than
a separate client. `new S3Client(connection)` then:

- `listObjects(bucket, prefix, token)` → one page (`PAGE_SIZE = 100`),
  `delimiter=/`; pass the previous page's `nextToken` to page forward.
- `listAllKeys(bucket, prefix)` → async generator, no delimiter, paginates
  via `NextContinuationToken`; used by `deletePrefix()` and `copyPrefix()`.
- `getObjectBlob`, `deleteObject`, `copyObject`, `moveObject` (copy+delete),
  `copyPrefix` (walks `listAllKeys` and copies each to the same relative
  path under a new prefix — recursive folder copy/paste), `putObject`,
  `createFolder` (zero-byte key ending in `/`).
- `resourceUri`, `unsignedUrl`, `presignedUrl` — the three link kinds the
  Share modal offers; `presignedUrl` delegates to `sigv4.js#presignUrl`.
  `scheme` (`"s3"`) labels the Share modal's URI row.

`detectBucketRegion(bucket)` is a standalone export (no credentials needed,
S3 type only): an unauthenticated `HEAD` to `https://{bucket}.s3.amazonaws.com/`
gets a `x-amz-bucket-region` response header even on the 403 you get without
auth. Used by the connection form to fill in region without asking the user.

`request()` turns a non-2xx response into an `Error` using the `<Code>`/
`<Message>` from the XML error body (e.g. `"AccessDenied: ..."`) when
present, instead of dumping the raw XML — that string is what ends up in the
status bar / form status via `withStatus()`/`setFormStatus()`.

Virtual-hosted vs. path-style URLs: `usesPathStyle()` is true when
`connection.pathStyle` is set or a custom `endpoint` is present (custom
S3-compatible/GCS hosts need path style); otherwise AWS virtual-hosted
`bucket.s3.region.amazonaws.com` is used.

XML responses are parsed with `DOMParser` (only available in document
contexts — this is why client calls happen from `sidepanel.js`, not
`background.js`).

## Azure client (`lib/azure-client.js`, `lib/azure-sig.js`)

Backs `"azure"` connections. `accessKeyId`/`secretAccessKey` hold the storage
account name / account key; the host is derived
(`{account}.blob.core.windows.net`), no custom endpoint field. Same method
surface as `S3Client` (`listObjects`, `getObjectBlob`, `copyObject`, …),
mapped onto the Blob REST API — containers instead of buckets, `List Blobs`
instead of `ListObjectsV2`, `PUT` with `x-ms-blob-type: BlockBlob` for
uploads.

`azure-sig.js#signRequest()` implements Shared Key auth: HMAC-SHA256 over
Azure's canonicalized-headers/-resource string, base64 account key,
`Authorization: SharedKey {account}:{signature}`. `presignUrl()` builds a
read-only Service SAS (query-string signed, `sv`/`sr`/`sp`/`se`/`sig`
params) — the Azure equivalent of an S3 presigned URL, GET only, same as
the Share modal's other "signed link" option. `scheme` is `"az"`.

`copyObject` uses server-side `x-ms-copy-source` + polls
`x-ms-copy-status` on the destination until it settles — same-account only
(a cross-account copy would need a source SAS, not implemented, matching
this app's same-connection clipboard model — see design.md).

`Content-Length` can't be set on a `fetch()` request (forbidden header
name) but Shared Key requires it in the signature — `bodyLength()` computes
it from the body and it's threaded through `request()`'s `contentLength`
option purely for signing; the browser sends the matching real length on
the wire automatically.

## Storage (`lib/store.js`)

Single `chrome.storage.local` key `"connections"`, an array. Plus a separate
`"lastConnectionId"` key so the panel reopens on the last-used connection.
`exportConnections()`/`parseImport()` round-trip `{ version: 1, connections: [...] }`
as downloadable/importable JSON — secrets included, plaintext, by design (see
design.md).

## UI (`sidepanel.js`)

Single mutable `state` object (`connections`, `activeId`, `client`, `bucket`,
`prefix`, `token`), re-rendered imperatively — no framework, no virtual DOM.
`state.bucket`/`state.prefix` seed from the active connection's `bucket`/
`prefix` in `onConnectionChanged()`; all further movement goes through
`navigateToPrefix()` so the breadcrumb and list stay in sync. A connection
saved before the bucket-scoped model (no `bucket` field) doesn't crash — the
breadcrumb skips the bucket crumb and the file list shows an "Edit
connection" prompt instead of trying to list objects.

Rows are built with `makeRow()`; the connection form's Save button runs a
real validation before persisting anything — see below.

Object keys ending in `/` (S3 "folder marker" objects) are filtered out of
the file rows — they're represented by the `CommonPrefixes` folder row
instead.

Destructive actions (delete, recursive folder delete, discarding unsaved
edits) confirm via `confirmDialog()`, and new-folder naming uses
`promptDialog()` — both built on `<dialog>` (matching the connection/manage
modals) instead of `window.confirm`/`window.prompt`, so they pick up the
extension's own styling and dark-mode colors rather than the browser's
native alert chrome. Copy/move destinations are no longer a prompt — see
Clipboard copy/cut/paste below.

Files get a type-specific icon (`iconForFileName()` in `lib/icons.js`, keyed
off extension) instead of one generic file glyph. Dropping files onto the
list uploads them (`dragover`/`drop` on `#fileList`), same code path as the
Upload button.

## Connection form (`openConnectionModal()`, `saveConnectionFromForm()`)

The `#connType` select drives everything else in the form: `TYPE_META` maps
each type to its field labels (`"Bucket name"` vs `"Container name"`,
`"Access key ID"` vs `"Storage account name"`, …) and which Advanced fields
apply (region/endpoint/path-style — S3 and S3-compatible only);
`applyTypeToForm()` applies that on open and on every `#connType` change.
Every type writes into the same underlying fields (`bucket`, `accessKeyId`,
`secretAccessKey`) regardless of label, so switching type mid-edit doesn't
lose what's typed.

Save doesn't just persist the form — it proves the connection actually
works first, with each step reflected in `#connFormStatus` (spinner icon +
text, via `setFormStatus()`, the same `applyStatus()` helper the main status
bar uses):

1. Type-specific setup: S3 detects region if blank (`detectBucketRegion()`,
   "Detecting region…"); S3-compatible requests runtime permission for its
   custom endpoint; GCS/Azure need no extra step (fixed/derived endpoint,
   pre-granted permission — see design.md).
2. `createClient(conn).listObjects(...)` against the real bucket/prefix
   ("Checking bucket access…") — this is a throwaway client for the
   in-progress form values, not `state.client`.
3. Only on success does it call `upsertConnection()` and close the dialog;
   on failure the error (see the `<Code>: <Message>` note above) shows in
   the modal and the dialog stays open so the user can fix it. The Save
   button is disabled for the duration to prevent double-submits.

## Clipboard copy/cut/paste (`sidepanel.js`)

`state.clipboard` is `{ items, cut, bucket, connectionId }` or `null` — no OS
clipboard involved, it's in-memory UI state. `setClipboard()` (from a row's
Copy/Cut button, the bulk bar, or the detail sheet) fills it and shows the
`#clipboardPill` status indicator; `pasteClipboard()` copies each item into
`state.prefix` (`copyObject`/`copyPrefix`, S3 or Azure per the connection), then deletes the
sources if `cut` is set. Guards: a paste that would land exactly where an
item already is, or nest a folder inside itself, is skipped rather than
erroring. `updateClipboardUI()` disables Paste when the clipboard holds
items from a different connection than the active one (its credentials may
not have access to the source bucket).

## Object preview & editing (`sidepanel.js`, `lib/preview.js`)

`previewKind(name)` decides what `renderDetailPreview()` shows in the detail
sheet:

- `image`/`video`/`audio`/`pdf` → a presigned/SAS URL (`client.presignedUrl`)
  as the element's `src`, so the browser fetches/streams/seeks directly —
  the extension never holds the file in memory. PDFs also get an "Open in a
  new tab" fallback link in case the inline `<iframe>` doesn't render.
- `text`/`markdown` → `getObjectBlob().text()` into an editable `<textarea>`
  (skipped, with a "too large" note, past `isTooLargeForTextPreview()`'s 2MB
  cutoff); Markdown adds a Preview/Source toggle backed by
  `lib/markdown.js#renderMarkdown()`.

`editorState` (module-level, one at a time) tracks `{ key, mimeType,
original, el }` for the open text editor; `markEditorDirty()` compares
`el.value` to `original` to enable/disable Save, and `saveEditor()` writes
back via `putObject` with `mimeForName()`'s content-type. Closing the sheet
(button, Escape, or backdrop click) while dirty prompts to discard instead
of losing the edit — see `closeDetailModal()`.

## Adding a new bucket operation

1. Add the method to `S3Client` (`lib/s3-client.js`) using `this.request()`
   (handles signing + error surfacing) — and to `AzureClient`
   (`lib/azure-client.js`) the same way, under the same method name, so
   `sidepanel.js` can call it without branching on type.
2. Wire a UI trigger in `sidepanel.js` (toolbar button or row action), using
   the `withStatus()` helper so busy/error states show in the status bar.

## Testing this locally

See the [README](../README.md#development) for `make zip` / load-unpacked
steps. There's no automated test suite yet (no build tooling, kept
dependency-free) — `node --check` on each `.js` file catches syntax errors;
`make lint` runs that.
