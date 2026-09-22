/**
 * CHANGELOG.md helpers for update UX.
 *
 * Expected section headers (this repo):
 *   # v0.5.30 (2026-07-10)
 *   # v0.5.20 (2026-07-07)
 */

export const CHANGELOG_STORAGE = {
  lastSeenVersion: "9router:lastSeenVersion",
  updateFromVersion: "9router:updateFromVersion",
};

/** Compare dotted semver-ish strings. Returns 1 / 0 / -1. */
export function compareSemver(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const normalize = (v) =>
    String(v)
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((p) => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Parse full CHANGELOG markdown into ordered sections (newest first, as in file).
 * @param {string} markdown
 * @returns {Array<{ version: string, heading: string, body: string, bullets: string[] }>}
 */
export function parseChangelogSections(markdown) {
  if (!markdown || typeof markdown !== "string") return [];

  const headerRe = /^#\s+v?(\d+\.\d+\.\d+[^\s)]*)\s*([^\n]*)/gm;
  const headers = [];
  let m;
  while ((m = headerRe.exec(markdown)) !== null) {
    headers.push({
      version: m[1].trim(),
      heading: m[0].replace(/^#\s+/, "").trim(),
      index: m.index,
      headerEnd: m.index + m[0].length,
    });
  }
  if (headers.length === 0) return [];

  return headers.map((h, i) => {
    const bodyStart = h.headerEnd;
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].index : markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd).trim();
    const bullets = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean);
    return {
      version: h.version,
      heading: h.heading,
      body,
      bullets,
    };
  });
}

/**
 * Sections with version in (fromVersion, toVersion] — i.e. what you get by upgrading.
 * If `toVersion` is null/empty, include everything newer than `fromVersion`.
 * If `fromVersion` is empty, only the top section (or up to `toVersion`) is returned.
 */
export function getChangelogSectionsBetween(markdown, fromVersion, toVersion = null) {
  const sections = parseChangelogSections(markdown);
  if (sections.length === 0) return [];

  return sections.filter((s) => {
    if (toVersion && compareSemver(s.version, toVersion) > 0) return false;
    if (fromVersion && compareSemver(s.version, fromVersion) <= 0) return false;
    // No fromVersion: prefer only the latest matching toVersion, else first section
    if (!fromVersion) {
      if (toVersion) return compareSemver(s.version, toVersion) === 0;
      return false;
    }
    return true;
  });
}

/**
 * Flatten bullets for UI preview.
 * @returns {{ bullets: Array<{ text: string, version: string }>, truncated: boolean, versions: string[] }}
 */
export function collectChangelogHighlights(sections, { maxBullets = 10 } = {}) {
  const versions = [];
  const bullets = [];
  for (const s of sections) {
    if (!versions.includes(s.version)) versions.push(s.version);
    for (const b of s.bullets) {
      bullets.push({ text: stripInlineMarkdown(b), version: s.version });
    }
  }
  const truncated = bullets.length > maxBullets;
  return {
    bullets: bullets.slice(0, maxBullets),
    truncated,
    versions,
  };
}

/** Light strip of **bold** / `code` for plain list display */
export function stripInlineMarkdown(text) {
  if (!text) return "";
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

// ── localStorage helpers (SSR-safe) ────────────────────────────────────────

function storageGet(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch { /* private mode */ }
}

function storageRemove(key) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch { /* private mode */ }
}

/** Call right before starting an update so post-restart banner knows the range. */
export function markUpdateStarting(fromVersion) {
  if (fromVersion) storageSet(CHANGELOG_STORAGE.updateFromVersion, String(fromVersion).replace(/^v/i, ""));
}

/**
 * Detect a just-completed upgrade for the soft "Updated to vX" banner.
 * @returns {{ show: boolean, fromVersion: string|null, toVersion: string }}
 */
export function detectPostUpdate(currentVersion) {
  const current = String(currentVersion || "").replace(/^v/i, "");
  if (!current) return { show: false, fromVersion: null, toVersion: current };

  const fromFlag = storageGet(CHANGELOG_STORAGE.updateFromVersion);
  const lastSeen = storageGet(CHANGELOG_STORAGE.lastSeenVersion);

  // First ever visit — seed lastSeen, no banner
  if (!lastSeen && !fromFlag) {
    storageSet(CHANGELOG_STORAGE.lastSeenVersion, current);
    return { show: false, fromVersion: null, toVersion: current };
  }

  if (fromFlag && compareSemver(current, fromFlag) > 0) {
    return { show: true, fromVersion: fromFlag, toVersion: current };
  }

  if (lastSeen && compareSemver(current, lastSeen) > 0) {
    return { show: true, fromVersion: lastSeen, toVersion: current };
  }

  // Already on this version — keep lastSeen in sync
  if (!lastSeen || compareSemver(current, lastSeen) !== 0) {
    storageSet(CHANGELOG_STORAGE.lastSeenVersion, current);
  }
  return { show: false, fromVersion: null, toVersion: current };
}

/** Dismiss post-update banner and clear pending flags. */
export function dismissPostUpdate(currentVersion) {
  const current = String(currentVersion || "").replace(/^v/i, "");
  if (current) storageSet(CHANGELOG_STORAGE.lastSeenVersion, current);
  storageRemove(CHANGELOG_STORAGE.updateFromVersion);
}
