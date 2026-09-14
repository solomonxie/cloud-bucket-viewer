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

const $ = (id) => document.getElementById(id);

const els = {
  connectionSelect: $("connectionSelect"),
  addConnBtn: $("addConnBtn"),
  manageBtn: $("manageBtn"),
  breadcrumb: $("breadcrumb"),
  refreshBtn: $("refreshBtn"),
  newFolderBtn: $("newFolderBtn"),
  uploadBtn: $("uploadBtn"),
  uploadInput: $("uploadInput"),
  status: $("status"),
  fileList: $("fileList"),
  loadMoreBtn: $("loadMoreBtn"),
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
};

const state = {
  connections: [],
  activeId: null,
  client: null,
  bucket: null,
  prefix: "",
  token: null,
};

// Static icon-only controls: filled in once so sidepanel.html stays markup-only.
els.addConnBtn.innerHTML = icon("plus");
els.manageBtn.innerHTML = icon("settings");
els.refreshBtn.innerHTML = icon("refresh");
els.newFolderBtn.innerHTML = `${icon("folderPlus")}<span>New folder</span>`;
els.uploadBtn.innerHTML = `${icon("upload")}<span>Upload</span>`;
els.toggleSecretBtn.innerHTML = icon("eye");

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
    opt.textContent = conn.name;
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
}

// --- Navigation --------------------------------------------------------------

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = "";
  const conn = activeConnection();
  const crumbs = [];
  if (conn) {
    crumbs.push({ label: conn.name, iconName: "home", action: () => navigateToPrefix(conn.prefix || "") });
    if (conn.bucket) {
      crumbs.push({ label: conn.bucket, iconName: "bucket", action: () => navigateToPrefix("") });
    }
    const parts = state.prefix.split("/").filter(Boolean);
    let acc = "";
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
  state.prefix = prefix;
  state.token = null;
  renderBreadcrumb();
  refresh();
}

// --- Listing -----------------------------------------------------------------

async function refresh() {
  state.token = null;
  els.fileList.innerHTML = "";
  els.loadMoreBtn.hidden = true;
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
  } catch {
    // withStatus already surfaced the error
  }
}

function renderEmptyState(iconName, primary, secondary, action) {
  els.fileList.innerHTML = `
    <div class="empty-state">
      ${icon(iconName)}
      <div class="primary">${escapeHtml(primary)}</div>
      <div>${escapeHtml(secondary)}</div>
    </div>`;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    els.fileList.querySelector(".empty-state").appendChild(btn);
  }
}

function makeRow({ badgeIcon, badgeClass, name, meta, onOpen, actions }) {
  const row = document.createElement("div");
  row.className = "row";

  const badge = document.createElement("span");
  badge.className = badgeClass ? `badge ${badgeClass}` : "badge";
  badge.innerHTML = icon(badgeIcon);
  row.appendChild(badge);

  if (onOpen) {
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
  if (reset) els.fileList.innerHTML = "";
  for (const prefix of data.prefixes) {
    const name = prefix.slice(state.prefix.length).replace(/\/$/, "");
    els.fileList.appendChild(
      makeRow({
        badgeIcon: "folder",
        badgeClass: "folder",
        name,
        onOpen: () => navigateToPrefix(prefix),
        actions: [
          { iconName: "trash", title: "Delete folder", danger: true, onClick: () => deleteFolder(prefix) },
        ],
      })
    );
  }
  for (const obj of data.objects) {
    if (obj.key.endsWith("/")) continue; // folder-marker object, already shown as a folder
    const name = obj.key.slice(state.prefix.length);
    if (!name) continue;
    els.fileList.appendChild(
      makeRow({
        badgeIcon: iconForFileName(name),
        name,
        meta: `${formatSize(obj.size)} · ${formatDate(obj.lastModified)}`,
        actions: [
          { iconName: "download", title: "Download", onClick: () => downloadObject(obj.key, name) },
          { iconName: "copy", title: "Copy to…", onClick: () => copyObject(obj.key) },
          { iconName: "move", title: "Move to…", onClick: () => moveObject(obj.key) },
          { iconName: "trash", title: "Delete", danger: true, onClick: () => deleteObject(obj.key) },
        ],
      })
    );
  }
  if (data.prefixes.length === 0 && data.objects.length === 0) {
    renderEmptyState("inbox", "This folder is empty", "Upload a file or drop one here.");
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

async function copyObject(key) {
  const dest = await promptDialog({
    title: "Copy to…",
    label: "Destination key (full path within this bucket)",
    value: key,
  });
  if (!dest || dest === key) return;
  try {
    await withStatus(state.client.copyObject(state.bucket, dest, state.bucket, key), "Copying…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function moveObject(key) {
  const dest = await promptDialog({
    title: "Move to…",
    label: "Destination key (full path within this bucket)",
    value: key,
  });
  if (!dest || dest === key) return;
  try {
    await withStatus(state.client.moveObject(state.bucket, dest, state.bucket, key), "Moving…");
    await refresh();
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
    prefix: els.connPrefix.value.trim().replace(/^\/+/, ""),
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

    const name = document.createElement("span");
    name.className = "name";
    name.innerHTML =
      conn.name === conn.bucket
        ? escapeHtml(conn.name)
        : `${escapeHtml(conn.name)}<small>${escapeHtml(conn.bucket)}</small>`;
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

els.manageBtn.addEventListener("click", () => {
  renderManageList();
  els.manageModal.showModal();
});
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
els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
els.uploadInput.addEventListener("change", async () => {
  const files = [...els.uploadInput.files];
  els.uploadInput.value = "";
  if (files.length) await uploadFiles(files);
});

loadConnections();
