import { S3Client, formatSize } from "./lib/s3-client.js";
import {
  getConnections,
  upsertConnection,
  deleteConnection,
  exportConnections,
  parseImport,
  newConnectionId,
} from "./lib/store.js";

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
  connName: $("connName"),
  connAccessKey: $("connAccessKey"),
  connSecretKey: $("connSecretKey"),
  connRegion: $("connRegion"),
  connEndpoint: $("connEndpoint"),
  connPathStyle: $("connPathStyle"),
  connDeleteBtn: $("connDeleteBtn"),
  connCancelBtn: $("connCancelBtn"),
  manageModal: $("manageModal"),
  manageList: $("manageList"),
  importBtn: $("importBtn"),
  exportBtn: $("exportBtn"),
  importInput: $("importInput"),
  manageCloseBtn: $("manageCloseBtn"),
};

const state = {
  connections: [],
  activeId: null,
  client: null,
  bucket: null,
  prefix: "",
  token: null,
};

function activeConnection() {
  return state.connections.find((c) => c.id === state.activeId) || null;
}

function setStatus(message, isError = false) {
  els.status.textContent = message || "";
  els.status.hidden = !message;
  els.status.classList.toggle("error", isError);
}

async function withStatus(promise, busyMessage) {
  setStatus(busyMessage);
  try {
    const result = await promise;
    setStatus("");
    return result;
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
    throw err;
  }
}

// --- Connections ---------------------------------------------------------

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
  state.bucket = null;
  state.prefix = "";
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

// --- Navigation ------------------------------------------------------------

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = "";
  const conn = activeConnection();
  const crumbs = [{ label: conn ? conn.name : "—", action: () => navigateToBuckets() }];
  if (state.bucket) {
    crumbs.push({ label: state.bucket, action: () => navigateToPrefix("") });
    const parts = state.prefix.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += part + "/";
      const target = acc;
      crumbs.push({ label: part, action: () => navigateToPrefix(target) });
    }
  }
  crumbs.forEach((crumb, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = " / ";
      els.breadcrumb.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.textContent = crumb.label;
    btn.addEventListener("click", crumb.action);
    els.breadcrumb.appendChild(btn);
  });
}

function navigateToBuckets() {
  state.bucket = null;
  state.prefix = "";
  state.token = null;
  updateToolbar();
  renderBreadcrumb();
  refresh();
}

function navigateToBucket(name) {
  state.bucket = name;
  state.prefix = "";
  state.token = null;
  updateToolbar();
  renderBreadcrumb();
  refresh();
}

function navigateToPrefix(prefix) {
  state.prefix = prefix;
  state.token = null;
  renderBreadcrumb();
  refresh();
}

// --- Listing ---------------------------------------------------------------

async function refresh() {
  state.token = null;
  els.fileList.innerHTML = "";
  els.loadMoreBtn.hidden = true;
  if (!state.client) return;
  await loadMore(true);
}

async function loadMore(reset = false) {
  if (!state.client) return;
  try {
    if (!state.bucket) {
      const buckets = await withStatus(state.client.listBuckets(), "Loading buckets…");
      renderBucketRows(buckets, reset);
      els.loadMoreBtn.hidden = true;
      return;
    }
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

function makeRow({ icon, name, meta, onOpen, actions }) {
  const row = document.createElement("div");
  row.className = "row";

  const iconEl = document.createElement("span");
  iconEl.className = "icon";
  iconEl.textContent = icon;
  row.appendChild(iconEl);

  if (onOpen) {
    const btn = document.createElement("button");
    btn.className = "name-btn";
    btn.textContent = name;
    btn.addEventListener("click", onOpen);
    row.appendChild(btn);
  } else {
    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = name;
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
    btn.className = "link";
    btn.textContent = action.label;
    btn.title = action.title || action.label;
    btn.addEventListener("click", action.onClick);
    actionsEl.appendChild(btn);
  }
  row.appendChild(actionsEl);

  return row;
}

function renderBucketRows(buckets, reset) {
  if (reset) els.fileList.innerHTML = "";
  for (const bucket of buckets) {
    els.fileList.appendChild(
      makeRow({
        icon: "\u{1F5C2}",
        name: bucket.name,
        onOpen: () => navigateToBucket(bucket.name),
      })
    );
  }
  if (buckets.length === 0) setStatus("No buckets found for this connection.");
}

function renderObjectRows(data, reset) {
  if (reset) els.fileList.innerHTML = "";
  for (const prefix of data.prefixes) {
    const name = prefix.slice(state.prefix.length).replace(/\/$/, "");
    els.fileList.appendChild(
      makeRow({
        icon: "\u{1F4C1}",
        name,
        onOpen: () => navigateToPrefix(prefix),
        actions: [
          { label: "Del", title: "Delete folder", onClick: () => deleteFolder(prefix) },
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
        icon: "\u{1F4C4}",
        name,
        meta: formatSize(obj.size),
        actions: [
          { label: "Get", title: "Download", onClick: () => downloadObject(obj.key, name) },
          { label: "Cp", title: "Copy to…", onClick: () => copyObject(obj.key) },
          { label: "Mv", title: "Move to…", onClick: () => moveObject(obj.key) },
          { label: "Del", title: "Delete", onClick: () => deleteObject(obj.key) },
        ],
      })
    );
  }
  if (data.prefixes.length === 0 && data.objects.length === 0) {
    setStatus("This folder is empty.");
  }
}

// --- Object actions ---------------------------------------------------------

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

function promptDestinationKey(currentKey) {
  return window.prompt("Destination key (full path within this bucket):", currentKey);
}

async function copyObject(key) {
  const dest = promptDestinationKey(key);
  if (!dest || dest === key) return;
  try {
    await withStatus(state.client.copyObject(state.bucket, dest, state.bucket, key), "Copying…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function moveObject(key) {
  const dest = promptDestinationKey(key);
  if (!dest || dest === key) return;
  try {
    await withStatus(state.client.moveObject(state.bucket, dest, state.bucket, key), "Moving…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function deleteObject(key) {
  if (!window.confirm(`Delete ${key}?`)) return;
  try {
    await withStatus(state.client.deleteObject(state.bucket, key), "Deleting…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function deleteFolder(prefix) {
  if (!window.confirm(`Delete everything under ${prefix}? This cannot be undone.`)) return;
  try {
    await withStatus(
      state.client.deletePrefix(state.bucket, prefix, (n) => setStatus(`Deleted ${n}…`)),
      "Deleting folder…"
    );
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function createFolder() {
  const name = window.prompt("New folder name:");
  if (!name) return;
  const key = state.prefix + name.replace(/\/+$/, "") + "/";
  try {
    await withStatus(state.client.createFolder(state.bucket, key), "Creating folder…");
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

async function uploadFile(file) {
  const key = state.prefix + file.name;
  try {
    await withStatus(
      state.client.putObject(state.bucket, key, file, file.type || "application/octet-stream"),
      `Uploading ${file.name}…`
    );
    await refresh();
  } catch {
    // withStatus already surfaced the error
  }
}

// --- Connection modal --------------------------------------------------------

function openConnectionModal(conn) {
  els.connectionModalTitle.textContent = conn ? "Edit connection" : "Add connection";
  els.connId.value = conn?.id || "";
  els.connName.value = conn?.name || "";
  els.connAccessKey.value = conn?.accessKeyId || "";
  els.connSecretKey.value = conn?.secretAccessKey || "";
  els.connRegion.value = conn?.region || "us-east-1";
  els.connEndpoint.value = conn?.endpoint || "";
  els.connPathStyle.checked = !!conn?.pathStyle;
  els.connDeleteBtn.hidden = !conn;
  els.connectionModal.showModal();
}

async function saveConnectionFromForm() {
  const endpoint = els.connEndpoint.value.trim();
  if (endpoint) {
    const granted = await chrome.permissions.request({ origins: [`https://${endpoint}/*`] });
    if (!granted) {
      setStatus("Permission for the custom endpoint was not granted.", true);
      return false;
    }
  }
  const conn = {
    id: els.connId.value || newConnectionId(),
    name: els.connName.value.trim(),
    accessKeyId: els.connAccessKey.value.trim(),
    secretAccessKey: els.connSecretKey.value.trim(),
    region: els.connRegion.value.trim() || "us-east-1",
    endpoint,
    pathStyle: els.connPathStyle.checked,
  };
  state.connections = await upsertConnection(conn);
  state.activeId = conn.id;
  renderConnectionSelect();
  await onConnectionChanged();
  return true;
}

async function deleteActiveFormConnection() {
  const id = els.connId.value;
  if (!id || !window.confirm("Delete this connection?")) return;
  state.connections = await deleteConnection(id);
  state.activeId = state.connections[0]?.id || null;
  renderConnectionSelect();
  els.connectionModal.close();
  await onConnectionChanged();
}

// --- Manage modal --------------------------------------------------------

function renderManageList() {
  els.manageList.innerHTML = "";
  for (const conn of state.connections) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = conn.name;
    li.appendChild(name);
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openConnectionModal(conn));
    li.appendChild(editBtn);
    els.manageList.appendChild(li);
  }
  if (state.connections.length === 0) {
    const li = document.createElement("li");
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

// --- Wiring --------------------------------------------------------------

els.connectionSelect.addEventListener("change", async (e) => {
  state.activeId = e.target.value;
  await onConnectionChanged();
});
els.addConnBtn.addEventListener("click", () => openConnectionModal(null));
els.connCancelBtn.addEventListener("click", () => els.connectionModal.close());
els.connDeleteBtn.addEventListener("click", deleteActiveFormConnection);
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
    setStatus(err.message, true);
  }
  els.importInput.value = "";
});

els.refreshBtn.addEventListener("click", refresh);
els.loadMoreBtn.addEventListener("click", () => loadMore(false));
els.newFolderBtn.addEventListener("click", createFolder);
els.uploadBtn.addEventListener("click", () => els.uploadInput.click());
els.uploadInput.addEventListener("change", async () => {
  const file = els.uploadInput.files[0];
  els.uploadInput.value = "";
  if (file) await uploadFile(file);
});

loadConnections();
