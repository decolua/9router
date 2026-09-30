/**
 * Qoder COSY (hybrid RSA+AES+MD5) signing, ported from CLIProxyAPIPlus
 * qoder-provider branch (internal/auth/qoder/cosy.go).
 *
 * Every signed request carries:
 *   - an AES-128-CBC payload of the user info, the AES key wrapped in RSA
 *   - an MD5 signature over `payload || cosyKey || timestamp || body || sigPath`
 *   - the body's MD5 hash + length so the server can validate integrity
 *   - 17 Cosy-* / X-* headers fingerprinting the client (machine id, IDE
 *     version, organization id, etc.)
 *
 * The on-the-wire header keys use the same casing as qodercli:
 *   Cosy-Machineid, not Cosy-MachineID.
 */

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

import {
  QODER_CLIENT_TYPE,
  QODER_DATA_POLICY,
  QODER_IDE_VERSION,
  QODER_LOGIN_VERSION,
  QODER_MACHINE_OS,
  QODER_MACHINE_TYPE,
  QODER_RSA_PUBLIC_KEY,
} from "./constants.js";

// AES-128 wants a 16-byte key. Match qodercli/Veria: take the first 16 chars
// of a fresh UUID's canonical string (hyphens included). The key is fresh
// per request so even though the IV reuses the key bytes, each request still
// has a unique IV.
function generateAesKey() {
  return uuidv4().slice(0, 16);
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
  return uuidv4();
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
 * @returns {Record<string, string>} Header map ready to merge onto fetch().
 */
export function buildCosyHeaders(body, requestUrl, creds) {
  if (!creds?.userId) throw new Error("cosy: user id is empty");
  if (!creds?.authToken) throw new Error("cosy: auth token is empty");

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
  const requestId = uuidv4();

  const payloadJson = JSON.stringify({
    version: "v1",
    requestId,
    info,
    cosyVersion: QODER_IDE_VERSION,
    ideVersion: "",
  });
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64");

  const sigPath = computeSigPath(requestUrl);
  const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyBuf.toString("latin1")}\n${sigPath}`;
  const sig = md5Hex(Buffer.from(sigInput, "latin1"));

  const machineId = creds.machineId || generateMachineId();
  const bodyHash = md5Hex(bodyBuf);
  const bodyLength = String(bodyBuf.length);

  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userId,
    "Cosy-Date": timestamp,
    "Cosy-Version": QODER_IDE_VERSION,
    "Cosy-Machineid": machineId,
    "Cosy-Machinetoken": machineId,
    "Cosy-Machinetype": QODER_MACHINE_TYPE,
    "Cosy-Machineos": QODER_MACHINE_OS,
    "Cosy-Clienttype": QODER_CLIENT_TYPE,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLength,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QODER_DATA_POLICY,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QODER_LOGIN_VERSION,
    "X-Request-Id": uuidv4(),
  };
}
