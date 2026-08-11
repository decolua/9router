import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'db/data.sqlite');
const BENCH_PATH = process.env.BENCH_PATH || '/app/tuner/bench.json';
const STATE_PATH = process.env.STATE_PATH || path.join(DATA_DIR, 'tuner/state.json');
const BASE_URL = process.env.NINEROUTER_URL || 'http://localhost:20128';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const DWELL_MS = Number(process.env.DWELL_MS || 900000);
const MAX_PER_POOL = 1;
const DASHBOARD_PASSWORD = process.env.NINEROUTER_DASHBOARD_PASSWORD || '';

function cliToken() {
  const raw = fs.readFileSync(path.join(DATA_DIR, 'machine-id'), 'utf8').trim();
  const secret = fs.readFileSync(path.join(DATA_DIR, 'auth/cli-secret'), 'utf8').trim();
  return crypto.createHash('sha256').update(raw + '9r-cli-auth' + secret).digest('hex').slice(0, 16);
}

const authCookie = { value: null, tried: false, failed: false };

async function dashboardCookie() {
  if (authCookie.tried) return authCookie.value;
  authCookie.tried = true;
  if (!DASHBOARD_PASSWORD) {
    console.warn('WARN NINEROUTER_DASHBOARD_PASSWORD not set - combo writes will be skipped');
    authCookie.failed = true;
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: DASHBOARD_PASSWORD }),
    });
    if (!res.ok) {
      console.warn(`WARN dashboard login failed: ${res.status}${res.status === 429 ? ' (rate limited - not retrying)' : ''}`);
      authCookie.failed = true;
      return null;
    }
    const raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie().join('; ')
      : (res.headers.get('set-cookie') || '');
    const m = /auth_token=([^;]+)/.exec(raw);
    if (!m) {
      console.warn('WARN dashboard login succeeded but no auth_token cookie returned');
      authCookie.failed = true;
      return null;
    }
    authCookie.value = m[1];
    return authCookie.value;
  } catch (err) {
    console.warn(`WARN dashboard login threw: ${err.message}`);
    authCookie.failed = true;
    return null;
  }
}

async function getCandidates(db, bench, token) {
  const candidates = new Set();
  const caps = new Map();
  const identities = new Map();
  const nodePrefix = new Map();
  for (const row of db.prepare('SELECT id, data FROM providerNodes').all()) {
    try {
      const parsed = JSON.parse(row.data);
      if (parsed && typeof parsed.prefix === 'string' && parsed.prefix) nodePrefix.set(row.id, parsed.prefix);
    } catch {
      // malformed node data is ignored
    }
  }
  for (const row of db.prepare(`SELECT key FROM kv WHERE scope='customModels'`).all()) {
    const parts = row.key.split('|');
    if (parts.length >= 2) {
      const pfx = nodePrefix.get(parts[0]) ?? parts[0];
      candidates.add(`${pfx}/${parts[1]}`);
    }
  }
  const registered = new Set(candidates);
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, { headers: { 'x-9r-cli-token': token } });
    if (res.ok) {
      const d = await res.json();
      for (const m of d.data ?? []) {
        candidates.add(m.id);
        if (m.capabilities) caps.set(m.id, m.capabilities);
        if (m.family || m.effort || m.mode) {
          identities.set(m.id, { family: m.family ?? null, effort: m.effort ?? null, mode: m.mode ?? null });
        }
      }
    } else {
      console.warn(`WARN /v1/models returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`WARN /v1/models fetch failed: ${err.message}`);
  }
  // A provider node (custom openai/anthropic-compatible endpoint) serves ONLY the
  // models registered on its connection. /v1/models additionally advertises the
  // vendor's whole upstream catalogue, which this credential cannot purchase -
  // e.g. TokenRouter exposes 108 ids but only 2 are registered and free.
  const nodePrefixes = new Set(nodePrefix.values());
  for (const id of [...candidates]) {
    const pfx = id.slice(0, id.indexOf('/'));
    if (nodePrefixes.has(pfx) && !registered.has(id)) candidates.delete(id);
  }
  // A model switched off in the 9router UI writes kv scope='disabledModels',
  // keyed by provider prefix with a JSON array of model ids; the customModels
  // row is left in place, so disabled models are otherwise still proposed.
  // The user's disable is binding (decided 2026-08-01: "lets just skip disabled").
  const disabledByPrefix = new Map();
  for (const row of db.prepare(`SELECT key, value FROM kv WHERE scope='disabledModels'`).all()) {
    try {
      const list = JSON.parse(row.value);
      if (Array.isArray(list)) disabledByPrefix.set(row.key, new Set(list.map(String)));
    } catch {
      // malformed disabled list is ignored
    }
  }
  for (const id of [...candidates]) {
    const i = id.indexOf('/');
    if (i < 0) continue;
    const off = disabledByPrefix.get(id.slice(0, i));
    if (off && off.has(id.slice(i + 1))) candidates.delete(id);
  }
  const dead = new Set(bench._deadCredentials ?? []);
  for (const id of [...candidates]) {
    if (dead.has(id.split('/')[0])) candidates.delete(id);
  }
  const nodeIds = new Set(db.prepare('SELECT id FROM providerNodes').all().map((r) => r.id));
  const validPrefixes = new Set([
    ...nodePrefix.values(),
    ...Object.keys(bench.providerByPrefix ?? {}),
    ...nodeIds,
  ]);
  for (const id of [...candidates]) {
    const pfx = id.slice(0, id.indexOf('/'));
    if (!validPrefixes.has(pfx)) candidates.delete(id);
  }
  return { candidates, caps, identities };
}

// ponytail: stats scoped by bench.providerByPrefix; any prefix missing from that map falls back to model-name-only matching.
function getHealth(db, candidates, bench) {
  const okRows = db.prepare(
    `SELECT provider, model, COUNT(*) n FROM usageHistory WHERE timestamp > datetime('now','-1 day') GROUP BY provider, model`
  ).all();
  const errRows = db.prepare(
    `SELECT provider, model, SUM(status='error') e, COUNT(*) t FROM requestDetails WHERE timestamp > datetime('now','-1 day') GROUP BY provider, model`
  ).all();
  const recentErrStmt = db.prepare(
    `SELECT COUNT(*) c FROM requestDetails WHERE timestamp > datetime('now','-30 minutes') AND status='error' AND model = ? AND provider = ?`
  );
  const recentOkStmt = db.prepare(
    `SELECT COUNT(*) c FROM requestDetails WHERE timestamp > datetime('now','-30 minutes') AND status != 'error' AND model = ? AND provider = ?`
  );
  const health = new Map();
  for (const id of candidates) {
    const modelPart = id.slice(id.indexOf('/') + 1);
    const prefix = id.slice(0, id.indexOf('/'));
    const providerName = bench.providerByPrefix?.[prefix] ?? null;
    const ok = okRows
      .filter((r) => (providerName ? r.provider === providerName && r.model === modelPart : r.model === modelPart))
      .reduce((s, r) => s + r.n, 0);
    const err = errRows
      .filter((r) => (providerName ? r.provider === providerName && r.model === modelPart : r.model === modelPart))
      .reduce((s, r) => s + (r.e ?? 0), 0);
    let h = ok === 0 && err === 0 ? 0.5 : ok / (ok + err + 1);
    const recentErr = providerName ? recentErrStmt.get(modelPart, providerName).c : 0;
    const recentOk = providerName ? recentOkStmt.get(modelPart, providerName).c : 0;
    if (recentErr > 0 && recentOk === 0) h = 0;
    health.set(id, { ok, err, health: h });
  }
  return health;
}

// A model id is a wire name, not a description. `ag/gemini-3.1-pro-low` carries
// the route (ag), the capability class (gemini-3.1-pro) and the effort (low) in
// one opaque string. This used to end with a substring scan over bench.models,
// which failed in both directions: `gemini-3.1-pro-low` matched `gemini-3.1-pro`
// and inherited an opus band it never earned, while `gemini-pro-agent` — the
// HIGH variant of the same model — matched nothing and went invisible to every
// combo. Substring inference is gone; the family is declared, never guessed.
//
// Resolution is exact, in three steps (see docs/adr/0001):
//   1. bench._modelIdentity[<full id>] — for candidates with no registry entry
//      (custom models registered against a provider node).
//   2. the identity /v1/models reported for this id (registry `family`/`effort`).
//   3. an exact bench.models key equal to the model part, or to its last segment
//      — the id IS the family, so nothing needs declaring.
// Nothing else matches. An unresolved candidate has no band, which makes it
// invisible to every combo, and is reported by name (see reportUnbanded).
function identityOf(bench, id, identities) {
  const modelPart = id.slice(id.indexOf('/') + 1);
  // Field by field, so a bench override that names only an effort corrects that
  // one fact instead of erasing the family the registry already declared.
  const declared = { ...(identities?.get(id) ?? {}), ...(bench._modelIdentity?.[id] ?? {}) };
  const tail = modelPart.slice(modelPart.lastIndexOf('/') + 1);
  const exact = bench.models[modelPart] ? modelPart : bench.models[tail] ? tail : null;
  return {
    family: declared.family ?? exact ?? null,
    effort: declared.effort ?? null,
    mode: declared.mode ?? null,
  };
}

function matchBench(bench, id, identities) {
  const family = identityOf(bench, id, identities).family;
  return family && bench.models[family] ? [family, bench.models[family]] : null;
}

// Effort shifts the family's band by a declared offset, so a low-effort variant
// can never sit in its family's tier. Offsets are signed in quality terms:
// -1 means one band WORSE, which is one step further down bandOrder. Steps past
// either end clamp rather than wrap.
function shiftBand(bench, base, effort) {
  const order = bench._bands ?? [];
  const i = order.indexOf(base);
  if (i === -1) return null;
  if (!effort) return base;
  const offset = bench._effortBandOffset?.[effort];
  if (offset === undefined) return base;
  return order[Math.min(order.length - 1, Math.max(0, i - offset))];
}

function band(bench, id, identities) {
  const identity = identityOf(bench, id, identities);
  const entry = identity.family ? bench.models[identity.family] : null;
  const base = entry?.band ?? null;
  return base ? shiftBand(bench, base, identity.effort) : null;
}

function cost(bench, id) {
  const override = bench._costOverride?.[id];
  if (override !== undefined) return override;
  const prefix = id.split('/')[0];
  return bench.costClass?.[prefix] ?? 3;
}

function benchScore(bench, id, identities) {
  const m = matchBench(bench, id, identities);
  if (!m) return 0;
  const e = m[1];
  return e.swe_verified ?? e.swe_pro ?? e.terminal_bench ?? 0;
}

const VARIANT_SUFFIXES = ['-thinking-agentic', '-extra-low', '-agentic', '-thinking', '-review', '-medium', '-high', '-low', '-fast'];

function baseModel(name) {
  let s = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of VARIANT_SUFFIXES) {
      if (s.endsWith(suf) && s.length > suf.length) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }
  return s;
}

function familyOf(name) {
  const tail = name.slice(name.lastIndexOf('/') + 1);
  const dash = tail.indexOf('-');
  return dash === -1 ? tail : tail.slice(0, dash);
}

function poolKey(id, bench) {
  const prefix = id.slice(0, id.indexOf('/'));
  const group = bench.quotaGroup?.[prefix] ?? prefix;
  const scope = bench.quotaScope?.[prefix] ?? 'account';
  const modelPart = id.slice(id.indexOf('/') + 1);
  if (scope === 'model') return `${group}/${baseModel(modelPart)}`;
  if (scope === 'family') return `${group}/${familyOf(modelPart)}`;
  return group;
}

function capPerPool(ids, bench, max) {
  const seen = new Map();
  const out = [];
  for (const id of ids) {
    const k = poolKey(id, bench);
    const n = seen.get(k) ?? 0;
    if (n >= max) continue;
    seen.set(k, n + 1);
    out.push(id);
  }
  return out;
}

// An unbanded candidate is invisible to every combo, because `null` is in no
// combo's allowed band list. That fail-closed default is correct — an unvetted
// model discovered off a public list must not serve traffic — but it used to be
// silent, so a model could sit dark forever with no signal anywhere. Keep the
// safety, delete the silence: every run names them and says which of the two
// things is missing, so the fix is one bench entry or two registry fields away.
function reportUnbanded(bench, candidates, identities) {
  const out = [];
  for (const id of candidates) {
    if (band(bench, id, identities)) continue;
    const family = identityOf(bench, id, identities).family;
    out.push({
      id,
      family,
      reason: family ? 'family-not-in-bench' : 'no-family-declared',
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (out.length === 0) {
    console.log('unbanded=0');
    return out;
  }
  console.log(`UNBANDED CANDIDATES (${out.length}) - invisible to every combo until banded`);
  for (const u of out) {
    console.log(`  ${u.id}  ${u.reason}${u.family ? ` (family=${u.family})` : ''}`);
  }
  return out;
}

// Push the same list to Discord, reusing the webhook discover.mjs already posts
// to. Only on CHANGE: this script runs on a dwell timer, and re-posting an
// unchanged list every few minutes is how a channel gets muted.
async function postUnbanded(unbanded, previous) {
  const webhook = process.env.DISCORD_WEBHOOK_URL || '';
  const ids = unbanded.map((u) => u.id);
  const before = (previous ?? []).map((u) => u.id);
  if (!webhook || ids.length === 0) return;
  if (JSON.stringify(ids) === JSON.stringify(before)) return;
  const lines = [`9r-tuner: ${ids.length} unbanded candidate(s) - invisible to every combo`];
  for (const u of unbanded.slice(0, 25)) {
    lines.push(`- ${u.id} (${u.reason})`);
  }
  if (ids.length > 25) lines.push(`... and ${ids.length - 25} more`);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: lines.join('\n').slice(0, 1900) }),
    });
    if (!res.ok) console.warn(`WARN webhook post returned ${res.status}`);
  } catch (err) {
    console.warn(`WARN webhook post failed: ${err.message}`);
  }
}

function selfTest() {
  const bench = JSON.parse(fs.readFileSync(new URL('./bench.json', import.meta.url), 'utf8'));
  assert.equal(poolKey('cx/gpt-5.6-sol', bench), 'codex-subscription');
  assert.equal(poolKey('ocg/gpt-5.6-sol-review', bench), 'codex-subscription');
  assert.notEqual(poolKey('ag/claude-opus-5', bench), poolKey('ag/gemini-3.1-pro', bench));
  const ids = ['cx/gpt-5.6-sol', 'ocg/gpt-5.6-sol-review', 'ag/claude-opus-5', 'ag/gemini-3.1-pro'];
  assert.deepEqual(
    capPerPool(applyPins(ids, { 'ocg/gpt-5.6-sol-review': 1 }, ids, bench), bench, MAX_PER_POOL),
    ['cx/gpt-5.6-sol', 'ag/claude-opus-5', 'ag/gemini-3.1-pro'],
  );

  // Band derivation. The incident these guard: a fable-band combo (Odin, depth 1)
  // served ag/gemini-3.1-pro-low for two whole sessions because substring matching
  // handed the low variant its family's opus band, while the HIGH variant of the
  // same model - registered upstream as `gemini-pro-agent` - matched nothing.
  const idn = (family, effort) => new Map([['t/x', { family, effort, mode: null }]]);
  assert.equal(band(bench, 't/x', idn('gemini-3.1-pro', 'high')), 'opus');
  assert.equal(band(bench, 't/x', idn('gemini-3.1-pro', 'medium')), 'sonnet');
  assert.equal(band(bench, 't/x', idn('gemini-3.1-pro', 'low')), 'haiku');
  assert.equal(band(bench, 't/x', idn('gemini-3.1-pro', null)), 'opus');
  // An effort can never promote a family past the top of the ladder, nor sink it
  // past the bottom - both ends clamp.
  assert.equal(band(bench, 't/x', idn('kimi-k3', 'high')), 'fable');
  assert.equal(band(bench, 't/x', idn('gpt-oss-120b', 'low')), 'below');
  // Exact ids still band with nothing declared: the id IS the family.
  assert.equal(band(bench, 'ag/gemini-3.1-pro', new Map()), 'opus');
  assert.equal(band(bench, 'tokenrouter/moonshotai/kimi-k3', new Map()), 'fable');
  // Substring inference is gone. `-low` no longer borrows its family's band, and
  // an id that merely CONTAINS a bench key is not that model.
  assert.equal(band(bench, 'ag/gemini-3.1-pro-low', new Map()), null);
  assert.equal(band(bench, 'x/gemini-3.1-pro-someone-elses-model', new Map()), null);
  // An undeclared family fails closed rather than guessing.
  assert.equal(band(bench, 't/x', idn('no-such-family', 'high')), null);
  // bench._modelIdentity covers candidates with no registry entry, and outranks
  // an exact id match so a declaration can always correct one.
  assert.equal(
    band({ ...bench, _modelIdentity: { 'n/foo': { family: 'gemini-3.1-pro', effort: 'low' } } }, 'n/foo', new Map()),
    'haiku',
  );
  // A partial override corrects one field and leaves the registry's family alone.
  assert.equal(
    band({ ...bench, _modelIdentity: { 't/x': { effort: 'low' } } }, 't/x', idn('gemini-3.1-pro', 'high')),
    'haiku',
  );

  const unbanded = reportUnbanded(bench, ['ag/gemini-3.1-pro', 'ag/gemini-3.1-pro-low'], idn());
  assert.deepEqual(unbanded.map((u) => u.id), ['ag/gemini-3.1-pro-low']);
  assert.equal(unbanded[0].reason, 'no-family-declared');

  console.log('self-test passed');
}

function interleaveByProvider(ids, groupKey, bench) {
  const groups = new Map();
  for (const id of ids) {
    const k = groupKey(id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  const out = [];
  for (const members of groups.values()) {
    const buckets = new Map();
    for (const id of members) {
      const p = poolKey(id, bench);
      if (!buckets.has(p)) buckets.set(p, []);
      buckets.get(p).push(id);
    }
    const order = [...buckets.keys()];
    let remaining = members.length;
    while (remaining > 0) {
      for (const p of order) {
        const b = buckets.get(p);
        if (b.length > 0) {
          out.push(b.shift());
          remaining--;
        }
      }
    }
  }
  return out;
}

// A pin forces one model to a fixed index in one combo. Pins live in bench.json
// under `_pins`, which every scheduled run re-reads, so a pin survives runs until
// it is removed. Two guards: a pinned id outside the eligible pool is ignored (a
// pin must never smuggle an unregistered, disabled or dead model back in), and a
// subscription-backed provider is never allowed at index 0 - the head serves every
// request until it fails, and burning a subscription there is what free-first exists
// to prevent.
function applyPins(order, pins, eligible, bench) {
  const subs = bench._subscriptionPrefixes ?? ['ocg', 'ag', 'cx', 'cmc'];
  const isSub = (id) => subs.includes(id.slice(0, id.indexOf('/')));
  const entries = Object.entries(pins ?? {})
    .filter(([id]) => eligible.includes(id))
    .sort((a, b) => a[1] - b[1]);
  if (entries.length === 0) return order;
  const pinnedIds = new Set(entries.map(([id]) => id));
  const out = order.filter((id) => !pinnedIds.has(id));
  for (const [id, rawIdx] of entries) {
    let idx = Math.min(Math.max(0, Math.floor(rawIdx)), out.length);
    if (idx === 0 && isSub(id)) {
      console.warn(`WARN pin ${id} at head refused: subscription provider, demoted to index 1`);
      idx = Math.min(1, out.length);
    }
    out.splice(idx, 0, id);
  }
  return out;
}

async function main() {
  const bench = JSON.parse(fs.readFileSync(BENCH_PATH, 'utf8'));
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  const token = cliToken();
  const { candidates, caps, identities } = await getCandidates(db, bench, token);
  const health = getHealth(db, candidates, bench);
  // One ladder, declared in bench.json, shared with shiftBand.
  const bandOrder = bench._bands ?? ['fable', 'opus', 'sonnet', 'haiku', 'below'];
  const bandOf = (id) => band(bench, id, identities);
  const scoreOf = (id) => benchScore(bench, id, identities);
  const combos = db.prepare('SELECT id, name, models FROM combos').all();
  const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
  const lastApplied = { ...(state.lastApplied ?? {}) };
  const outCombos = {};
  const scores = {};

  for (const id of candidates) {
    const h = health.get(id) ?? { ok: 0, err: 0, health: 0.5 };
    const identity = identityOf(bench, id, identities);
    scores[id] = {
      band: bandOf(id),
      family: identity.family,
      effort: identity.effort,
      mode: identity.mode,
      cost: cost(bench, id),
      health: h.health,
      ok: h.ok,
      err: h.err,
      benchScore: scoreOf(id),
    };
  }

  const unbanded = reportUnbanded(bench, candidates, identities);

  for (const row of combos) {
    const targetBand = bench._comboBand?.[row.name];
    if (targetBand === undefined) continue;
    const idx = bandOrder.indexOf(targetBand);
    const depth = bench._comboDepth?.[row.name] ?? 1;
    const allowed = bandOrder.slice(idx, idx + 1 + depth).filter(Boolean);
    const poolBand = [...candidates].filter((id) => allowed.includes(bandOf(id)));
    const required = (bench._comboRequires?.[row.name] ?? []).filter((k) => k !== '_comment');
    const pool = poolBand.filter((id) => required.every((k) => caps.get(id)?.[k] === true));
    const bandRank = (id) => {
      const i = allowed.indexOf(bandOf(id));
      return i === -1 ? 99 : i;
    };
    const sorted = pool.slice().sort((a, b) => {
      // FREE-FIRST OUTRANKS BAND (2026-08-03). Previously bandRank was
      // compared first, so a PAID target-band model sorted above every FREE
      // fallback-band model: in Sleipnir, cmc/deepseek-v4-flash (haiku,
      // cost 2) and cx/gpt-5.4-mini (haiku, cost 2) sat at indexes 7 and 9
      // while ollama/gpt-oss:120b and cf/...r1-distill (below, cost 0) sat
      // at 10+. Those paid slots get served the moment indexes 0-6 fail, so
      // a subscription was being spent while free capacity went unused —
      // across every combo, because this is one shared comparator.
      // Cost CLASS (free vs paid) now decides before band; band still orders
      // within each class, and exact cost still breaks ties inside a class.
      // Effect: every free model, best band first, then every paid model.
      const pa = cost(bench, a) > 0 ? 1 : 0;
      const pb = cost(bench, b) > 0 ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const ra = bandRank(a);
      const rb = bandRank(b);
      if (ra !== rb) return ra - rb;
      const ca = cost(bench, a);
      const cb = cost(bench, b);
      if (ca !== cb) return ca - cb;
      const ha = health.get(a)?.health ?? 0.5;
      const hb = health.get(b)?.health ?? 0.5;
      if (ha !== hb) return hb - ha;
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa !== sb) return sb - sa;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const capped = capPerPool(sorted, bench, MAX_PER_POOL);
    const ordered = interleaveByProvider(capped, (id) => `${bandRank(id)}|${cost(bench, id)}`, bench);
    // Bottom-prefix providers (cmc, ocg) always sort last — duplicate deepseek
    // accounts we keep for backup but must never burn quota while others work.
    // Applied AFTER interleave because interleave can re-promote them mid-pack.
    // Split+concat is deterministic; Array.sort with a two-value comparator is not.
    const bottomPrefixes = bench._bottomPrefixes?.prefixes ?? [];
    const isBottom = (id) => bottomPrefixes.some((p) => id.startsWith(`${p}/`));
    const top = ordered.filter((id) => !isBottom(id));
    const bottom = ordered.filter(isBottom);
    const bottomLast = top.concat(bottom);
    const desired = capPerPool(applyPins(bottomLast, bench._pins?.[row.name], pool, bench), bench, MAX_PER_POOL);

    const current = JSON.parse(row.models);
    const changed = JSON.stringify(desired) !== JSON.stringify(current);
    const dwellOk = !lastApplied[row.name] || Date.now() - lastApplied[row.name] >= DWELL_MS;

    let applied = false;
    let reason = 'no-change';
    if (changed && dwellOk && !DRY_RUN) {
      const cookie = await dashboardCookie();
      if (!cookie) {
        reason = 'no-auth';
      } else {
        try {
          const res = await fetch(`${BASE_URL}/api/combos/${row.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-9r-cli-token': token, Cookie: `auth_token=${cookie}` },
            body: JSON.stringify({ models: desired }),
          });
          if (res.ok) {
            applied = true;
            reason = 'applied';
            lastApplied[row.name] = Date.now();
          } else {
            const body = await res.text();
            console.warn(`WARN combo ${row.name} write failed: ${res.status} ${body}`);
            reason = 'write-failed';
          }
        } catch (err) {
          console.warn(`WARN combo ${row.name} write threw: ${err.message}`);
          reason = 'write-failed';
        }
      }
    } else if (changed && DRY_RUN) {
      reason = 'dry-run';
    } else if (changed && !dwellOk) {
      reason = 'dwell';
    }

    outCombos[row.name] = { current, desired, changed, applied, reason, pool: pool.length, headBand: desired[0] ? bandOf(desired[0]) : null };
    console.log(
      `${row.name} band=${targetBand} pool=${pool.length} head=${desired[0]} changed=${changed} applied=${applied}`
    );
  }

  await postUnbanded(unbanded, state.unbanded);

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        dryRun: DRY_RUN,
        combos: outCombos,
        scores,
        unbanded,
        lastApplied,
      },
      null,
      2
    )
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  try {
    await main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
