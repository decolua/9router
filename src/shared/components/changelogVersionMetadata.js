import commitMetadataByVersion from "./changelogCommitMetadata.json";

// These timestamps are the committer dates of the first public Serenhope commit
// that recorded each version heading in CHANGELOG.md. They are commit timestamps,
// not release timestamps. The repository has no GitHub Releases:
// https://github.com/serenhope/9router/releases
// History and exact source commits:
// https://github.com/serenhope/9router/commits/master/CHANGELOG.md
// SHA and timestamp data came from GitHub's commits API:
// https://api.github.com/repos/serenhope/9router/commits?path=CHANGELOG.md&per_page=100
const VERSION_PATTERN = /\bv?(\d+(?:\.\d+)+)\b/i;
const COMMIT_COUNT_PATTERN = /(?:·|\()\s*(\d+)\s+commits?\b/i;

export function versionFromTitle(title) {
  return String(title || "").match(VERSION_PATTERN)?.[1] || "";
}

// Upstream sometimes mentions an earlier product release inside a note as well
// as in its title. Use only known release headings, not model or package numbers.
export function hideProductReleaseNumbers(body, titles) {
  const versions = [...new Set((titles || []).map(versionFromTitle).filter(Boolean))];
  if (!versions.length) return String(body || "");
  const alternatives = versions.map((version) => version.replace(/\./g, "\\.")).join("|");
  const references = new RegExp(`(^|[^\\w./-])v?(?:${alternatives})(?![\\w./-])`, "gi");
  return String(body || "").replace(references, "$1an earlier release");
}

export function commitMetadataForTitle(title) {
  const version = versionFromTitle(title);
  return version ? commitMetadataByVersion[version] || null : null;
}

export function formatCommitTimestamp(timestamp, locale = "en-GB") {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

export function formatVersionDate(title, fallbackTimestamp = "", locale = "en-GB") {
  const dateText = String(title || "").match(/\b(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\b/)?.[1] || "";
  const titleDate = /^\d{2}-\d{2}-\d{4}$/.test(dateText)
    ? dateText.split("-").reverse().join("-")
    : dateText;
  const date = new Date(titleDate ? `${titleDate}T00:00:00.000Z` : fallbackTimestamp);
  if (!Number.isFinite(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function commitCountFromTitle(title) {
  const match = String(title || "").match(COMMIT_COUNT_PATTERN);
  return match ? Number(match[1]) : null;
}
