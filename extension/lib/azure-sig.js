// Azure Blob Storage "Shared Key" request signing, and Service SAS
// query-string signing for presigned links — HMAC-SHA256 via SubtleCrypto,
// no SDK, matching the S3 signer's approach (see sigv4.js).

const encoder = new TextEncoder();
export const API_VERSION = "2021-08-06";

async function hmacSha256Base64(base64Key, data) {
  const keyBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function canonicalizedHeaders(headers) {
  const msHeaders = Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-ms-"))
    .map(([k, v]) => [k.toLowerCase(), String(v).trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return msHeaders.map(([k, v]) => `${k}:${v}\n`).join("");
}

function canonicalizedResource(accountName, url) {
  const parsed = new URL(url);
  let resource = `/${accountName}${decodeURIComponent(parsed.pathname)}`;
  const params = new Map();
  for (const [k, v] of parsed.searchParams.entries()) {
    const key = k.toLowerCase();
    params.set(key, params.has(key) ? `${params.get(key)},${v}` : v);
  }
  for (const key of [...params.keys()].sort()) {
    resource += `\n${key}:${params.get(key)}`;
  }
  return resource;
}

// Returns the full header set (including Authorization) to attach to the
// request. `contentLength` is the body's byte length, kept separate from
// `headers` — Content-Length isn't settable on a fetch() request (forbidden
// header name), but it's a required, signed field: the browser sends the
// real length automatically, and it has to match what we signed.
export async function signRequest({ method, url, accountName, accountKey, headers = {}, contentLength }) {
  const allHeaders = {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": API_VERSION,
    ...headers,
  };

  const stringToSign =
    [
      method,
      allHeaders["content-encoding"] || "",
      allHeaders["content-language"] || "",
      contentLength ? String(contentLength) : "",
      allHeaders["content-md5"] || "",
      allHeaders["content-type"] || "",
      "", // Date — empty, x-ms-date is used instead
      allHeaders["if-modified-since"] || "",
      allHeaders["if-match"] || "",
      allHeaders["if-none-match"] || "",
      allHeaders["if-unmodified-since"] || "",
      allHeaders["range"] || "",
    ].join("\n") +
    "\n" +
    canonicalizedHeaders(allHeaders) +
    canonicalizedResource(accountName, url);

  const signature = await hmacSha256Base64(accountKey, stringToSign);
  return { ...allHeaders, Authorization: `SharedKey ${accountName}:${signature}` };
}

// Service SAS, read-only (signedPermissions "r") and query-string signed —
// the Azure equivalent of an S3 presigned URL. `container`/`blob` are the
// raw (un-percent-encoded) names, matching how Azure defines the resource
// string.
export async function presignUrl({ url, accountName, accountKey, container, blob, expiresIn = 3600 }) {
  const expiry = new Date(Date.now() + expiresIn * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const resource = `/blob/${accountName}/${container}/${blob}`;

  const stringToSign = [
    "r", // signed permissions
    "", // signed start
    expiry, // signed expiry
    resource, // canonicalized resource
    "", // signed identifier
    "", // signed IP
    "https", // signed protocol
    API_VERSION, // signed version
    "b", // signed resource (blob)
    "", // signed snapshot time
    "", // signed encryption scope
    "", // rscc
    "", // rscd
    "", // rsce
    "", // rscl
    "", // rsct
  ].join("\n");

  const signature = await hmacSha256Base64(accountKey, stringToSign);
  const parsed = new URL(url);
  parsed.searchParams.set("sv", API_VERSION);
  parsed.searchParams.set("sr", "b");
  parsed.searchParams.set("sp", "r");
  parsed.searchParams.set("se", expiry);
  parsed.searchParams.set("spr", "https");
  parsed.searchParams.set("sig", signature);
  return parsed.toString();
}
