const DEFAULT_NINE_REMOTE_URL = "http://localhost:2208";

function trimTrailingSlash(url) {
  return typeof url === "string" ? url.replace(/\/+$/, "") : "";
}

export function isNineRemoteEnabled() {
  return process.env.NINE_REMOTE_ENABLED === "true"
    || process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED === "true";
}

export function getNineRemotePublicUrl() {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_NINE_REMOTE_URL || DEFAULT_NINE_REMOTE_URL
  );
}

export function getNineRemoteServerUrl() {
  return trimTrailingSlash(
    process.env.NINE_REMOTE_URL
    || process.env.NEXT_PUBLIC_NINE_REMOTE_URL
    || DEFAULT_NINE_REMOTE_URL
  );
}
