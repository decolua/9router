/**
 * Cursor Checksum Utility (Jyh Cipher)
 */

import crypto from "crypto";
import { v5 as uuidv5 } from "uuid";

/**
 * Generate SHA-256 hash like generateHashed64Hex
 */
export function generateHashed64Hex(input: string, salt: string = ""): string {
  return crypto.createHash("sha256").update(input + salt).digest("hex");
}

/**
 * Generate session ID using UUID v5 with DNS namespace
 */
export function generateSessionId(authToken: string): string {
  return uuidv5(authToken, uuidv5.DNS);
}

/**
 * Generate cursor checksum (Jyh cipher)
 */
export function generateCursorChecksum(machineId: string): string {
  const timestamp = Math.floor(Date.now() / 1000000);

  const byteArray = new Uint8Array([
    (timestamp >> 40) & 0xFF,
    (timestamp >> 32) & 0xFF,
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF
  ]);

  // Jyh cipher obfuscation
  let t = 165;
  for (let i = 0; i < byteArray.length; i++) {
    byteArray[i] = ((byteArray[i] ^ t) + (i % 256)) & 0xFF;
    t = byteArray[i];
  }

  // URL-safe base64 encode (without padding)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";

  for (let i = 0; i < byteArray.length; i += 3) {
    const a = byteArray[i];
    const b = i + 1 < byteArray.length ? byteArray[i + 1] : 0;
    const c = i + 2 < byteArray.length ? byteArray[i + 2] : 0;

    encoded += alphabet[a >> 2];
    encoded += alphabet[((a & 3) << 4) | (b >> 4)];

    if (i + 1 < byteArray.length) {
      encoded += alphabet[((b & 15) << 2) | (c >> 6)];
    }
    if (i + 2 < byteArray.length) {
      encoded += alphabet[c & 63];
    }
  }

  return `${encoded}${machineId}`;
}

/**
 * Build all Cursor API headers
 */
export function buildCursorHeaders(accessToken: string, machineId: string | null = null, ghostMode: boolean = true): Record<string, string> {
  // Clean token if it has prefix
  const cleanToken = accessToken.includes("::")
    ? accessToken.split("::")[1]
    : accessToken;

  // Generate machine ID if not provided
  const effectiveMachineId = machineId || generateHashed64Hex(cleanToken, "machineId");

  // Generate derived values
  const sessionId = generateSessionId(cleanToken);
  const clientKey = generateHashed64Hex(cleanToken);
  const checksum = generateCursorChecksum(effectiveMachineId);

  // Detect OS
  let os = "linux";
  if (typeof process !== "undefined") {
    if (process.platform === "win32") os = "windows";
    else if (process.platform === "darwin") os = "macos";
  }

  // Detect architecture
  let arch = "x64";
  if (typeof process !== "undefined") {
    if (process.arch === "arm64") arch = "aarch64";
  }

  return {
    "authorization": `Bearer ${cleanToken}`,
    "connect-accept-encoding": "gzip",
    "connect-protocol-version": "1",
    "content-type": "application/connect+proto",
    "user-agent": "connect-es/1.6.1",
    "x-amzn-trace-id": `Root=${crypto.randomUUID()}`,
    "x-client-key": clientKey,
    "x-cursor-checksum": checksum,
    "x-cursor-client-version": "3.1.0",
    "x-cursor-client-type": "ide",
    "x-cursor-client-os": os,
    "x-cursor-client-arch": arch,
    "x-cursor-client-device-type": "desktop",
    "x-cursor-config-version": crypto.randomUUID(),
    "x-cursor-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    "x-ghost-mode": ghostMode ? "true" : "false",
    "x-request-id": crypto.randomUUID(),
    "x-session-id": sessionId
  };
}

const cursorChecksum = {
  generateCursorChecksum,
  buildCursorHeaders,
  generateHashed64Hex,
  generateSessionId
};

export default cursorChecksum;
