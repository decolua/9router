import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache npm latest lookup for 1h
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_REPOSITORY = "decolua/9router";
const REGISTRIES = [
  { registry: "registry-1.docker.io", auth: "auth.docker.io", service: "registry.docker.io", image: IMAGE_REPOSITORY },
  { registry: "ghcr.io", auth: "ghcr.io", service: "ghcr.io", image: `ghcr.io/${IMAGE_REPOSITORY}` },
];
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
let manifestCheck;

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= { value: null, fetchedAt: 0 });

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

async function getLatestVersionCached() {
  if (versionCache.value && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  const latest = await fetchLatestVersion();
  if (latest) {
    versionCache.value = latest;
    versionCache.fetchedAt = Date.now();
  }
  return latest;
}

async function hasImageManifest({ registry, auth, service }, version) {
  const params = new URLSearchParams({ service, scope: `repository:${IMAGE_REPOSITORY}:pull` });
  const options = { signal: AbortSignal.timeout(4000), cache: "no-store", redirect: "error" };
  try {
    const tokenResponse = await fetch(`https://${auth}/token?${params}`, options);
    if (!tokenResponse.ok) return false;
    const { token } = await tokenResponse.json();
    if (typeof token !== "string" || !token) return false;

    const manifest = await fetch(`https://${registry}/v2/${IMAGE_REPOSITORY}/manifests/${version}`, {
      ...options,
      method: "HEAD",
      headers: { Accept: MANIFEST_TYPES, Authorization: `Bearer ${token}` },
    });
    return manifest.ok;
  } catch {
    return false;
  }
}

function getPublishedImages(version) {
  if (manifestCheck?.version === version && Date.now() < manifestCheck.expiresAt) {
    return manifestCheck.result;
  }
  // The running container cannot tell which registry it was pulled from.
  // Wait for both official tags so an update is available on either channel.
  const result = Promise.all(REGISTRIES.map((registry) => hasImageManifest(registry, version)))
    .then((results) => results.every(Boolean) ? REGISTRIES.map(({ image }) => `${image}:${version}`) : []);
  manifestCheck = { version, expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS, result };
  return result;
}

export async function GET() {
  const latestVersion = await getLatestVersionCached();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  if (process.env.NINEROUTER_INSTALL === "docker") {
    const dockerImages = hasUpdate && /^\d+\.\d+\.\d+$/.test(latestVersion)
      ? await getPublishedImages(latestVersion)
      : [];
    return Response.json({
      currentVersion,
      latestVersion: dockerImages.length ? latestVersion : null,
      hasUpdate: dockerImages.length > 0,
      dockerImages,
    });
  }

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
