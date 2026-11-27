"use strict";

// Rewrite Antigravity IDE markers on generation requests so upstream AG 2.x
// backend accepts them. Catalog and other passthrough requests retain the
// client's current identity. Hardcoded MVP — toggle/version configurable later.

// Single source of truth for the impersonated client identity. This module is
// copied verbatim into the standalone/CLI MITM bundle, so it must stay
// import-free — open-sse/providers/shared.js imports FROM here, never the
// reverse.
//
// Official Antigravity Hub Desktop fingerprint captured from macOS arm64.
// Keep this static even when 9router runs on Linux: the provider profile is
// intentionally matching the Hub client, not the server host.
const ANTIGRAVITY_IDE_VERSION = "2.33.0";
const ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED = true;

const ANTIGRAVITY_UA_HUB_PREFIX = "antigravity/hub/";
const ANTIGRAVITY_UA_BARE_PREFIX = "antigravity/";
const ANTIGRAVITY_UA_PLATFORM_SUFFIX = " darwin/arm64";

function buildAntigravityUserAgent(version) {
  return `${ANTIGRAVITY_UA_HUB_PREFIX}${version}${ANTIGRAVITY_UA_PLATFORM_SUFFIX}`;
}

function shouldRewriteMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  if (String(metadata.ideName || "").toLowerCase() === "antigravity") return true;
  if (String(metadata.ideType || "").toUpperCase() === "ANTIGRAVITY") return true;
  return Object.prototype.hasOwnProperty.call(metadata, "ideVersion");
}

// Everything after the version token (e.g. " darwin/arm64") is preserved
// verbatim; an absent suffix yields "".
function trailingSuffix(userAgent, prefix) {
  const rest = userAgent.slice(prefix.length);
  const separatorIndex = rest.indexOf(" ");
  return separatorIndex === -1 ? "" : rest.slice(separatorIndex);
}

function rewriteAntigravityUserAgent(userAgent, version) {
  if (typeof userAgent !== "string") return userAgent;
  // Two branches, not one clever regex: the hub form must re-emit `hub/`
  // while the bare form must not, and no single template can produce both.
  if (userAgent.startsWith(ANTIGRAVITY_UA_HUB_PREFIX)) {
    return `${ANTIGRAVITY_UA_HUB_PREFIX}${version}${trailingSuffix(userAgent, ANTIGRAVITY_UA_HUB_PREFIX)}`;
  }
  if (userAgent.startsWith(ANTIGRAVITY_UA_BARE_PREFIX)) {
    return `${ANTIGRAVITY_UA_BARE_PREFIX}${version}${trailingSuffix(userAgent, ANTIGRAVITY_UA_BARE_PREFIX)}`;
  }
  return userAgent;
}

function applyAntigravityIdeVersionOverride(bodyBuffer, headers, requestUrl) {
  const isGenerationEndpoint = requestUrl?.includes(":generateContent") ||
    requestUrl?.includes(":streamGenerateContent");
  if (!ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED || !isGenerationEndpoint) {
    return { bodyBuffer, headers, applied: false, version: ANTIGRAVITY_IDE_VERSION };
  }

  const nextHeaders = { ...headers };
  const nextUserAgent = rewriteAntigravityUserAgent(nextHeaders["user-agent"], ANTIGRAVITY_IDE_VERSION);
  const userAgentChanged = nextUserAgent !== nextHeaders["user-agent"];
  if (userAgentChanged) nextHeaders["user-agent"] = nextUserAgent;

  try {
    const parsed = JSON.parse(bodyBuffer.toString());
    if (!shouldRewriteMetadata(parsed?.metadata)) {
      return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version: ANTIGRAVITY_IDE_VERSION };
    }

    parsed.metadata.ideVersion = ANTIGRAVITY_IDE_VERSION;
    const nextBodyBuffer = Buffer.from(JSON.stringify(parsed));
    return { bodyBuffer: nextBodyBuffer, headers: nextHeaders, applied: true, version: ANTIGRAVITY_IDE_VERSION };
  } catch {
    return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version: ANTIGRAVITY_IDE_VERSION };
  }
}

module.exports = {
  ANTIGRAVITY_IDE_VERSION,
  applyAntigravityIdeVersionOverride,
  buildAntigravityUserAgent,
  rewriteAntigravityUserAgent,
};
