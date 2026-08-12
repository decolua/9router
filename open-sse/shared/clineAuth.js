import pkg from "../../package.json" with { type: "json" };

const APP_VERSION = pkg.version || "0.0.0";

export function getClineAccessToken(token) {
  if (typeof token !== "string") return "";
  const trimmed = token.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("workos:") ? trimmed : `workos:${trimmed}`;
}

export function getClineAuthorizationHeader(token) {
  const accessToken = getClineAccessToken(token);
  return accessToken ? `Bearer ${accessToken}` : "";
}

export function buildClineHeaders(token, extraHeaders = {}) {
  const authorization = getClineAuthorizationHeader(token);
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    // Outbound identifier sent to Cline — renamed during the 10router rebrand; wire-visible.
    "User-Agent": `10router/${APP_VERSION}`,
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    // Outbound identifier sent to Cline — renamed during the 10router rebrand; wire-visible.
    "X-CLIENT-TYPE": "10router",
    "X-CLIENT-VERSION": APP_VERSION,
    "X-CORE-VERSION": APP_VERSION,
    "X-IS-MULTIROOT": "false",
    ...extraHeaders,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}
