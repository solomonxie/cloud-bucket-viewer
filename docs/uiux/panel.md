# The side panel

`extension/sidepanel.html` — one panel, ~360px wide. Everything is in it;
there is no options page and no popup.

```
┌──────────────────────────────────────────────┐
│ 🛢  my-bucket ▾      [＋] [⚙] [⬆] [⬇]        │ ← connection picker first:
├──────────────────────────────────────────────┤   which bucket am I in
│ [⟳] [☑] [📋]        [ ⊕ New folder ][ ⬆ Upload ]│
├──────────────────────────────────────────────┤
│ 🛢 my-bucket › logs › 2026                   │ ← every crumb is a button
├──────────────────────────────────────────────┤
│ 📋 3 items cut                          [✕]  │ ← pill, only while holding
├──────────────────────────────────────────────┤   a clipboard
│ ⟳ Uploading report.pdf…                      │ ← status line, only while
├──────────────────────────────────────────────┤   working
│ ↰  ..                                        │ ← never rises above the
│ 📁 01/                          [⧉][✂][🗑]   │   connection's own prefix
│ 📁 02/                          [⧉][✂][🗑]   │
│ 📄 report.pdf                        [⧉][✂]  │
│    2.4 MB · Sep 14, 2026                     │   row actions appear on the
│ 🖼 chart.png                         [⧉][✂]  │   row, not behind a ⋯ menu
│    412 KB · Sep 12, 2026                     │
├──────────────────────────────────────────────┤
│              [ Load more… ]                  │ ← paging is explicit; the
├──────────────────────────────────────────────┤   list never auto-grows
│ 2 folders · 128 files · 1.2 GB · more not    │
│ loaded                                       │ ← says when the count is
└──────────────────────────────────────────────┘   partial, rather than
                                                   implying it is the total
```

Folders come first, then files. A folder-marker object (`key` ending in `/`)
is drawn once, as the folder — never twice.

## Empty and blocked states

```
 no connection    🏠  Add a connection to get started
                      Click + next to the connection dropdown.
                  (the dropdown itself reads "No connections — click +")

 no bucket set    🛢  This connection has no bucket set
                      Edit it and add a bucket name.
                      [ Edit connection ]            ← the fix, in place

 empty folder     📥  This folder is empty
                      Upload a file or drop one here.

 error            ⊗ AccessDenied: … (the provider's own words, verbatim)
```

The status line carries loading and error in the same slot — one line above
the list, never an alert and never a toast that covers a row.

## Toolbar states

```
 [⟳]              always available once a client exists
 [☑]  select      ·  disabled until a bucket is set; active = filled
 [📋] paste       ·  disabled with an empty clipboard, and when the
                     clipboard belongs to another connection:
                     title = "Clipboard has items from a different connection"
 [New folder]     ·  disabled without a bucket
 [Upload]         ·  disabled without a bucket
```

## Select mode

```
 [☑] ↓
┌──────────────────────────────────────────────┐
│ ☑ 3 selected             [⧉] [↔] [🗑] [✕]    │ ← select-all is the same
├──────────────────────────────────────────────┤   checkbox, indeterminate
│ ☑ 📁 01/                                     │   when partial
│ ☐ 📄 report.pdf                              │
└──────────────────────────────────────────────┘
 per-row actions disappear in select mode — the bar owns them now
 bulk buttons are disabled at 0 selected
```

## Drag and drop

```
 drag files over the list ⇒ the list itself highlights (drag-over)
 drop ⇒ each file uploads into the current prefix, one at a time, with
        "Uploading <name>…" on the status line; one failure doesn't stop
        the rest
```
