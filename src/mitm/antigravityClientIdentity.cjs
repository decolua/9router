"use strict";

const fs = require("fs");
const os = require("os");

const FALLBACK_ANTIGRAVITY_IDE_VERSION = "1.23.2";
const DEFAULT_PRODUCT_JSON_PATHS = ["/opt/Antigravity/resources/app/product.json"];
let cachedIdeVersion = null;

function isSemverLike(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.trim());
}

function productJsonPaths() {
  return process.env.ANTIGRAVITY_PRODUCT_JSON
    ? [process.env.ANTIGRAVITY_PRODUCT_JSON]
    : DEFAULT_PRODUCT_JSON_PATHS;
}

function readInstalledAntigravityIdeVersion() {
  for (const filePath of productJsonPaths()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (isSemverLike(parsed && parsed.ideVersion)) return parsed.ideVersion.trim();
    } catch {}
  }
  return null;
}

function getAntigravityIdeVersion() {
  if (cachedIdeVersion) return cachedIdeVersion;
  cachedIdeVersion = readInstalledAntigravityIdeVersion() || FALLBACK_ANTIGRAVITY_IDE_VERSION;
  return cachedIdeVersion;
}

function getAntigravityUserAgent() {
  return `antigravity/${getAntigravityIdeVersion()} ${os.platform()}/${os.arch()}`;
}

module.exports = {
  FALLBACK_ANTIGRAVITY_IDE_VERSION,
  readInstalledAntigravityIdeVersion,
  getAntigravityIdeVersion,
  getAntigravityUserAgent,
};
