#!/usr/bin/env bun
/**
 * Reads version info from installed Antigravity.app and updates ANTIGRAVITY_HEADERS in constants.js
 *
 * Usage: bun open-sse/scripts/update-antigravity.js
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = resolve(__dirname, "../config/constants.js");
const APP_PATH = "/Applications/Antigravity.app";
const APP_RESOURCES = `${APP_PATH}/Contents/Resources/app`;

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function getAppVersion() {
  // VS Code base version from package.json
  const pkg = `${APP_RESOURCES}/package.json`;
  if (!existsSync(pkg)) return null;
  const { version } = JSON.parse(readFileSync(pkg, "utf-8"));
  return version;
}

function getNodeVersion() {
  // Node.js engine version from package.json
  const pkg = `${APP_RESOURCES}/package.json`;
  if (!existsSync(pkg)) return null;
  const { engines } = JSON.parse(readFileSync(pkg, "utf-8"));
  return engines?.node || null;
}

function getGoogleAuthVersion() {
  const pkg = `${APP_RESOURCES}/node_modules/google-auth-library/package.json`;
  if (!existsSync(pkg)) return null;
  const { version } = JSON.parse(readFileSync(pkg, "utf-8"));
  return version;
}

function getConnectRpcVersion() {
  const pkg = `${APP_RESOURCES}/node_modules/@connectrpc/connect/package.json`;
  if (!existsSync(pkg)) return null;
  const { version } = JSON.parse(readFileSync(pkg, "utf-8"));
  return version;
}

// --- Main ---
if (!existsSync(APP_PATH)) {
  console.error("Antigravity.app not found at", APP_PATH);
  process.exit(1);
}

const appVersion = getAppVersion();
const nodeVersion = getNodeVersion();
const authVersion = getGoogleAuthVersion();
const connectVersion = getConnectRpcVersion();

if (!appVersion) {
  console.error("Could not read Antigravity app version");
  process.exit(1);
}

console.log("Detected versions:");
console.log(`  App (VS Code base): ${appVersion}`);
console.log(`  Node.js engine:     ${nodeVersion}`);
console.log(`  google-auth-library: ${authVersion}`);
console.log(`  @connectrpc/connect: ${connectVersion}`);

// Build new header values
const newClientVersion = appVersion;
const newGoogApiClient = [
  nodeVersion ? `gl-node/${nodeVersion}` : null,
  authVersion ? `auth/${authVersion}` : null,
  connectVersion ? `connectrpc/${connectVersion}` : null,
].filter(Boolean).join(" ");

// Read and update constants.js
let content = readFileSync(CONSTANTS_PATH, "utf-8");
const original = content;

// Update X-Client-Version
content = content.replace(
  /("X-Client-Version":\s*")([^"]+)(")/,
  `$1${newClientVersion}$3`
);

// Update x-goog-api-client
content = content.replace(
  /("x-goog-api-client":\s*")([^"]+)(")/,
  `$1${newGoogApiClient}$3`
);

// Update User-Agent version prefix (antigravity/X.Y.Z)
content = content.replace(
  /(["'`]antigravity\/)[\d.]+(\s)/,
  `$1${newClientVersion}$2`
);

// Update the comment too
content = content.replace(
  /(\/\/\s*"antigravity\/)[\d.]+(\s)/,
  `$1${newClientVersion}$2`
);

if (content === original) {
  console.log("\nNo changes needed — constants.js already up to date.");
} else {
  writeFileSync(CONSTANTS_PATH, content);
  console.log("\nUpdated constants.js:");
  console.log(`  X-Client-Version:  ${newClientVersion}`);
  console.log(`  x-goog-api-client: ${newGoogApiClient}`);
  console.log(`  User-Agent:        antigravity/${newClientVersion} ...`);
}
