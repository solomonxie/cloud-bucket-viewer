# Chrome Web Store submission

Everything needed to publish, in dashboard order. Copy each block as-is.

Dashboard: https://chrome.google.com/webstore/devconsole — one-time $5 USD
developer registration fee, then **Add new item**.

## 0. Package to upload

`dist/cloud-bucket-viewer.zip` — rebuild with `make zip` before every
submission. Contains only `extension/` (22 files, manifest v3, no remote code,
no dotfiles).

Manifest version is `0.3.0`. Every resubmission needs a higher number, so bump
`extension/manifest.json` before rebuilding.

## 1. Store listing

**Item name**

```
Cloud Bucket Viewer
```

**Summary** (130/132 chars — same text as the manifest `description`, which
the dashboard pre-fills this field from; both share the 132-char cap)

```
Browse, preview and edit S3, S3-compatible, Azure Blob and Google Cloud Storage buckets from a Chrome side panel. Keys stay local.
```

**Description**

```
Cloud Bucket Viewer turns Chrome's side panel into a file explorer for your object storage. It sits next to whatever tab you're working in, so you can check a bucket without leaving the page.

Works with four kinds of storage:
• Amazon S3
• S3-compatible endpoints — Cloudflare R2, MinIO, Wasabi, Backblaze B2 and anything else that speaks the S3 API
• Azure Blob Storage
• Google Cloud Storage

WHAT YOU CAN DO
• Browse folders and files with breadcrumb navigation and pagination
• Preview images, video, audio and PDFs inline
• Edit text, code and Markdown files in place and save back — Markdown has a rendered-preview toggle
• Copy, cut and paste files and folders, clipboard-style, with multi-select for bulk operations
• Upload by picking a file or dragging one into the current folder
• Download files, create folders, recursively delete folders
• Share an object as a provider URI (s3://, az://, gs://), a plain HTTPS link, or a signed link with a configurable expiry

CONNECTIONS
Add as many named connections as you like and switch between them from the toolbar. Each one is scoped to a single bucket or container, so you land straight where you work. Adding a connection needs only a bucket name and a credential — the region is auto-detected, the display name defaults to the bucket name, and a starting key prefix is optional. Saving validates the connection against the provider first and shows the progress inline, so a typo fails immediately instead of halfway through a session.

No interactive sign-in anywhere: S3 and S3-compatible take an access key pair, Azure takes a storage account connection string, Google Cloud Storage takes a service account JSON key.

YOUR CREDENTIALS STAY ON YOUR MACHINE
There is no backend server, no analytics and no third-party code. Credentials live in chrome.storage.local on the device where you entered them — never chrome.storage.sync, so they are not copied to your Google account or to your other devices. They are used only to sign requests to the endpoint that the connection itself names. Requests go straight from your browser to your storage provider.

You can export all connections to a JSON file and import them elsewhere. That file contains your secrets in plaintext, so handle it like any other credential file.

Open source, MIT licensed, no build step and no cloud SDKs — request signing is plain JavaScript (SigV4 for S3, Shared Key for Azure, service-account JWT plus GOOG4-RSA-SHA256 for Google Cloud Storage), so you can read every line that touches a key.

Source and issues: https://github.com/solomonxie/cloud-bucket-viewer
```

**Category**

```
Developer Tools
```

**Language**

```
English (United States)
```

## 2. Graphic assets

Drag these exact files. Every one is already 24-bit RGB with no alpha, which
the dashboard requires.

| Field | File | Size |
|---|---|---|
| Store icon (required) | `extension/icons/icon128.png` | 128x128 |
| Screenshot 1 (required) | `docs/store/1-file-browser.png` | 1280x800 |
| Screenshot 2 | `docs/store/2-preview.png` | 1280x800 |
| Screenshot 3 | `docs/store/3-providers.png` | 1280x800 |
| Small promo tile | `docs/store/promo-tile.png` | 440x280 |
| Marquee promo tile | `docs/store/marquee.png` | 1400x560 |

Do **not** upload anything from `docs/screenshots/` — that folder is gone for
this reason. `make assets` rebuilds everything above.

## 3. Additional fields

**Homepage URL**

```
https://github.com/solomonxie/cloud-bucket-viewer
```

**Support URL**

```
https://github.com/solomonxie/cloud-bucket-viewer/issues
```

Mature content: **No**.

## 4. Privacy tab

**Single purpose description**

```
Cloud Bucket Viewer has one purpose: to let a user browse and manage the objects in their own cloud storage buckets from Chrome's side panel. Every feature — listing folders, previewing a file, editing text, uploading, downloading, copying, moving, deleting and generating share links — serves that single purpose of operating on the buckets the user has connected.
```

**Permission justifications**

`storage`

```
Stores the list of connections the user creates — bucket name, endpoint or region, optional key prefix, and the credential needed to reach that bucket — in chrome.storage.local so they persist between sessions. Nothing is written to chrome.storage.sync and nothing leaves the device.
```

`sidePanel`

```
The entire user interface is a side panel. This permission is what lets the extension open its file browser beside the current tab instead of in a popup that closes on every click.
```

`downloads`

```
Used by the Download action to save an object from a bucket to the user's computer, and to save the JSON file produced by the "export connections" feature. It is only ever called in direct response to a click.
```

**Host permission justification**

```
The extension signs and sends storage API requests directly from the browser to the provider the user connected to. amazonaws.com covers Amazon S3, r2.cloudflarestorage.com covers Cloudflare R2, storage.googleapis.com covers Google Cloud Storage, blob.core.windows.net covers Azure Blob Storage, and oauth2.googleapis.com is required to exchange a Google service account key for an access token. The optional https://*/* permission is never granted up front: it is requested at runtime, narrowed to the one host the user typed, when they add a self-hosted or third-party S3-compatible endpoint such as MinIO or Wasabi, and Chrome shows its own prompt for that host.
```

**Are you using remote code?**

```
No, I am not using remote code
```

All JavaScript ships inside the package; there are no CDN scripts, no eval and no remotely hosted modules.

**Data usage** — check only:

- [x] Authentication information *(the access keys, connection strings and service account keys the user enters)*

Leave unchecked: personally identifiable information, health information,
financial and payment information, personal communications, location, web
history, user activity, website content.

Then tick all three certifications — the extension does not sell or transfer
user data to third parties, does not use it for any purpose unrelated to its
single purpose, and does not use it for creditworthiness or lending.

**Privacy policy URL**

```
https://raw.githubusercontent.com/solomonxie/cloud-bucket-viewer/master/PRIVACY.md
```

Two ways this 404s: the file isn't pushed yet, or the URL says `main` when
this repo's default branch is `master`. The `raw.githubusercontent.com`
form above is served as plain text with no login wall or JS, which is what
the dashboard's reachability check wants. The rendered
`github.com/.../blob/master/PRIVACY.md` also works if you prefer it.

## 5. Distribution

Visibility **Public**, all regions, free. No account or payment is required to
use the extension, so no test credentials are needed — but the reviewer does
need a bucket to look at. Paste this into **Notes for reviewer**:

```
The extension requires the reviewer to supply their own cloud storage credentials; there is no account to sign into and no demo server. To exercise it: open the side panel from the toolbar icon, click +, choose Amazon S3, enter any bucket name plus an access key ID and secret access key for that bucket, and save. The file browser opens on that bucket. All requests go directly from the browser to AWS/Azure/Google; the extension has no backend.
```

## 6. Review

First submissions with host permissions typically take a few days. The most
common rejection causes here would be a stale privacy policy URL or a
permission justification that does not name a concrete feature — both are
covered above.
