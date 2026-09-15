# S3 Bucket Viewer

A Chrome side panel for browsing S3 buckets like a file explorer.

Add one or more connections — just a bucket name, access key and secret key
(everything else is optional or auto-detected) — stored only in your
browser, exportable/importable as JSON. Pick a connection and land straight
in that bucket, then browse folders, preview or edit files, and copy, move
or delete objects — all from a side panel that stays open next to whatever
tab you're on. Works with AWS S3 and S3-compatible services (Cloudflare R2,
MinIO, etc).

No build step, no AWS SDK — plain JS signing S3 requests directly with
SigV4. See [docs/design.md](docs/design.md) and
[docs/implementation.md](docs/implementation.md) for how it's built.

## Features

- Multiple named connections, each scoped to one bucket, switchable from
  the toolbar. Adding one only strictly needs a bucket name, access key and
  secret key — region is auto-detected from the bucket, name defaults to
  the bucket name, and a starting key prefix is optional.
- Save validates the connection against S3 before storing it, with progress
  shown inline (region detection, then a real access check).
- Keys stored locally (`chrome.storage.local`) only; export/import as JSON.
- Browse folders → files with breadcrumb navigation and pagination.
- Preview images, video, audio and PDF inline; edit text/code/Markdown files
  directly (Markdown gets a rendered-preview toggle) and save back to S3.
- Copy/cut/paste files and folders — clipboard-style, with a status
  indicator for what's queued — plus multi-select for bulk copy/cut/delete.
- Share a file as an `s3://` URI, an unsigned HTTP link, or a signed link
  with a configurable expiry.
- Download files. Create folders, recursive-delete folders.
- Upload a file (or drag-and-drop one) into the current folder.
- Custom endpoint + path-style option for non-AWS S3-compatible services.

## Install

1. `make zip` (or just point Chrome at `extension/` directly, see below).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `extension/` folder (no zip needed for
   local dev), or drag `dist/s3-viewer.zip` onto the page.
4. Click the toolbar icon to open the side panel, then **+** to add a
   connection.

## Development

```sh
make lint   # syntax-check every .js file + manifest.json
make zip    # build dist/s3-viewer.zip
make icons  # regenerate extension/icons/*.png
make clean  # remove dist/
```

No dependencies to install — everything runs on the system's `node`,
`python3` and `zip`.

## Security note

Access keys and secret keys are stored in plaintext in
`chrome.storage.local` (never synced) and are sent only to the S3 endpoint
the connection names. Exporting connections writes those secrets to a
plaintext JSON file — handle exported files like any other credential file.
A "signed link" generated from Share is a presigned URL: anyone with it can
read that object until it expires, with no further authentication.
