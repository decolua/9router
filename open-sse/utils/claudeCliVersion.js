// Live Claude Code CLI version for the claude-cli/x.y.z fingerprint.
// Anthropic gates new models on a minimum CLI version (error_code
// "claude_code_version_too_old"), so a hardcoded version goes stale with every
// model launch. We resolve the latest published @anthropic-ai/claude-code from
// npm, cache it, and never go below the bundled fallback.
//
// Override: CLAUDE_CLI_VERSION env pins a version and disables the lookup.

const NPM_URL = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";
const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 3000;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// Sanity floor: a module that loads before shared.js must still send a real
// version, never a placeholder Anthropic would reject as too old.
let fallback = "2.1.322";
let current = null;
let nextCheckAt = 0;
let inflight = null;

const pinned = typeof process !== "undefined" && VERSION_RE.test(process.env?.CLAUDE_CLI_VERSION || "")
  ? process.env.CLAUDE_CLI_VERSION
  : null;

function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function setClaudeCliFallback(version) {
  if (VERSION_RE.test(version) && cmp(version, fallback) > 0) fallback = version;
}

export function getClaudeCliVersion() {
  if (pinned) return pinned;
  return current && cmp(current, fallback) > 0 ? current : fallback;
}

async function lookup(fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(NPM_URL, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`npm ${res.status}`);
    const version = (await res.json())?.version;
    if (!VERSION_RE.test(version || "")) throw new Error("bad version");
    current = version;
    nextCheckAt = Date.now() + TTL_MS;
  } catch {
    nextCheckAt = Date.now() + RETRY_MS;
  } finally {
    clearTimeout(timer);
    inflight = null;
  }
}

// Refresh if stale. Awaits at most TIMEOUT_MS; failures keep the last known value.
export async function ensureClaudeCliVersion(fetchImpl) {
  if (pinned || Date.now() < nextCheckAt) return getClaudeCliVersion();
  if (!inflight) inflight = lookup(fetchImpl);
  await inflight;
  return getClaudeCliVersion();
}

const UA_RE = /claude-cli\/\d+\.\d+\.\d+/g;
// Rewrite claude-cli/x.y.z in header values to the live version (object or Headers).
export function applyClaudeCliVersion(headers) {
  if (!headers) return headers;
  const v = getClaudeCliVersion();
  // Never downgrade a fingerprint to an invalid/placeholder version.
  if (!VERSION_RE.test(v) || cmp(v, "1.0.0") < 0) return headers;
  const fix = (val) => (typeof val === "string" ? val.replace(UA_RE, `claude-cli/${v}`) : val);
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out = new Headers(headers);
    for (const [k, val] of headers.entries()) out.set(k, fix(val));
    return out;
  }
  if (Array.isArray(headers)) return headers.map(([k, val]) => [k, fix(val)]);
  const out = {};
  for (const [k, val] of Object.entries(headers)) out[k] = fix(val);
  return out;
}
