# Objects — detail, preview, share, clipboard

## Detail sheet  (`#detailModal`)

Opening a file never leaves the panel and never opens a tab.

```
┌──────────────────────────────────────────────┐
│ 📄  report.pdf                          [✕]  │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │                                          │ │ ← preview, by file kind
│ │           [ inline preview ]             │ │
│ │                                          │ │
│ └──────────────────────────────────────────┘ │
│ Key             logs/2026/report.pdf         │
│ Size            2.4 MB                       │
│ Last modified   Sep 14, 2026                 │
│ Storage class   STANDARD                     │ ← only when the API says one
├──────────────────────────────────────────────┤
│ [💾] [⬆] [⬇] [⧉] [✂] [🗑]                    │
│ save share download copy cut delete          │ ← 💾 only for editable text
└──────────────────────────────────────────────┘
```

Preview is per file kind, in place — never a "can't show this" dead end:

```
 image   png jpg jpeg gif webp bmp avif svg   <img>
 video   mp4 webm mov m4v                     <video controls>   streams from
 audio   mp3 wav aac ogg m4a flac             <audio controls>   a signed URL,
 pdf     pdf                                  <iframe>           never buffered
 text    txt log csv json yaml js py go …     editable <textarea> + [💾]
 markdown md                                  [ PREVIEW | Source ] toggle
 other   —                                    a plain fallback line
 > 2 MB  File is 4.1 MB — too large to preview/edit here. Use Download
         instead.
```

```
 edited, then closing ⇒ Discard changes?
                        Your edits haven't been saved.
                        ( Cancel )        [ Discard ]!
```

## Share  (`#shareModal`)

Three answers to "give me a link", each labelled with what it actually does.

```
┌──────────────────────────────────────────────┐
│ Share "report.pdf"                           │
│ s3:// URI                            ← the   │
│ ┌────────────────────────────────┐ [⧉]      │   scheme follows the provider
│ │ s3://my-bucket/logs/report.pdf │           │   (s3://, az://, gs://)
│ └────────────────────────────────┘           │
│ HTTP link (unsigned — only works if the      │
│ object/bucket is public)                     │
│ ┌────────────────────────────────┐ [⧉]      │
│ Signed link (works on private objects,       │
│ expires)                                     │
│ Expires in 1 hour ▾        [ Generate ]      │
│ ┌────────────────────────────────┐ [⧉]      │
│ │ Click Generate…                │           │ ← nothing is signed until
│ └────────────────────────────────┘           │   asked for
│                              [[ Close ]]     │
└──────────────────────────────────────────────┘
 expiry: 15 minutes · 1 hour (default) · 6 hours · 1 day · 7 days
```

## Clipboard — copy / cut / paste

```
 row [⧉] or [✂]  ⇒ status: 3 items cut — open a folder and click Paste.
 pill            📋 3 items cut                          [✕]
 navigate, [📋]  ⇒ ⟳ Pasting 3 item(s)…
                  ⇒ Pasted 2, skipped 1 (already here).
 different connection ⇒ [📋] disabled, title says why
```

Copy and cut are the same clipboard: cut only differs in deleting the source
after a successful write.

## Destructive actions — one dialog shape

```
┌──────────────────────────────────────────────┐
│ 🗑  Delete file?                              │
│     logs/2026/report.pdf                     │ ← the message is the key, so
│                                              │   there is no doubt which
│              ( Cancel )     [ Delete ]!      │
└──────────────────────────────────────────────┘
 deleting a folder ⇒ ⟳ Deleted 42…   (counts up as the prefix drains)
 bulk              ⇒ ⟳ Deleting 3 item(s)…
```

## Prompts — one dialog shape

```
┌──────────────────────────────────────────────┐
│ New folder                                   │
│ Folder name                                  │
│ ┌──────────────────────────────────────────┐ │
│ └──────────────────────────────────────────┘ │
│              ( Cancel )        [[ OK ]]      │
└──────────────────────────────────────────────┘
 ⟳ Creating folder…
```
