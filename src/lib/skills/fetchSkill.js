import { fetchPublic } from "@/shared/utils/ssrfGuard.js";

/**
 * Resolve a user-supplied URL to a SKILL.md document and parse it.
 *
 * Accepts what a person actually has in their clipboard:
 *   https://github.com/owner/repo                      → finds skills/<n>/SKILL.md
 *   https://github.com/owner/repo/blob/main/…/SKILL.md → the blob page
 *   https://raw.githubusercontent.com/…/SKILL.md       → used as-is
 *
 * The URL is caller-supplied, so every fetch goes through fetchPublic, which
 * re-validates each redirect hop and refuses internal hosts.
 */

// A skill is appended to the system prompt of every routed request, so an
// oversized one is a standing cost on each call, not a one-off download.
export const MAX_SKILL_BYTES = 256 * 1024;

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const RAW_HOSTS = new Set(["raw.githubusercontent.com"]);

class SkillFetchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Rough token estimate — enough to warn on, not to bill on. */
export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

/**
 * Parse YAML-ish frontmatter. Deliberately not a YAML parser: SKILL.md
 * frontmatter is flat `key: value`, and pulling in a parser to read three
 * fields would be a dependency for nothing. Unknown or nested keys are simply
 * ignored rather than failing the import.
 */
export function parseFrontmatter(markdown) {
  const text = String(markdown || "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    // Skip nested entries (indented) and comments.
    if (!line.trim() || line.startsWith(" ") || line.startsWith("\t") || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // `metadata:` with nothing after it opens a nested block whose entries are
    // skipped above — recording it as an empty string would invent a field.
    if (key && value) meta[key] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

function parseGitHubUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SkillFetchError("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SkillFetchError(`Unsupported protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (RAW_HOSTS.has(host)) return { kind: "raw", url: url.toString() };

  if (GITHUB_HOSTS.has(host)) {
    if (parts.length < 2) throw new SkillFetchError("A GitHub URL needs an owner and a repository.");
    const [owner, repo] = parts;
    // /owner/repo/blob/<ref>/<path…>  →  the raw equivalent
    if (parts[2] === "blob" && parts.length >= 5) {
      const ref = parts[3];
      const path = parts.slice(4).join("/");
      return { kind: "raw", url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}` };
    }
    return { kind: "repo", owner, repo: repo.replace(/\.git$/, "") };
  }

  throw new SkillFetchError("Only github.com and raw.githubusercontent.com URLs are supported.");
}

async function getText(url) {
  let res;
  try {
    res = await fetchPublic(url, { headers: { Accept: "text/plain, */*" } });
  } catch (e) {
    if (String(e?.message || "").startsWith("Blocked URL")) {
      throw new SkillFetchError("That URL is not allowed.");
    }
    throw new SkillFetchError(`Could not reach ${url}`, 502);
  }
  if (!res.ok) throw new SkillFetchError(`${url} returned HTTP ${res.status}`, res.status === 404 ? 404 : 502);

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_SKILL_BYTES) {
    throw new SkillFetchError(`That skill is ${Math.round(declared / 1024)} KB; the limit is ${MAX_SKILL_BYTES / 1024} KB.`, 413);
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_BYTES) {
    throw new SkillFetchError(`That skill is larger than the ${MAX_SKILL_BYTES / 1024} KB limit.`, 413);
  }
  return text;
}

/**
 * Find the SKILL.md documents a repository publishes.
 *
 * Uses the git tree API so a repo laying its skills out unusually still works,
 * and prefers the conventional top-level `skills/` directory over the
 * editor-specific mirrors (`.cursor/`, `codex/`) that repos often duplicate.
 */
async function listRepoSkills(owner, repo) {
  const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
  let res;
  try {
    res = await fetchPublic(api, { headers: { Accept: "application/vnd.github+json" } });
  } catch {
    throw new SkillFetchError("Could not reach the GitHub API.", 502);
  }
  if (res.status === 404) throw new SkillFetchError(`No such repository: ${owner}/${repo}`, 404);
  if (res.status === 403) throw new SkillFetchError("GitHub rate-limited this lookup. Paste the SKILL.md link directly.", 429);
  if (!res.ok) throw new SkillFetchError(`GitHub API returned HTTP ${res.status}`, 502);

  const tree = (await res.json())?.tree;
  if (!Array.isArray(tree)) throw new SkillFetchError("Unexpected response from the GitHub API.", 502);

  const found = tree
    .filter((n) => n?.type === "blob" && /(^|\/)SKILL\.md$/i.test(n.path || ""))
    .map((n) => n.path);
  if (found.length === 0) throw new SkillFetchError(`${owner}/${repo} contains no SKILL.md.`, 404);

  const canonical = found.filter((p) => p.startsWith("skills/"));
  const chosen = canonical.length > 0 ? canonical : found;
  return chosen.map((path) => ({
    path,
    // A skill's name is its directory: skills/<name>/SKILL.md
    name: path.split("/").slice(-2, -1)[0] || repo,
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`,
  }));
}

/**
 * @param {string} inputUrl a repo, blob or raw URL
 * @param {string} [wantPath] pick one when the repo publishes several
 * @returns {Promise<{name,description,license,sourceUrl,rawUrl,body,bytes,tokens,choices?}>}
 */
export async function fetchSkill(inputUrl, wantPath = "") {
  const target = parseGitHubUrl(String(inputUrl || "").trim());

  let rawUrl;
  let sourceUrl = String(inputUrl || "").trim();
  let fallbackName = "";

  if (target.kind === "raw") {
    rawUrl = target.url;
    fallbackName = decodeURIComponent(rawUrl).split("/").slice(-2, -1)[0] || "skill";
  } else {
    const choices = await listRepoSkills(target.owner, target.repo);
    const picked = wantPath ? choices.find((c) => c.path === wantPath) : choices[0];
    if (!picked) throw new SkillFetchError(`${wantPath} is not a SKILL.md in that repository.`, 404);
    rawUrl = picked.rawUrl;
    fallbackName = picked.name;
    // More than one: let the caller offer the choice instead of guessing.
    if (!wantPath && choices.length > 1) {
      const doc = await getText(rawUrl);
      const { meta, body } = parseFrontmatter(doc);
      return buildSkill({ meta, body, doc, rawUrl, sourceUrl, fallbackName, choices });
    }
  }

  const doc = await getText(rawUrl);
  const { meta, body } = parseFrontmatter(doc);
  return buildSkill({ meta, body, doc, rawUrl, sourceUrl, fallbackName });
}

function buildSkill({ meta, body, doc, rawUrl, sourceUrl, fallbackName, choices }) {
  const content = body.trim() ? body.trim() : doc.trim();
  if (!content) throw new SkillFetchError("That SKILL.md is empty.");
  return {
    name: meta.name || fallbackName || "skill",
    description: meta.description || "",
    license: meta.license || "",
    sourceUrl,
    rawUrl,
    // Frontmatter is metadata for the agent runtime, not instruction text —
    // injecting it would spend tokens on fields the provider cannot act on.
    body: content,
    bytes: Buffer.byteLength(content, "utf8"),
    tokens: estimateTokens(content),
    ...(choices ? { choices } : {}),
  };
}

export { SkillFetchError };
