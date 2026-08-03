import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db/data.sqlite');
const STATE_PATH = process.env.DISCOVER_STATE || path.join(DATA_DIR, 'tuner/discover-state.json');
const BASE_URL = process.env.NINEROUTER_URL || 'https://9r.inyund.xyz';
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

const README_URLS = [
  'https://raw.githubusercontent.com/cheahjs/free-llm-api-resources/main/README.md',
  'https://raw.githubusercontent.com/mnfst/awesome-free-llm-apis/main/README.md',
  'https://raw.githubusercontent.com/open-free-llm-api/awesome-freellm-apis/main/README.md',
];

const STOPLIST = new Set([
  'github', 'githubusercontent', 'raw', 'shields', 'img', 'badge', 'npmjs', 'twitter',
  'x', 'discord', 'youtube', 'medium', 'reddit', 'google', 'wikipedia', 'gist', 'stackoverflow',
]);

function cliToken() {
  const machineId = fs.readFileSync(path.join(DATA_DIR, 'machine-id'), 'utf8').trim();
  const cliSecret = fs.readFileSync(path.join(DATA_DIR, 'auth/cli-secret'), 'utf8').trim();
  return crypto.createHash('sha256').update(machineId + '9r-cli-auth' + cliSecret).digest('hex').slice(0, 16);
}

async function currentModels(db, token) {
  const models = new Set();
  const rows = db.prepare("SELECT key FROM kv WHERE scope='customModels'").all();
  for (const row of rows) {
    const parts = String(row.key).split('|');
    if (parts.length >= 2) models.add(`${parts[0]}/${parts[1]}`);
  }
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: { 'x-9r-cli-token': token },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const d = await res.json();
      for (const m of d.data || []) models.add(m.id);
    } else {
      console.warn(`WARN: /v1/models returned ${res.status}`);
    }
  } catch (e) {
    console.warn(`WARN: /v1/models fetch failed: ${e.message}`);
  }
  return models;
}

function registeredProviders(db) {
  const rows = db.prepare('SELECT DISTINCT provider FROM providerConnections').all();
  return new Set(rows.map((r) => String(r.provider).toLowerCase()));
}

// Connections whose provider row is a generated id (openai-compatible-chat-<uuid>)
// carry no vendor name, so no amount of string matching can tell that Alibaba
// ModelStudio is already onboarded. Map the scraped domain to a vendor we know
// is connected under an opaque id. Add a line here when onboarding another
// openai-compatible provider, or it will keep appearing as a candidate.
const ALIASES = new Set(['alibabacloud', 'alibaba', 'modelstudio', 'dashscope']);

// A registered provider and a scraped domain rarely match exactly:
// 'cloudflare-ai' vs 'cloudflare', 'commandcode' vs 'commandcode.ai'.
// Substring either direction, floored at 4 chars so short names cannot
// collide (e.g. 'jan' must never match 'antigravity').
function isRegistered(name, registered) {
  if (registered.has(name) || ALIASES.has(name)) return true;
  if (name.length < 4) return false;
  for (const r of registered) {
    if (r.length < 4) continue;
    if (r.includes(name) || name.includes(r)) return true;
  }
  return false;
}

// The domain regex cannot distinguish an API provider from a desktop app or a
// self-hosted runtime — gpt4all, jan and lmstudio all surfaced as "free
// provider candidates" when none of them expose a hosted API to route to.
// Judged on the README line, which states what the entry is.
const NOT_A_PROVIDER = /\b(desktop app|desktop gui|gui\b|offline|self-?host|local(ly)?\s+run|runs? locally|cli tool|library|sdk|wrapper|frontend|ui\b)\b/i;

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { knownModels: s.knownModels || [], knownProviders: s.knownProviders || [], lastRun: s.lastRun || null };
  } catch {
    return { knownModels: [], knownProviders: [], lastRun: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ponytail: domain-regex over README prose is a heuristic and will surface false
// candidates (CDN/asset/blog hosts caught by the same TLD pattern); acceptable
// because the output feeds a human Discord notification, not automated registration.
// Discovery is deliberately report-only: probing a model writes state into the 9router
// connection record (modelLock_<model>, lastError, errorCode, backoffLevel), so
// liveness probes would silently degrade live provider connections. Models must be
// registered via other means before the tuner can use them.
// Returns Map<name, {url, line, score}>. A bare hostname is not actionable —
// the whole point of this report is that a human can decide whether to onboard
// a provider without opening three READMEs, so every candidate carries the
// source line it came from and the URL that matched.
// `score` counts free-tier signals in that line; candidates that look like a
// free API rank above CDN/blog/asset hosts the domain regex also catches.
const SIGNAL_RE = /\b(free|no credit card|without.{0,10}card|api key|rate limit|tier|credits?|open source)\b/i;

async function discoverProviders() {
  const found = new Map();
  for (const url of README_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.warn(`WARN: ${url} returned ${res.status}`);
        continue;
      }
      const body = await res.text();
      const re = /https?:\/\/(?:www\.)?([a-z0-9-]+)\.(?:ai|com|io|dev|xyz|org|net)\b/gi;
      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          const name = m[1].toLowerCase();
          if (STOPLIST.has(name)) continue;
          const score = SIGNAL_RE.test(line) ? 1 : 0;
          const prev = found.get(name);
          // Keep the highest-signal mention; ties keep the first (shortest
          // README tables come first and read better in Discord).
          if (!prev || score > prev.score) {
            found.set(name, { url: m[0], line: line.replace(/\s+/g, ' ').slice(0, 160), score });
          }
        }
      }
    } catch (e) {
      console.warn(`WARN: ${url} fetch failed: ${e.message}`);
    }
  }
  return found;
}

async function main() {
  const token = cliToken();
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');

  const current = await currentModels(db, token);
  const registered = registeredProviders(db);
  const state = loadState();

  const knownModelsSet = new Set(state.knownModels);
  const allNewModels = [...current].filter((id) => !knownModelsSet.has(id)).sort();

  const discovered = await discoverProviders();
  const knownProvidersSet = new Set(state.knownProviders);
  // FIRST-SEEN delta, kept for the "what changed" line.
  const newProviders = [...discovered.keys()].filter((n) => !isRegistered(n, registered) && !knownProvidersSet.has(n)).sort();
  // STANDING candidate list — the actually useful output. The delta above is
  // structurally almost always empty (these READMEs change rarely, and every
  // name seen is recorded as known forever), which is why every report said
  // "0 new provider(s)". What a human needs is not "what appeared since last
  // run" but "which free providers am I still not using", every time.
  const candidates = [...discovered.entries()]
    .filter(([n, v]) => !isRegistered(n, registered) && !NOT_A_PROVIDER.test(v.line))
    .sort((a, b) => (b[1].score - a[1].score) || a[0].localeCompare(b[0]));

  saveState({
    lastRun: new Date().toISOString(),
    knownModels: [...current].sort(),
    knownProviders: [...new Set([...state.knownProviders, ...discovered.keys()])].sort(),
  });

  // Always report. The old version posted only on a delta and printed
  // "nothing new" otherwise, so the common case was silence and the rare case
  // was a bare list of hostnames — neither is usable. Now every run answers
  // the standing question: what free capacity exists that I am not using?
  const lines = [];
  lines.push(`9r-tuner discover: ${allNewModels.length} new model(s), ${newProviders.length} first-seen provider(s), ${candidates.length} unregistered candidate(s), ${registered.size} provider(s) registered`);

  if (allNewModels.length > 0) {
    lines.push('');
    lines.push('NEW MODELS (not probed - registration required before the tuner can use them)');
    const displayedModels = allNewModels.slice(0, 25);
    for (const id of displayedModels) lines.push(id);
    const omittedModels = allNewModels.length - displayedModels.length;
    if (omittedModels > 0) lines.push(`... and ${omittedModels} more`);
  }

  // Signal-bearing candidates first, and each carries the README line it came
  // from so the provider can be judged without opening three READMEs.
  const withSignal = candidates.filter(([, v]) => v.score > 0);
  const shown = (withSignal.length >= 5 ? withSignal : candidates).slice(0, 12);
  if (shown.length > 0) {
    lines.push('');
    lines.push(`UNREGISTERED FREE-PROVIDER CANDIDATES (top ${shown.length} of ${candidates.length}, unverified, from public lists)`);
    for (const [name, v] of shown) {
      lines.push(`- ${name} <${v.url}>`);
      lines.push(`    ${v.line}`);
    }
  }

  const report = lines.join('\n');
  console.log(report);

  if (WEBHOOK) {
    try {
      const res = await fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: report.slice(0, 1900) }),
      });
      if (!res.ok) console.warn(`WARN: webhook post returned ${res.status}`);
    } catch (e) {
      console.warn(`WARN: webhook post failed: ${e.message}`);
    }
  }

  db.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
