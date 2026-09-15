import { S3Client, formatSize, detectBucketRegion } from "./lib/s3-client.js";
import {
  getConnections,
  upsertConnection,
  deleteConnection,
  exportConnections,
  parseImport,
  newConnectionId,
} from "./lib/store.js";
import { icon, iconForFileName } from "./lib/icons.js";
import { previewKind, isTooLargeForTextPreview, mimeForName } from "./lib/preview.js";
import { renderMarkdown } from "./lib/markdown.js";

const $ = (id) => document.getElementById(id);

const els = {
  connectionSelect: $("connectionSelect"),
  addConnBtn: $("addConnBtn"),
  manageBtn: $("manageBtn"),
  breadcrumb: $("breadcrumb"),
  refreshBtn: $("refreshBtn"),
  selectModeBtn: $("selectModeBtn"),
  pasteBtn: $("pasteBtn"),
  clipboardPill: $("clipboardPill"),
  clipboardIcon: $("clipboardIcon"),
  clipboardCount: $("clipboardCount"),
  clipboardClearBtn: $("clipboardClearBtn"),
  selectionBar: $("selectionBar"),
  selectAllCheckbox: $("selectAllCheckbox"),
  selectionCount: $("selectionCount"),
  bulkCopyBtn: $("bulkCopyBtn"),
  bulkMoveBtn: $("bulkMoveBtn"),
  bulkDeleteBtn: $("bulkDeleteBtn"),
  exitSelectBtn: $("exitSelectBtn"),
  newFolderBtn: $("newFolderBtn"),
  uploadBtn: $("uploadBtn"),
  uploadInput: $("uploadInput"),
  status: $("status"),
  fileList: $("fileList"),
  loadMoreBtn: $("loadMoreBtn"),
  listStats: $("listStats"),
  connectionModal: $("connectionModal"),
  connectionForm: $("connectionForm"),
  connectionModalTitle: $("connectionModalTitle"),
  connId: $("connId"),
  connBucket: $("connBucket"),
  connAccessKey: $("connAccessKey"),
  connSecretKey: $("connSecretKey"),
  connPrefix: $("connPrefix"),
  connName: $("connName"),
  connRegion: $("connRegion"),
  connEndpoint: $("connEndpoint"),
  connPathStyle: $("connPathStyle"),
  connDeleteBtn: $("connDeleteBtn"),
  connCancelBtn: $("connCancelBtn"),
  connSaveBtn: $("connSaveBtn"),
  connFormStatus: $("connFormStatus"),
  connManageAllBtn: $("connManageAllBtn"),
  toggleSecretBtn: $("toggleSecretBtn"),
  manageModal: $("manageModal"),
  manageList: $("manageList"),
  importBtn: $("importBtn"),
  exportBtn: $("exportBtn"),
  importInput: $("importInput"),
  manageCloseBtn: $("manageCloseBtn"),
  confirmDialog: $("confirmDialog"),
  confirmIcon: $("confirmIcon"),
  confirmTitle: $("confirmTitle"),
  confirmMessage: $("confirmMessage"),
  confirmOkBtn: $("confirmOkBtn"),
  confirmCancelBtn: $("confirmCancelBtn"),
  promptDialog: $("promptDialog"),
  promptForm: $("promptForm"),
  promptTitle: $("promptTitle"),
  promptLabel: $("promptLabel"),
  promptInput: $("promptInput"),
  promptCancelBtn: $("promptCancelBtn"),
  shareModal: $("shareModal"),
  shareModalTitle: $("shareModalTitle"),
  shareS3Uri: $("shareS3Uri"),
  copyS3UriBtn: $("copyS3UriBtn"),
  shareHttpUrl: $("shareHttpUrl"),
  copyHttpUrlBtn: $("copyHttpUrlBtn"),
  shareExpiry: $("shareExpiry"),
  generateSignedBtn: $("generateSignedBtn"),
  shareSignedUrl: $("shareSignedUrl"),
  copySignedUrlBtn: $("copySignedUrlBtn"),
  shareCloseBtn: $("shareCloseBtn"),
  detailModal: $("detailModal"),
  detailIcon: $("detailIcon"),
  detailName: $("detailName"),
  detailCloseBtn: $("detailCloseBtn"),
  detailMeta: $("detailMeta"),
  detailPreview: $("detailPreview"),
  detailSaveBtn: $("detailSaveBtn"),
  detailShareBtn: $("detailShareBtn"),
  detailDownloadBtn: $("detailDownloadBtn"),
  detailCopyBtn: $("detailCopyBtn"),
  detailMoveBtn: $("detailMoveBtn"),
  detailDeleteBtn: $("detailDeleteBtn"),
};

const state = {
  connections: [],
  activeId: null,
  client: null,
  bucket: null,
  prefix: "",
  token: null,
  stats: { folders: 0, files: 0, bytes: 0 },
  listedItems: [], // currently loaded {key, isFolder} rows, for "select all"
  selectMode: false,
  selected: new Map(), // key -> {key, isFolder}
  clipboard: null, // { items: [{key, isFolder}], cut, bucket, connectionId }
};

// Static icon-only controls: filled in once so sidepanel.html stays markup-only.
els.addConnBtn.innerHTML = icon("plus");
els.manageBtn.innerHTML = icon("settings");
els.refreshBtn.innerHTML = icon("refresh");
els.pasteBtn.innerHTML = icon("clipboard");
els.clipboardIcon.innerHTML = icon("clipboard");
els.clipboardClearBtn.innerHTML = icon("x");
els.newFolderBtn.innerHTML = `${icon("folderPlus")}<span>New folder</span>`;
els.uploadBtn.innerHTML = `${icon("upload")}<span>Upload</span>`;
els.toggleSecretBtn.innerHTML = icon("eye");
els.copyS3UriBtn.innerHTML = icon("copy");
els.copyHttpUrlBtn.innerHTML = icon("copy");
els.copySignedUrlBtn.innerHTML = icon("copy");
els.detailCloseBtn.innerHTML = icon("x");
els.detailSaveBtn.innerHTML = icon("save");
els.detailShareBtn.innerHTML = icon("share");
els.detailDownloadBtn.innerHTML = icon("download");
els.detailCopyBtn.innerHTML = icon("copy");
els.detailMoveBtn.innerHTML = icon("scissors");
els.detailDeleteBtn.innerHTML = icon("trash");
els.detailShareBtn.title = els.detailShareBtn.ariaLabel = "Share";
els.detailDownloadBtn.title = els.detailDownloadBtn.ariaLabel = "Download";
els.detailCopyBtn.title = els.detailCopyBtn.ariaLabel = "Copy";
els.detailMoveBtn.title = els.detailMoveBtn.ariaLabel = "Cut";
els.detailSaveBtn.title = els.detailSaveBtn.ariaLabel = "Save changes";
els.detailDeleteBtn.title = els.detailDeleteBtn.ariaLabel = "Delete";
els.selectModeBtn.innerHTML = icon("checkSquare");
els.bulkCopyBtn.innerHTML = icon("copy");
els.bulkMoveBtn.innerHTML = icon("move");
els.bulkDeleteBtn.innerHTML = icon("trash");
els.exitSelectBtn.innerHTML = icon("x");

function activeConnection() {
  return state.connections.find((c) => c.id === state.activeId) || null;
}

function applyStatus(el, message, { error = false, loading = false } = {}) {
  el.hidden = !message;
  el.classList.toggle("error", error);
  el.classList.toggle("loading", loading);
  const iconName = error ? "alertCircle" : loading ? "refresh" : "";
  el.innerHTML = message
    ? `${iconName ? icon(iconName) : ""}<span>${escapeHtml(message)}</span>`
    : "";
}

function setStatus(message, opts) {
  applyStatus(els.status, message, opts);
}

function setFormStatus(message, opts) {
  applyStatus(els.connFormStatus, message, opts);
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function withStatus(promise, busyMessage) {
  setStatus(busyMessage, { loading: true });
  try {
    const result = await promise;
    setStatus("");
    return result;
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), { error: true });
    throw err;
  }
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// --- Confirm / prompt dialogs (replace window.confirm/prompt) --------------

function confirmDialog({ title, message, confirmLabel = "Delete" }) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmIcon.innerHTML = icon("trash");
    els.confirmOkBtn.textContent = confirmLabel;

    const cleanup = (result) => {
      els.confirmDialog.close();
      els.confirmOkBtn.removeEventListener("click", onOk);
      els.confirmCancelBtn.removeEventListener("click", onCancel);
      els.confirmDialog.removeEventListener("cancel", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    els.confirmOkBtn.addEventListener("click", onOk);
    els.confirmCancelBtn.addEventListener("click", onCancel);
    els.confirmDialog.addEventListener("cancel", onCancel);
    els.confirmDialog.showModal();
  });
}

function promptDialog({ title, label, value = "" }) {
  return new Promise((resolve) => {
    els.promptTitle.textContent = title;
    els.promptLabel.textContent = label;
    els.promptInput.value = value;

    const cleanup = (result) => {
      els.promptDialog.close();
      els.promptForm.removeEventListener("submit", onSubmit);
      els.promptCancelBtn.removeEventListener("click", onCancel);
      els.promptDialog.removeEventListener("cancel", onCancel);
      resolve(result);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      cleanup(els.promptInput.value.trim() || null);
    };
    const onCancel = () => cleanup(null);

    els.promptForm.addEventListener("submit", onSubmit);
    els.promptCancelBtn.addEventListener("click", onCancel);
    els.promptDialog.addEventListener("cancel", onCancel);
    els.promptDialog.showModal();
    els.promptInput.focus();
    els.promptInput.select();
  });
}

// --- Connections -----------------------------------------------------------

async function loadConnections() {
  state.connections = await getConnections();
  const { lastConnectionId } = await chrome.storage.local.get("lastConnectionId");
  state.activeId =
    (lastConnectionId && state.connections.some((c) => c.id === lastConnectionId)
      ? lastConnectionId
      : state.connections[0]?.id) || null;
  renderConnectionSelect();
  await onConnectionChanged();
}

// A connection saved before "name" existed (or with a blank name typed in)
// has nothing to show here — fall back to the bucket, then a placeholder,
// so it's never an empty, unlabeled row.
function connectionLabel(conn) {
  return conn.name || conn.bucket || "(unnamed connection)";
}

function renderConnectionSelect() {
  els.connectionSelect.innerHTML = "";
  if (state.connections.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No connections — click +";
    els.connectionSelect.appendChild(opt);
    els.connectionSelect.disabled = true;
    return;
  }
  els.connectionSelect.disabled = false;
  for (const conn of state.connections) {
    const opt = document.createElement("option");
    opt.value = conn.id;
    opt.textContent = connectionLabel(conn);
    opt.selected = conn.id === state.activeId;
    els.connectionSelect.appendChild(opt);
  }
}

async function onConnectionChanged() {
  const conn = activeConnection();
  state.client = conn ? new S3Client(conn) : null;
  state.bucket = conn?.bucket || null;
  state.prefix = conn?.prefix || "";
  state.token = null;
  await chrome.storage.local.set({ lastConnectionId: state.activeId });
  updateToolbar();
  renderBreadcrumb();
  await refresh();
}

function updateToolbar() {
  const inBucket = !!state.bucket;
  els.newFolderBtn.disabled = !inBucket;
  els.uploadBtn.disabled = !inBucket;
  els.selectModeBtn.disabled = !inBucket;
  els.manageBtn.disabled = !state.activeId;
  updateClipboardUI();
}

// --- Navigation --------------------------------------------------------------

// A connection's own prefix (if any) is a hard boundary: browsing never goes
// above it, so the root crumb represents that scope, not the whole bucket.
function rootPrefix() {
  return activeConnection()?.prefix || "";
}

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = "";
  const conn = activeConnection();
  const crumbs = [];
  if (conn) {
    const root = rootPrefix();
    crumbs.push({ label: conn.name, iconName: "bucket", action: () => navigateToPrefix(root) });
    // The connection's own prefix is part of the fixed root: show each of its
    // segments too, but every one of them just returns to that same root.
    for (const part of root.split("/").filter(Boolean)) {
      crumbs.push({ label: part, action: () => navigateToPrefix(root) });
    }
    const parts = state.prefix.slice(root.length).split("/").filter(Boolean);
    let acc = root;
    for (const part of parts) {
      acc += part + "/";
      const target = acc;
      crumbs.push({ label: part, action: () => navigateToPrefix(target) });
    }
  } else {
    crumbs.push({ label: "—", iconName: "home", action: () => {} });
  }
  crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.innerHTML = icon("chevronRight");
      els.breadcrumb.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.innerHTML = `${crumb.iconName ? icon(crumb.iconName) : ""}<span>${escapeHtml(crumb.label)}</span>`;
    btn.addEventListener("click", crumb.action);
    els.breadcrumb.appendChild(btn);
  });
}

function navigateToPrefix(prefix) {
  const root = rootPrefix();
  state.prefix = prefix.startsWith(root) ? prefix : root;
  state.token = null;
  renderBreadcrumb();
  refresh();
}

// Prefix one level up from `prefix`, never rising above `root`.
function parentPrefix(prefix, root) {
  if (prefix.length <= root.length) return root;
  const trimmed = prefix.slice(0, -1); // drop trailing slash
  const idx = trimmed.lastIndexOf("/");
  const parent = idx >= 0 ? trimmed.slice(0, idx + 1) : "";
  return parent.length >= root.length ? parent : root;
}

// --- Listing -----------------------------------------------------------------

async function refresh() {
  state.token = null;
  state.listedItems = [];
  state.selected.clear();
  updateSelectionBar();
  els.fileList.innerHTML = "";
  els.loadMoreBtn.hidden = true;
  els.listStats.hidden = true;
  if (!state.client) {
    renderEmptyState("home", "Add a connection to get started", "Click + next to the connection dropdown.");
    return;
  }
  if (!state.bucket) {
    renderEmptyState(
      "bucket",
      "This connection has no bucket set",
      "Edit it and add a bucket name.",
      { label: "Edit connection", onClick: () => openConnectionModal(activeConnection()) }
    );
    return;
  }
  await loadMore(true);
}

async function loadMore(reset = false) {
  if (!state.client || !state.bucket) return;
  try {
    const data = await withStatus(
      state.client.listObjects(state.bucket, state.prefix, state.token),
      "Loading…"
    );
    renderObjectRows(data, reset);
    state.token = data.isTruncated ? data.nextToken : null;
    els.loadMoreBtn.hidden = !state.token;
    renderStats();
  } catch {
    // withStatus already surfaced the error
  }
}

function emptyStateNode(iconName, primary, secondary, action) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `${icon(iconName)}<div class="primary">${escapeHtml(primary)}</div><div>${escapeHtml(secondary)}</div>`;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    div.appendChild(btn);
  }
  return div;
}

function renderEmptyState(iconName, primary, secondary, action) {
  els.fileList.innerHTML = "";
  els.fileList.appendChild(emptyStateNode(iconName, primary, secondary, action));
}

// Lets the user step back out of the current folder without relying on the
// breadcrumb; never rises above the connection's own prefix boundary.
function appendParentRow() {
  const root = rootPrefix();
  if (state.prefix.length <= root.length) return;
  els.fileList.appendChild(
    makeRow({
      badgeIcon: "cornerUpLeft",
      badgeClass: "folder",
      name: "..",
      onOpen: () => navigateToPrefix(parentPrefix(state.prefix, root)),
    })
  );
}

function renderStats() {
  const { folders, files, bytes } = state.stats;
  if (folders + files === 0) {
    els.listStats.hidden = true;
    return;
  }
  const parts = [
    `${folders} folder${folders === 1 ? "" : "s"}`,
    `${files} file${files === 1 ? "" : "s"}`,
  ];
  if (bytes) parts.push(formatSize(bytes));
  if (state.token) parts.push("more not loaded");
  els.listStats.hidden = false;
  els.listStats.textContent = parts.join(" · ");
}

// --- Multi-select & bulk actions ---------------------------------------------

function setSelectMode(on) {
  state.selectMode = on;
  state.selected.clear();
  els.selectModeBtn.classList.toggle("active", on);
  els.selectionBar.hidden = !on;
  updateSelectionBar();
  refresh();
}

function toggleSelected(item, checked) {
  if (checked) state.selected.set(item.key, item);
  else state.selected.delete(item.key);
  updateSelectionBar();
}

function updateSelectionBar() {
  const n = state.selected.size;
  els.selectionCount.textContent = `${n} selected`;
  els.selectAllCheckbox.checked = n > 0 && n === state.listedItems.length;
  els.selectAllCheckbox.indeterminate = n > 0 && n < state.listedItems.length;
  els.bulkCopyBtn.disabled = n === 0;
  els.bulkMoveBtn.disabled = n === 0;
  els.bulkDeleteBtn.disabled = n === 0;
}

function syncRowCheckboxes() {
  els.fileList.querySelectorAll(".row-check").forEach((cb) => {
    const checked = state.selected.has(cb.dataset.key);
    cb.checked = checked;
    cb.closest(".row").classList.toggle("selected", checked);
  });
}

// --- Clipboard (copy/cut/paste) -----------------------------------------

function setClipboard(items, cut) {
  if (!items.length) return;
  state.clipboard = { items, cut, bucket: state.bucket, connectionId: state.activeId };
  updateClipboardUI();
  setStatus(
    `${items.length} item${items.length === 1 ? "" : "s"} ${cut ? "cut" : "copied"} — open a folder and click Paste.`
  );
}

function clearClipboard() {
  state.clipboard = null;
  updateClipboardUI();
}

function updateClipboardUI() {
  const cb = state.clipboard;
  els.clipboardPill.hidden = !cb;
  if (cb) {
    els.clipboardCount.textContent = `${cb.items.length} item${cb.items.length === 1 ? "" : "s"} ${cb.cut ? "cut" : "copied"}`;
  }
  const mismatched = cb && cb.connectionId !== state.activeId;
  els.pasteBtn.disabled = !cb || mismatched || !state.bucket;
  els.pasteBtn.title = mismatched ? "Clipboard has items from a different connection" : "Paste";
}

async function pasteClipboard() {
  const cb = state.clipboard;
  if (!cb || els.pasteBtn.disabled) return;
  let pasted = 0;
  let skipped = 0;
  try {
    setStatus(`Pasting ${cb.items.length} item(s)…`, { loading: true });
    for (const item of cb.items) {
      const base = item.key.replace(/\/$/, "").split("/").pop();
      const destKey = state.prefix + base + (item.isFolder ? "/" : "");
      // Refuse a no-op paste (same spot) or nesting a folder inside itself.
      if (destKey === item.key || (item.isFolder && state.prefix.startsWith(item.key))) {
        skipped += 1;
        continue;
      }
      if (item.isFolder) {
        await state.client.copyPrefix(state.bucket, destKey, cb.bucket, item.key);
        if (cb.cut) await state.client.deletePrefix(cb.bucket, item.key);
      } else {
        await state.client.copyObject(state.bucket, destKey, cb.bucket, item.key);
        if (cb.cut) await state.client.deleteObject(cb.bucket, item.key);
      }
      pasted += 1;
    }
    setStatus(skipped ? `Pasted ${pasted}, skipped ${skipped} (already here).` : `Pasted ${pasted} item(s).`);
    if (cb.cut && pasted > 0) clearClipboard(); // cut items move once; copy stays for repeat pastes
    await refresh();
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), { error: true });
  }
}

async function bulkDelete() {
  const items = [...state.selected.values()];
  if (!items.length) return;
  const ok = await confirmDialog({
    title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
    message: "Folders are deleted recursively. This can't be undone.",
  });
  if (!ok) return;
  try {
    setStatus(`Deleting ${items.length} item(s)…`, { loading: true });
    for (const item of items) {
      if (item.isFolder) await state.client.deletePrefix(state.bucket, item.key);
      else await state.client.deleteObject(state.bucket, item.key);
    }
    setStatus("");
    setSelectMode(false);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), { error: true });
  }
}


function makeRow({ badgeIcon, badgeClass, name, meta, onOpen, actions, itemKey, isFolder, checked }) {
  const row = document.createElement("div");
  row.className = "row";
  const selectable = state.selectMode && itemKey;

  if (selectable) {
    row.classList.add("selectable");
    row.classList.toggle("selected", !!checked);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "row-check";
    cb.checked = !!checked;
    cb.dataset.key = itemKey;
    cb.setAttribute("aria-label", `Select ${name}`);
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      row.classList.toggle("selected", cb.checked);
      toggleSelected({ key: itemKey, isFolder }, cb.checked);
    });
    row.appendChild(cb);
  }

  const badgeClickable = !selectable && onOpen;
  const badge = document.createElement(badgeClickable ? "button" : "span");
  badge.className = badgeClass ? `badge ${badgeClass}` : "badge";
  badge.innerHTML = icon(badgeIcon);
  if (badgeClickable) {
    badge.type = "button";
    badge.title = name;
    badge.addEventListener("click", onOpen);
  }
  row.appendChild(badge);

  if (selectable) {
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    nameEl.title = name;
    row.appendChild(nameEl);
    row.addEventListener("click", (e) => {
      if (e.target.closest("input")) return;
      const cb = row.querySelector(".row-check");
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
  } else if (onOpen) {
    const btn = document.createElement("button");
    btn.className = "name-btn";
    btn.textContent = name;
    btn.title = name;
    btn.addEventListener("click", onOpen);
    row.appendChild(btn);
  } else {
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
    nameEl.title = name;
    row.appendChild(nameEl);
  }

  const metaEl = document.createElement("span");
  metaEl.className = "meta";
  metaEl.textContent = meta || "";
  row.appendChild(metaEl);

  const actionsEl = document.createElement("span");
  actionsEl.className = "actions";
  for (const action of actions || []) {
    const btn = document.createElement("button");
    btn.className = action.danger ? "icon-btn danger-hover" : "icon-btn";
    btn.innerHTML = icon(action.iconName);
    btn.title = action.title;
    btn.setAttribute("aria-label", action.title);
    btn.addEventListener("click", action.onClick);
    actionsEl.appendChild(btn);
  }
  row.appendChild(actionsEl);

  return row;
}

function renderObjectRows(data, reset) {
  if (reset) {
    els.fileList.innerHTML = "";
    state.stats = { folders: 0, files: 0, bytes: 0 };
    appendParentRow();
  }
  state.stats.folders += data.prefixes.length;
  for (const prefix of data.prefixes) {
    const name = prefix.slice(state.prefix.length).replace(/\/$/, "");
    state.listedItems.push({ key: prefix, isFolder: true });
    els.fileList.appendChild(
      makeRow({
        badgeIcon: "folder",
        badgeClass: "folder",
        name,
        itemKey: prefix,
        isFolder: true,
        checked: state.selected.has(prefix),
        onOpen: () => navigateToPrefix(prefix),
        actions: state.selectMode
          ? []
          : [
              { iconName: "copy", title: "Copy", onClick: () => setClipboard([{ key: prefix, isFolder: true }], false) },
              { iconName: "scissors", title: "Cut", onClick: () => setClipboard([{ key: prefix, isFolder: true }], true) },
              { iconName: "trash", title: "Delete folder", danger: true, onClick: () => deleteFolder(prefix) },
            ],
      })
    );
  }
  for (const obj of data.objects) {
    if (obj.key.endsWith("/")) continue; // folder-marker object, already shown as a folder
    const name = obj.key.slice(state.prefix.length);
    if (!name) continue;
    state.stats.files += 1;
    state.stats.bytes += obj.size || 0;
    state.listedItems.push({ key: obj.key, isFolder: false });
    els.fileList.appendChild(
      makeRow({
        badgeIcon: iconForFileName(name),
        name,
        meta: `${formatSize(obj.size)} · ${formatDate(obj.lastModified)}`,
        itemKey: obj.key,
        isFolder: false,
        checked: state.selected.has(obj.key),
        onOpen: () => openObjectDetail(obj, name),
        actions: state.selectMode
          ? []
          : [
              { iconName: "copy", title: "Copy", onClick: () => setClipboard([{ key: obj.key, isFolder: false }], false) },
              { iconName: "scissors", title: "Cut", onClick: () => setClipboard([{ key: obj.key, isFolder: false }], true) },
            ],
      })
    );
  }
  if (reset && data.prefixes.length === 0 && data.objects.length === 0) {
    els.fileList.appendChild(
      emptyStateNode("inbox", "This folder is empty", "Upload a file or drop one here.")
    );
  }
}

// --- Object actions ------------------------------------------------------------

async function downloadObject(key, name) {
  try {
    const blob = await withStatus(
      state.client.getObjectBlob(state.bucket, key),
      `Downloading ${name}…`
    );
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: name });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    // withStatus already surfaced the error
  }
}

async function deleteObject(key) {
  const ok = await confirmDialog({ title: "Delete file?", message: key });
  if (!ok) return;
  try {
    await withStatus(state.client.deleteObject(state.bucket, key), "Deleting…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function deleteFolder(prefix) {
  const ok = await confirmDialog({
    title: "Delete folder?",
    message: `Everything under ${prefix} will be permanently deleted.`,
  });
  if (!ok) return;
  try {
    await withStatus(
      state.client.deletePrefix(state.bucket, prefix, (n) => setStatus(`Deleted ${n}…`, { loading: true })),
      "Deleting folder…"
    );
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

// --- Object detail & sharing -------------------------------------------------

async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied to clipboard.");
  } catch {
    setStatus("Couldn't copy to clipboard.", { error: true });
  }
}

// --- Object preview & inline text/markdown editing --------------------------

let editorState = null; // { key, mimeType, original, el } while a text/markdown file is open

function isEditorDirty() {
  return !!editorState && editorState.el.value !== editorState.original;
}

function markEditorDirty() {
  const dirty = isEditorDirty();
  els.detailSaveBtn.disabled = !dirty;
  els.detailSaveBtn.classList.toggle("dirty", dirty);
}

async function saveEditor() {
  if (!editorState) return;
  const text = editorState.el.value;
  try {
    await withStatus(
      state.client.putObject(state.bucket, editorState.key, new Blob([text]), editorState.mimeType),
      "Saving…"
    );
    editorState.original = text;
    markEditorDirty();
  } catch {
    // withStatus already surfaced the error
  }
}

async function renderDetailPreview(obj, name) {
  els.detailPreview.innerHTML = "";
  els.detailSaveBtn.hidden = true;
  els.detailSaveBtn.disabled = true;
  els.detailSaveBtn.classList.remove("dirty");
  editorState = null;

  const kind = previewKind(name);
  if (!kind) return;

  if (kind === "image" || kind === "video" || kind === "audio" || kind === "pdf") {
    let url;
    try {
      // A presigned URL lets the browser fetch it directly — native Range
      // requests for video/audio scrubbing, no need to buffer the file in JS.
      url = await state.client.presignedUrl(state.bucket, obj.key, 3600);
    } catch (err) {
      console.error(err);
      return;
    }
    if (kind === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = name;
      els.detailPreview.appendChild(img);
    } else if (kind === "video") {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      els.detailPreview.appendChild(video);
    } else if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      els.detailPreview.appendChild(audio);
    } else {
      const iframe = document.createElement("iframe");
      iframe.className = "pdf-frame";
      iframe.src = url;
      els.detailPreview.appendChild(iframe);
      const fallback = document.createElement("div");
      fallback.className = "preview-fallback";
      fallback.innerHTML = `Not rendering? <a href="${url}" target="_blank" rel="noopener">Open in a new tab</a>.`;
      els.detailPreview.appendChild(fallback);
    }
    return;
  }

  // text / markdown: fetch the object and show it as an editable source,
  // with a rendered-preview toggle for markdown.
  if (isTooLargeForTextPreview(obj.size)) {
    const note = document.createElement("div");
    note.className = "preview-fallback";
    note.textContent = `File is ${formatSize(obj.size)} — too large to preview/edit here. Use Download instead.`;
    els.detailPreview.appendChild(note);
    return;
  }

  let text;
  try {
    const blob = await withStatus(state.client.getObjectBlob(state.bucket, obj.key), "Loading preview…");
    text = await blob.text();
  } catch {
    return; // withStatus already surfaced the error
  }

  const editor = document.createElement("textarea");
  editor.className = "detail-editor";
  editor.value = text;
  editor.spellcheck = false;
  editor.addEventListener("input", markEditorDirty);

  editorState = { key: obj.key, mimeType: mimeForName(name), original: text, el: editor };
  els.detailSaveBtn.hidden = false;

  if (kind === "markdown") {
    const toolbar = document.createElement("div");
    toolbar.className = "preview-toolbar";
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "btn";
    previewBtn.textContent = "Preview";
    const sourceBtn = document.createElement("button");
    sourceBtn.type = "button";
    sourceBtn.className = "btn";
    sourceBtn.textContent = "Source";
    const rendered = document.createElement("div");
    rendered.className = "markdown-preview";

    const showPreview = () => {
      rendered.innerHTML = renderMarkdown(editor.value);
      rendered.hidden = false;
      editor.hidden = true;
      previewBtn.classList.add("active");
      sourceBtn.classList.remove("active");
    };
    const showSource = () => {
      rendered.hidden = true;
      editor.hidden = false;
      sourceBtn.classList.add("active");
      previewBtn.classList.remove("active");
    };
    previewBtn.addEventListener("click", showPreview);
    sourceBtn.addEventListener("click", showSource);
    toolbar.append(previewBtn, sourceBtn);
    els.detailPreview.append(toolbar, rendered, editor);
    showPreview();
  } else {
    els.detailPreview.appendChild(editor);
  }
}

async function closeDetailModal() {
  if (isEditorDirty()) {
    const ok = await confirmDialog({
      title: "Discard changes?",
      message: "Your edits haven't been saved.",
      confirmLabel: "Discard",
    });
    if (!ok) return;
  }
  els.detailModal.close();
}

function openShareMenu(key, name) {
  els.shareModalTitle.textContent = `Share "${name}"`;
  els.shareModal.dataset.key = key;
  els.shareS3Uri.value = state.client.s3Uri(state.bucket, key);
  els.shareHttpUrl.value = state.client.unsignedUrl(state.bucket, key);
  els.shareSignedUrl.value = "";
  els.shareModal.showModal();
}

function openObjectDetail(obj, name) {
  els.detailIcon.innerHTML = icon(iconForFileName(name));
  els.detailName.textContent = name;
  els.detailMeta.innerHTML = "";
  const rows = [
    ["Key", obj.key],
    ["Size", formatSize(obj.size)],
    ["Last modified", formatDate(obj.lastModified) || obj.lastModified || "—"],
  ];
  if (obj.storageClass) rows.push(["Storage class", obj.storageClass]);
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.detailMeta.append(dt, dd);
  }
  els.detailShareBtn.onclick = () => openShareMenu(obj.key, name);
  els.detailDownloadBtn.onclick = () => {
    els.detailModal.close();
    downloadObject(obj.key, name);
  };
  els.detailCopyBtn.onclick = () => {
    els.detailModal.close();
    setClipboard([{ key: obj.key, isFolder: false }], false);
  };
  els.detailMoveBtn.onclick = () => {
    els.detailModal.close();
    setClipboard([{ key: obj.key, isFolder: false }], true);
  };
  els.detailDeleteBtn.onclick = () => {
    els.detailModal.close();
    deleteObject(obj.key);
  };
  els.detailModal.showModal();
  renderDetailPreview(obj, name);
}

async function createFolder() {
  const name = await promptDialog({ title: "New folder", label: "Folder name" });
  if (!name) return;
  const key = state.prefix + name.replace(/\/+$/, "") + "/";
  try {
    await withStatus(state.client.createFolder(state.bucket, key), "Creating folder…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function uploadFiles(files) {
  for (const file of files) {
    const key = state.prefix + file.name;
    try {
      await withStatus(
        state.client.putObject(state.bucket, key, file, file.type || "application/octet-stream"),
        `Uploading ${file.name}…`
      );
    } catch {
      // withStatus already surfaced the error; keep going with remaining files
    }
  }
  await refresh();
}

// --- Drag and drop upload ---------------------------------------------------

els.fileList.addEventListener("dragover", (e) => {
  if (!state.bucket) return;
  e.preventDefault();
  els.fileList.classList.add("drag-over");
});
els.fileList.addEventListener("dragleave", () => els.fileList.classList.remove("drag-over"));
els.fileList.addEventListener("drop", async (e) => {
  e.preventDefault();
  els.fileList.classList.remove("drag-over");
  if (!state.bucket || !e.dataTransfer.files.length) return;
  await uploadFiles(e.dataTransfer.files);
});

// --- Connection modal ----------------------------------------------------------

function openConnectionModal(conn) {
  els.connectionModalTitle.textContent = conn ? "Edit connection" : "Add connection";
  els.connId.value = conn?.id || "";
  els.connBucket.value = conn?.bucket || "";
  els.connAccessKey.value = conn?.accessKeyId || "";
  els.connSecretKey.value = conn?.secretAccessKey || "";
  els.connSecretKey.type = "password";
  els.toggleSecretBtn.innerHTML = icon("eye");
  els.connPrefix.value = conn?.prefix || "";
  els.connName.value = conn?.name && conn.name !== conn.bucket ? conn.name : "";
  els.connRegion.value = conn?.region || "";
  els.connEndpoint.value = conn?.endpoint || "";
  els.connPathStyle.checked = !!conn?.pathStyle;
  els.connDeleteBtn.hidden = !conn;
  setFormStatus("");
  els.connectionModal.showModal();
}

// Bucket names don't encode a region, but the field is still enough to look
// one up (see detectBucketRegion) — do it as soon as the user leaves the
// field so Advanced/Region is already filled in if they open it.
els.connBucket.addEventListener("blur", async () => {
  const bucket = els.connBucket.value.trim();
  if (!bucket || els.connRegion.value.trim()) return;
  els.connRegion.placeholder = "detecting…";
  els.connRegion.value = (await detectBucketRegion(bucket)) || "";
  els.connRegion.placeholder = "auto-detected from bucket";
});

// A trailing slash keeps the prefix a clean folder boundary — required now
// that it doubles as the hard root of browsing (see rootPrefix()).
function normalizePrefix(p) {
  p = p.replace(/^\/+/, "");
  if (p && !p.endsWith("/")) p += "/";
  return p;
}

async function saveConnectionFromForm() {
  const endpoint = els.connEndpoint.value.trim();
  if (endpoint) {
    const granted = await chrome.permissions.request({ origins: [`https://${endpoint}/*`] });
    if (!granted) {
      setFormStatus("Permission for the custom endpoint was not granted.", { error: true });
      return false;
    }
  }

  const bucket = els.connBucket.value.trim();
  let region = els.connRegion.value.trim();
  const conn = {
    id: els.connId.value || newConnectionId(),
    bucket,
    name: els.connName.value.trim() || bucket,
    accessKeyId: els.connAccessKey.value.trim(),
    secretAccessKey: els.connSecretKey.value.trim(),
    prefix: normalizePrefix(els.connPrefix.value.trim()),
    endpoint,
    pathStyle: els.connPathStyle.checked,
  };

  els.connSaveBtn.disabled = true;
  try {
    if (!region && !endpoint) {
      setFormStatus("Detecting region…", { loading: true });
      region = (await detectBucketRegion(bucket)) || "us-east-1";
    }
    conn.region = region || "us-east-1";

    setFormStatus("Checking bucket access…", { loading: true });
    try {
      await new S3Client(conn).listObjects(conn.bucket, conn.prefix, undefined);
    } catch (err) {
      setFormStatus(`Couldn't access that bucket: ${err.message}`, { error: true });
      return false;
    }

    state.connections = await upsertConnection(conn);
    state.activeId = conn.id;
    renderConnectionSelect();
    await onConnectionChanged();
    setFormStatus("");
    return true;
  } finally {
    els.connSaveBtn.disabled = false;
  }
}

async function deleteConnectionById(id) {
  const conn = state.connections.find((c) => c.id === id);
  const ok = await confirmDialog({
    title: "Delete connection?",
    message: `"${conn?.name}" and its stored keys will be removed from this browser.`,
  });
  if (!ok) return;
  state.connections = await deleteConnection(id);
  if (state.activeId === id) state.activeId = state.connections[0]?.id || null;
  renderConnectionSelect();
  renderManageList();
  await onConnectionChanged();
}

// --- Manage modal ----------------------------------------------------------

function renderManageList() {
  els.manageList.innerHTML = "";
  for (const conn of state.connections) {
    const li = document.createElement("li");
    li.className = conn.id === state.activeId ? "active" : "";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.innerHTML = icon("bucket");
    li.appendChild(badge);

    const label = connectionLabel(conn);
    const name = document.createElement("span");
    name.className = "name";
    name.innerHTML =
      !conn.bucket || label === conn.bucket
        ? escapeHtml(label)
        : `${escapeHtml(label)}<small>${escapeHtml(conn.bucket)}</small>`;
    li.appendChild(name);

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.title = "Edit";
    editBtn.setAttribute("aria-label", `Edit ${conn.name}`);
    editBtn.innerHTML = icon("settings");
    editBtn.addEventListener("click", () => openConnectionModal(conn));
    li.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn danger-hover";
    deleteBtn.title = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${conn.name}`);
    deleteBtn.innerHTML = icon("trash");
    deleteBtn.addEventListener("click", () => deleteConnectionById(conn.id));
    li.appendChild(deleteBtn);

    els.manageList.appendChild(li);
  }
  if (state.connections.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No connections yet.";
    els.manageList.appendChild(li);
  }
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename }).then(() => {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

// --- Wiring ----------------------------------------------------------------

els.connectionSelect.addEventListener("change", async (e) => {
  state.activeId = e.target.value;
  await onConnectionChanged();
});
els.addConnBtn.addEventListener("click", () => openConnectionModal(null));
els.connCancelBtn.addEventListener("click", () => els.connectionModal.close());
els.connDeleteBtn.addEventListener("click", async () => {
  const id = els.connId.value;
  els.connectionModal.close();
  if (id) await deleteConnectionById(id);
});
els.toggleSecretBtn.addEventListener("click", () => {
  const show = els.connSecretKey.type === "password";
  els.connSecretKey.type = show ? "text" : "password";
  els.toggleSecretBtn.innerHTML = icon(show ? "eyeOff" : "eye");
});
els.connectionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await saveConnectionFromForm();
  if (ok) els.connectionModal.close();
});
els.connManageAllBtn.addEventListener("click", () => {
  els.connectionModal.close();
  renderManageList();
  els.manageModal.showModal();
});

els.manageBtn.addEventListener("click", () => openConnectionModal(activeConnection()));
els.manageCloseBtn.addEventListener("click", () => els.manageModal.close());
els.exportBtn.addEventListener("click", () => {
  downloadTextFile("s3-viewer-connections.json", exportConnections(state.connections));
});
els.importBtn.addEventListener("click", () => els.importInput.click());
els.importInput.addEventListener("change", async () => {
  const file = els.importInput.files[0];
  if (!file) return;
  try {
    const imported = parseImport(await file.text());
    for (const conn of imported) {
      await upsertConnection(conn);
    }
    state.connections = await getConnections();
    renderConnectionSelect();
    renderManageList();
    setStatus(`Imported ${imported.length} connection(s).`);
  } catch (err) {
    setStatus(err.message, { error: true });
  }
  els.importInput.value = "";
});

els.refreshBtn.addEventListener("click", refresh);
els.loadMoreBtn.addEventListener("click", () => loadMore(false));
els.newFolderBtn.addEventListener("click", createFolder);

els.selectModeBtn.addEventListener("click", () => setSelectMode(!state.selectMode));
els.exitSelectBtn.addEventListener("click", () => setSelectMode(false));
els.selectAllCheckbox.addEventListener("change", () => {
  state.selected = els.selectAllCheckbox.checked
    ? new Map(state.listedItems.map((i) => [i.key, i]))
    : new Map();
  updateSelectionBar();
  syncRowCheckboxes();
});
els.bulkDeleteBtn.addEventListener("click", bulkDelete);
els.bulkCopyBtn.addEventListener("click", () => {
  setClipboard([...state.selected.values()], false);
  setSelectMode(false);
});
els.bulkMoveBtn.addEventListener("click", () => {
  setClipboard([...state.selected.values()], true);
  setSelectMode(false);
});
els.pasteBtn.addEventListener("click", pasteClipboard);
els.clipboardClearBtn.addEventListener("click", () => {
  clearClipboard();
  setStatus("");
});
els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
els.uploadInput.addEventListener("change", async () => {
  const files = [...els.uploadInput.files];
  els.uploadInput.value = "";
  if (files.length) await uploadFiles(files);
});

els.copyS3UriBtn.addEventListener("click", () => copyToClipboard(els.shareS3Uri.value));
els.copyHttpUrlBtn.addEventListener("click", () => copyToClipboard(els.shareHttpUrl.value));
els.copySignedUrlBtn.addEventListener("click", () => copyToClipboard(els.shareSignedUrl.value));
els.generateSignedBtn.addEventListener("click", async () => {
  const key = els.shareModal.dataset.key;
  const expiresIn = Number(els.shareExpiry.value);
  try {
    els.shareSignedUrl.value = await withStatus(
      state.client.presignedUrl(state.bucket, key, expiresIn),
      "Signing…"
    );
    await copyToClipboard(els.shareSignedUrl.value);
  } catch {
    // withStatus already surfaced the error
  }
});
els.shareCloseBtn.addEventListener("click", () => els.shareModal.close());

els.detailSaveBtn.addEventListener("click", saveEditor);
els.detailCloseBtn.addEventListener("click", closeDetailModal);
// Escape triggers the dialog's native "cancel" first — gate it the same way
// as the close button so unsaved edits aren't lost silently.
els.detailModal.addEventListener("cancel", (e) => {
  if (isEditorDirty()) {
    e.preventDefault();
    closeDetailModal();
  }
});

// A click on the backdrop lands on the <dialog> itself (outside its content
// box), so treat that as "close" too — a bigger, more forgiving target than
// the close button alone.
function closeOnBackdropClick(dialog, onRequestClose = () => dialog.close()) {
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) onRequestClose();
  });
}
closeOnBackdropClick(els.detailModal, closeDetailModal);
closeOnBackdropClick(els.shareModal);

loadConnections();
