// AWS Signature Version 4 signing, implemented with SubtleCrypto so the
// extension needs no AWS SDK or build step.

const encoder = new TextEncoder();

export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return crypto.subtle.sign("HMAC", cryptoKey, bytes);
}

async function signingKey(secretAccessKey, dateStamp, region, service) {
  const kDate = await hmac(encoder.encode("AWS4" + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
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

// Returns the full header set (including Authorization) to attach to the request.
export async function signRequest({
  method,
  url,
  region,
  service = "s3",
  accessKeyId,
  secretAccessKey,
  headers = {},
  payloadHash,
}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const parsed = new URL(url);
  const canonicalUri = encodePath(decodeURIComponent(parsed.pathname)) || "/";
  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeRFC3986(k)}=${encodeRFC3986(v)}`)
    .join("&");

  const hash = payloadHash || EMPTY_PAYLOAD_HASH;

  const allHeaders = {
    host: parsed.host,
    "x-amz-content-sha256": hash,
    "x-amz-date": amzDate,
    ...headers,
  };

  const sortedKeys = Object.keys(allHeaders)
    .map((k) => k.toLowerCase())
    .sort();
  const lookup = Object.fromEntries(
    Object.keys(allHeaders).map((k) => [k.toLowerCase(), allHeaders[k]])
  );
  const canonicalHeaders = sortedKeys
    .map((k) => `${k}:${String(lookup[k]).trim()}\n`)
    .join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    hash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmac(key, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...allHeaders, Authorization: authorization };
}
