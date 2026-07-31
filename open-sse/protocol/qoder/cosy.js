/**
 * Qoder COSY (hybrid RSA+AES+MD5) signing, protocol core.
 * Live-validated against intl + QoderWork CN (newline field delimiter).
 *
 * Every signed request carries:
 *   - an AES-128-CBC payload of the user info, the AES key wrapped in RSA
 *   - an MD5 signature over payload, cosyKey, timestamp, body, sigPath
 *     joined with newline (space SEP is rejected upstream as Signature invalid)
 *   - the body's MD5 hash + length so the server can validate integrity
 *   - 17 Cosy-* / X-* headers fingerprinting the client (machine id, IDE
 *     version, organization id, etc.)
 *
 * The on-the-wire header keys use the same casing as qodercli:
 *   Cosy-Machineid, not Cosy-MachineID.
 */

import crypto from "crypto";

import { QODER_RSA_PUBLIC_KEY } from "./constants.js";
import { resolveProfile } from "./profile.js";

// AES-128 wants a 16-byte key. Match qodercli/Veria: take the first 16 chars
// of a fresh UUID's canonical string (hyphens included). The key is fresh
// per request so even though the IV reuses the key bytes, each request still
// has a unique IV.
function generateAesKey() {
  return crypto.randomUUID().slice(0, 16);
}

function pkcs7Pad(data, blockSize) {
  const padding = blockSize - (data.length % blockSize);
  const padded = Buffer.alloc(data.length + padding, padding);
  data.copy(padded, 0);
  return padded;
}

function aesEncryptCbcBase64(plaintext, keyStr) {
  const keyBytes = Buffer.from(keyStr, "utf8");
  if (keyBytes.length !== 16) {
    throw new Error(`aes key must be 16 bytes, got ${keyBytes.length}`);
  }
  const iv = keyBytes.subarray(0, 16);
  const cipher = crypto.createCipheriv("aes-128-cbc", keyBytes, iv);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(Buffer.from(plaintext, "utf8"), 16);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("base64");
}

function rsaEncryptBase64(data) {
  const encrypted = crypto.publicEncrypt(
    { key: QODER_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(data, "utf8"),
  );
  return encrypted.toString("base64");
}

function encryptUserInfo(userInfo) {
  const aesKey = generateAesKey();
  const plaintext = JSON.stringify(userInfo);
  const infoB64 = aesEncryptCbcBase64(plaintext, aesKey);
  const cosyKeyB64 = rsaEncryptBase64(aesKey);
  return { cosyKey: cosyKeyB64, info: infoB64 };
}

function md5Hex(input) {
  return crypto.createHash("md5").update(input).digest("hex");
}

/**
 * Strip the leading "/algo" prefix from the request path. Matches qodercli
 * convention. Empty input returns "".
 */
function computeSigPath(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl).pathname || "";
  } catch {
    return "";
  }
  if (pathname.startsWith("/algo")) {
    return pathname.slice("/algo".length);
  }
  return pathname;
}

/**
 * Generate a fresh machine UUID. Persisted on the connection record so
 * every request from the same auth carries the same machineId.
 */
export function generateMachineId() {
  return crypto.randomUUID();
}

/**
 * Build the full Cosy-* header set for a single Qoder request.
 *
 * @param {Buffer|Uint8Array|string} body  The exact bytes that will be sent.
 *   For GET requests pass an empty Buffer / "".
 * @param {string} requestUrl              Full request URL (used for sigPath).
 * @param {object} creds
 * @param {string} creds.userId            Stable Qoder user id.
 * @param {string} creds.authToken         Device access token (`dt-...`).
 * @param {string} [creds.name]            Display name (optional).
 * @param {string} [creds.email]           Email (optional, can be empty).
 * @param {string} [creds.machineId]       Persisted machine UUID.
 * @param {string} [creds.machineToken]    SecurityGuard UMID; falls back to machineId.
 * @param {import("./profile.js").QoderProfile|string|null} [profile]
 * @returns {Record<string, string>} Header map ready to merge onto fetch().
 */
export function buildCosyHeaders(body, requestUrl, creds, profile = null) {
  if (!creds?.userId) throw new Error("cosy: user id is empty");
  if (!creds?.authToken) throw new Error("cosy: auth token is empty");
  const p = resolveProfile(profile);

  const bodyBuf = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? Buffer.from(body, "latin1")
      : Buffer.from(body || []);

  const { cosyKey, info } = encryptUserInfo({
    uid: creds.userId,
    security_oauth_token: creds.authToken,
    name: creds.name || "",
    aid: "",
    email: creds.email || "",
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = crypto.randomUUID();

  const payloadJson = JSON.stringify({
    version: "v1",
    requestId,
    info,
    cosyVersion: p.ideVersion || "1.0.0",
    // Desktop generateAuthToken uses ideVersion || "1.0.0" (not empty).
    ideVersion: p.ideVersion || "1.0.0",
  });
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64");

  const sigPath = computeSigPath(requestUrl);
  // Live 2026-07-28: both intl (api3.qoder.sh) and CN gateway reject space SEP
  // with HTTP 403 {"code":"101","message":"Signature invalid"}; newline works.
  // Keep one SEP for the whole protocol family (profile only changes hosts/fingerprint).
  const sep = "\n";
  const sigInput = `${payloadB64}${sep}${cosyKey}${sep}${timestamp}${sep}${bodyBuf.toString("latin1")}${sep}${sigPath}`;
  const sig = md5Hex(Buffer.from(sigInput, "latin1"));

  const machineId = creds.machineId || generateMachineId();
  const machineToken = creds.machineToken || machineId;
  const bodyHash = md5Hex(bodyBuf);
  const bodyLength = String(bodyBuf.length);

  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userId,
    "Cosy-Date": timestamp,
    "Cosy-Version": p.ideVersion,
    "Cosy-Machineid": machineId,
    "Cosy-Machinetoken": machineToken,
    "Cosy-Machinetype": p.machineType,
    "Cosy-Machineos": p.machineOs,
    "Cosy-Clienttype": p.clientType,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLength,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": p.dataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": p.loginVersion,
    "X-Request-Id": crypto.randomUUID(),
  };
}
