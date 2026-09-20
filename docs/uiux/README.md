# UI/UX mockups — Cloud Bucket Viewer

The whole product is one Chrome side panel. Every surface drawn as it is
built today; `../design.md` carries the product decision, `../implementation.md`
the build order.

Glyphs follow the `uiux` skill (`references/notation.md` + `text-figma.md`):
`[[ x ]]` primary · `[ x ]` secondary · `( x )` link button · `[icon]` icon
button · `›` opens · `⟳` working · `←` annotation · `!` destructive ·
`·` disabled · `[brackets]` = `<dialog>`.

## Surface map

```
 Chrome toolbar icon ─▶ side panel (the entire UI)
   │
   ├ header    connection ▾   [＋] [⚙] [⬆] [⬇]
   │              ＋/⚙ ─▶ [connection dialog] ─▶ [manage connections]
   │              ⬆ export all · ⬇ import (a JSON file)
   ├ toolbar   [⟳] [☑] [📋]            [New folder] [Upload]
   ├ breadcrumb  bucket › logs › 2026
   ├ clipboard pill (only while something is cut/copied)
   ├ selection bar (only in select mode)
   ├ status line (only while working, or on an error)
   ├ file list  ..  folders, then files            ─▶ [detail sheet]
   │                                                    └─▶ [share dialog]
   ├ [ Load more… ]
   └ stats      3 folders · 128 files · 1.2 GB · more not loaded

 dialogs: connection · manage · confirm · prompt · share · detail
```

## Files

| File | Covers |
|---|---|
| `panel.md` | header, toolbar, breadcrumb, list, stats, empty states |
| `objects.md` | detail sheet, preview/edit, share, upload, clipboard, bulk |
| `connections.md` | add/edit connection per provider, manage, import/export |
