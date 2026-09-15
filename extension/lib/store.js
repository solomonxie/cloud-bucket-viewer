// Connections (name + keys) are stored only in chrome.storage.local — never
// synced, never sent anywhere except directly to the S3 endpoint they name.

const CONNECTIONS_KEY = "connections";

export async function getConnections() {
  const { [CONNECTIONS_KEY]: connections = [] } = await chrome.storage.local.get(
    CONNECTIONS_KEY
  );
  // Self-heal: earlier versions of the connection form could leave behind
  // entries with neither a name nor a bucket (nothing to identify or browse
  // with) — prune those from storage itself instead of showing blank rows.
  const valid = connections.filter((c) => c.bucket || c.name);
  if (valid.length !== connections.length) await saveConnections(valid);
  return valid;
}

async function saveConnections(connections) {
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
  return connections;
}

export async function upsertConnection(conn) {
  const connections = await getConnections();
  const idx = connections.findIndex((c) => c.id === conn.id);
  if (idx >= 0) connections[idx] = conn;
  else connections.push(conn);
  return saveConnections(connections);
}

export async function deleteConnection(id) {
  const connections = (await getConnections()).filter((c) => c.id !== id);
  return saveConnections(connections);
}

export function exportConnections(connections) {
  return JSON.stringify({ version: 1, connections }, null, 2);
}

export function parseImport(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.connections)) {
    throw new Error("Invalid file: expected a top-level \"connections\" array");
  }
  return data.connections;
}

export function newConnectionId() {
  return crypto.randomUUID();
}
