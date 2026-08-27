// Deployment-level version for fixed-name assets (favicon, PWA icons).
// NEXT_PUBLIC_BUILD_TIME is stamped once per build by next.config.mjs, so the
// URL is stable across every request/render within a deployment but changes on
// each deploy — busting the browser's persistent favicon cache.
export function buildAssetVersion() {
  // ponytail: falls back to "dev" when the build didn't stamp a version;
  // predictable and stable, upgrade path is enforcing the env in CI.
  return String(process.env.NEXT_PUBLIC_BUILD_TIME || "").trim() || "dev";
}

export function versionedAssetUrl(path) {
  return `${path}?v=${encodeURIComponent(buildAssetVersion())}`;
}
