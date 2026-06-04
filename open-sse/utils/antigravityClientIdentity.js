import fs from "fs";
import { arch, platform } from "os";

export const FALLBACK_ANTIGRAVITY_IDE_VERSION = "1.23.2";

const DEFAULT_PRODUCT_JSON_PATHS = [
  "/opt/Antigravity/resources/app/product.json",
];

let cachedIdeVersion = null;

function isSemverLike(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.trim());
}

function productJsonPaths() {
  const override = process.env.ANTIGRAVITY_PRODUCT_JSON;
  return override ? [override] : DEFAULT_PRODUCT_JSON_PATHS;
}

export function readInstalledAntigravityIdeVersion() {
  for (const filePath of productJsonPaths()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const ideVersion = parsed?.ideVersion;
      if (isSemverLike(ideVersion)) return ideVersion.trim();
    } catch {
      // Missing/unreadable product.json is expected on non-Antigravity hosts.
    }
  }
  return null;
}

export function getAntigravityIdeVersion() {
  if (cachedIdeVersion) return cachedIdeVersion;
  cachedIdeVersion = readInstalledAntigravityIdeVersion() || FALLBACK_ANTIGRAVITY_IDE_VERSION;
  return cachedIdeVersion;
}

export function getAntigravityUserAgent() {
  return `antigravity/${getAntigravityIdeVersion()} ${platform()}/${arch()}`;
}

export function getAntigravityMetadata(existing = {}) {
  return {
    ...existing,
    ideVersion: getAntigravityIdeVersion(),
  };
}

export function resetAntigravityClientIdentityCacheForTests() {
  cachedIdeVersion = null;
}
