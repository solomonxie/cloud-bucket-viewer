# Privacy Policy — Cloud Bucket Viewer

Last updated: 2026-09-15

## Summary

Cloud Bucket Viewer does not collect, transmit, sell or share any user data.
There is no backend server, no analytics, no telemetry and no third-party
code. Everything the extension does happens inside your browser.

## What the extension stores

Connections you create — a name, a bucket/container name, an optional key
prefix, an endpoint/region where applicable, and the credential you supply
(an access key pair, an Azure storage connection string, or a Google Cloud
service account JSON key).

These are written to `chrome.storage.local`, which lives only on the device
where you entered them. They are never written to `chrome.storage.sync`, so
they are not copied to your Google account or to other devices.

## Where that data goes

Credentials are used solely to sign requests to the storage endpoint that the
connection itself names — Amazon S3, an S3-compatible endpoint you typed,
Azure Blob Storage, or Google Cloud Storage. Google Cloud Storage connections
additionally contact `https://oauth2.googleapis.com` to exchange the service
account key for an access token, as required by Google.

No data is sent anywhere else. The developer of this extension receives
nothing.

## Object content

File contents you preview, edit, upload or download are transferred directly
between your browser and your own storage provider. They are not retained by
the extension beyond the browsing session and are not sent to any third party.

## Data you export

The export feature writes your connections, including their credentials, to a
plaintext JSON file that you choose to save. Treat that file like any other
credential file.

## Deleting your data

Removing a connection in the extension deletes it from `chrome.storage.local`.
Uninstalling the extension removes all of its stored data.

## Permissions

- `storage` — save your connection list locally.
- `sidePanel` — render the interface in Chrome's side panel.
- `downloads` — save a file from a bucket to your computer when you click
  Download.
- Host permissions for AWS, Cloudflare R2, Google Cloud Storage, Google's
  OAuth token endpoint and Azure Blob Storage — make the storage API calls.
- Optional host permissions — requested at the moment you add a custom
  S3-compatible endpoint (MinIO, Wasabi, etc), only for that endpoint, and
  only after you approve the Chrome prompt.

## Contact

Questions or reports: https://github.com/solomonxie/cloud-bucket-viewer/issues
