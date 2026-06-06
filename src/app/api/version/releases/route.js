import pkg from "../../../../../package.json" with { type: "json" };
import { GITHUB_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";

function compareVersions(a, b) {
  const parse = (value) => {
    const [main, pre] = String(value).replace(/^v/i, "").split("-");
    const parts = main.split(".").map((part) => {
      const num = Number.parseInt(part, 10);
      return Number.isFinite(num) ? num : 0;
    });
    return { parts, pre };
  };

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.parts[index] || 0;
    const rightPart = right.parts[index] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  if (left.pre && !right.pre) return -1;
  if (!left.pre && right.pre) return 1;
  if (left.pre && right.pre) return left.pre.localeCompare(right.pre);
  return 0;
}

function normalizeVersion(tagName) {
  const version = String(tagName || "").trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}

function directionFor(version, currentVersion) {
  const comparison = compareVersions(version, currentVersion);
  if (comparison > 0) return "upgrade";
  if (comparison < 0) return "downgrade";
  return "current";
}

export async function GET() {
  const currentVersion = pkg.version;

  try {
    const response = await fetch(GITHUB_CONFIG.releasesApiUrl, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "9Router",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return Response.json({ currentVersion, releases: [], error: "Failed to fetch GitHub releases" }, { status: 502 });
    }

    const rawReleases = await response.json();
    const releases = rawReleases
      .filter((release) => !release?.draft)
      .map((release) => {
        const version = normalizeVersion(release.tag_name);
        if (!version) return null;
        const direction = directionFor(version, currentVersion);
        return {
          version,
          tagName: release.tag_name,
          name: release.name || release.tag_name,
          url: release.html_url,
          publishedAt: release.published_at,
          prerelease: release.prerelease === true,
          direction,
          isCurrent: direction === "current",
          installCommand: `${UPDATER_CONFIG.installCmd}@${version} --prefer-online`,
        };
      })
      .filter(Boolean);

    return Response.json({ currentVersion, releases });
  } catch {
    return Response.json({ currentVersion, releases: [], error: "Failed to fetch GitHub releases" }, { status: 502 });
  }
}
