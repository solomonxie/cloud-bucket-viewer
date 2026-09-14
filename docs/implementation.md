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
| `extension/lib/sigv4.js` | `signRequest()` — AWS Signature V4 |
| `extension/lib/s3-client.js` | `S3Client` class — REST calls + XML parsing, `formatSize()` |
| `extension/lib/store.js` | connections CRUD, export/import, in `chrome.storage.local` |
| `extension/lib/icons.js` | inline-SVG icon set (`icon()`) + `iconForFileName()` by extension |
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

## S3 client (`lib/s3-client.js`)

`new S3Client(connection)` then:

- `listBuckets()` → `GET /` on the account endpoint.
- `listObjects(bucket, prefix, token)` → one page, `delimiter=/`.
- `listAllKeys(bucket, prefix)` → async generator, no delimiter, paginates
  via `NextContinuationToken`; used by `deletePrefix()`.
- `getObjectBlob`, `deleteObject`, `copyObject`, `moveObject` (copy+delete),
  `putObject`, `createFolder` (zero-byte key ending in `/`).

Virtual-hosted vs. path-style URLs: `usesPathStyle()` is true when
`connection.pathStyle` is set or a custom `endpoint` is present (custom
S3-compatible hosts commonly need path style); otherwise AWS virtual-hosted
`bucket.s3.region.amazonaws.com` is used.

XML responses are parsed with `DOMParser` (only available in document
contexts — this is why S3 calls happen from `sidepanel.js`, not
`background.js`).

## Storage (`lib/store.js`)

Single `chrome.storage.local` key `"connections"`, an array. Plus a separate
`"lastConnectionId"` key so the panel reopens on the last-used connection.
`exportConnections()`/`parseImport()` round-trip `{ version: 1, connections: [...] }`
as downloadable/importable JSON — secrets included, plaintext, by design (see
design.md).

## UI (`sidepanel.js`)

Single mutable `state` object (`connections`, `activeId`, `client`, `bucket`,
`prefix`, `token`), re-rendered imperatively — no framework, no virtual DOM.
Rows are built with `makeRow()`; navigation always goes through
`navigateToBuckets/Bucket/Prefix()` so the breadcrumb, toolbar-enabled state,
and list stay in sync.

Object keys ending in `/` (S3 "folder marker" objects) are filtered out of
the file rows — they're represented by the `CommonPrefixes` folder row
instead.

Destructive actions (delete, recursive folder delete) confirm via
`confirmDialog()`, and copy/move/new-folder destinations use `promptDialog()`
— both built on `<dialog>` (matching the connection/manage modals) instead of
`window.confirm`/`window.prompt`, so they pick up the extension's own styling
and dark-mode colors rather than the browser's native alert chrome.

Files get a type-specific icon (`iconForFileName()` in `lib/icons.js`, keyed
off extension) instead of one generic file glyph. Dropping files onto the
list uploads them (`dragover`/`drop` on `#fileList`), same code path as the
Upload button.

## Adding a new S3 operation

1. Add the method to `S3Client` in `lib/s3-client.js`, using `this.request()`
   (handles signing + error surfacing).
2. Wire a UI trigger in `sidepanel.js` (toolbar button or row action), using
   the `withStatus()` helper so busy/error states show in the status bar.

## Testing this locally

See the [README](../README.md#development) for `make zip` / load-unpacked
steps. There's no automated test suite yet (no build tooling, kept
dependency-free) — `node --check` on each `.js` file catches syntax errors;
`make lint` runs that.
