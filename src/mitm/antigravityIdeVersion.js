"use strict";

// Rewrite Antigravity IDE markers so upstream AG 2.x backend accepts the request.
// User-Agent header (antigravity/<old>) and body.metadata.ideVersion are forced
// to a known-good IDE version. Reads installed /opt/Antigravity/resources/app/product.json
// ideVersion dynamically, falling back to 1.23.2.

const { getAntigravityIdeVersion } = require("./antigravityClientIdentity.cjs");
const ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED = true;

function getOverrideVersion() {
  return getAntigravityIdeVersion();
}

function shouldRewriteMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  if (String(metadata.ideName || "").toLowerCase() === "antigravity") return true;
  if (String(metadata.ideType || "").toUpperCase() === "ANTIGRAVITY") return true;
  return Object.prototype.hasOwnProperty.call(metadata, "ideVersion");
}

function rewriteAntigravityUserAgent(userAgent, version) {
  if (typeof userAgent !== "string" || !userAgent.includes("antigravity/")) return userAgent;
  return userAgent.replace(/antigravity\/[^\s]+/, `antigravity/${version}`);
}

function applyAntigravityIdeVersionOverride(bodyBuffer, headers) {
  const version = getOverrideVersion();
  if (!ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED) {
    return { bodyBuffer, headers, applied: false, version };
  }

  const nextHeaders = { ...headers };
  const nextUserAgent = rewriteAntigravityUserAgent(nextHeaders["user-agent"], version);
  const userAgentChanged = nextUserAgent !== nextHeaders["user-agent"];
  if (userAgentChanged) nextHeaders["user-agent"] = nextUserAgent;

  try {
    const parsed = JSON.parse(bodyBuffer.toString());
    if (!shouldRewriteMetadata(parsed?.metadata)) {
      return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version };
    }

    parsed.metadata.ideVersion = version;
    const nextBodyBuffer = Buffer.from(JSON.stringify(parsed));
    return { bodyBuffer: nextBodyBuffer, headers: nextHeaders, applied: true, version };
  } catch {
    return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version };
  }
}

module.exports = {
  applyAntigravityIdeVersionOverride,
  rewriteAntigravityUserAgent,
};
