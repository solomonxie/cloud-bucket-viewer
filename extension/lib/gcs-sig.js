// Google Cloud Storage auth via a service account JSON key — the
// non-interactive credential GCP's own client libraries take, reimplemented
// with SubtleCrypto so the extension needs no Google SDK.
//
// Two distinct signing needs:
// - API calls (list/get/put/delete/copy) authenticate with a short-lived
//   OAuth2 access token, obtained via the JWT Bearer Token flow (RFC 7523):
//   sign a JWT with the service account's RSA private key, exchange it for
//   a token — server-to-server, no browser consent screen.
// - Share links use a GOOG4-RSA-SHA256 V4 signed URL (`signedUrlV4`),
//   signed directly with the same private key — the GCS equivalent of an
//   S3 presigned URL/Azure SAS.

const encoder = new TextEncoder();
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64url(input) {
  const bytes = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function fetchAccessToken(serviceAccount) {
  const key = await importPrivateKey(serviceAccount.private_key);
  const now = Math.floor(Date.now() / 1000);
  const aud = serviceAccount.token_uri || TOKEN_URI;
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: serviceAccount.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const resp = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${resp.status} ${body}`);
  }
  const data = await resp.json();
  return { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
}

// One cached token per service account (by client_email) — every client
// method needs one, refreshed a minute before it actually expires.
const tokenCache = new Map();

export async function getAccessToken(serviceAccount) {
  const cached = tokenCache.get(serviceAccount.client_email);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  const fresh = await fetchAccessToken(serviceAccount);
  tokenCache.set(serviceAccount.client_email, fresh);
  return fresh.accessToken;
}

function encodeRFC3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodePath(path) {
  return path.split("/").map(encodeRFC3986).join("/");
}

// GOOG4-RSA-SHA256 V4 signed URL — structurally the same as AWS SigV4
// query-string presigning (see sigv4.js#presignUrl), but RSA-signed with
// the service account's private key instead of an HMAC secret, and always
// scoped to the pseudo-region "auto". GET only, matching how Share links
// are used here.
export async function signedUrlV4({ serviceAccount, bucket, object, method = "GET", expiresIn = 3600 }) {
  const key = await importPrivateKey(serviceAccount.private_key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/storage/goog4_request`;

  const host = "storage.googleapis.com";
  const canonicalUri = encodePath(`/${bucket}/${object}`) || "/";
  const url = new URL(`https://${host}${canonicalUri}`);
  url.searchParams.set("X-Goog-Algorithm", "GOOG4-RSA-SHA256");
  url.searchParams.set("X-Goog-Credential", `${serviceAccount.client_email}/${credentialScope}`);
  url.searchParams.set("X-Goog-Date", amzDate);
  url.searchParams.set("X-Goog-Expires", String(expiresIn));
  url.searchParams.set("X-Goog-SignedHeaders", "host");

  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeRFC3986(k)}=${encodeRFC3986(v)}`)
    .join("&");
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "GOOG4-RSA-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = toHex(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(stringToSign)));
  url.searchParams.set("X-Goog-Signature", signature);
  return url.toString();
}
