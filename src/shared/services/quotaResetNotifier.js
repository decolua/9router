// Quota-reset notifier: watches each account's 5h / weekly windows and posts a
// message to the configured webhook targets (Slack, Discord, Telegram, or a
// generic JSON receiver such as the Bot notify webhook) when one resets.
//
// Reading usage is the expensive part (an upstream call per account), so polling
// is paced per account: a slow baseline, and every tick only once a remembered
// resetAt is about to pass or has passed.
//
// The windows it is waiting on are persisted (quotaResetStateRepo), so a restart
// resumes the wait instead of forgetting it: a window still open keeps counting
// down, and one that ended while the process was down is announced on the first
// tick back — unless it ended longer ago than maxLateMs, which is history, not news.

import {
  WINDOW_FIVE_HOUR, WINDOW_WEEKLY,
  detectResets, isWindowEnabled, renderTemplate, buildVars, buildRequest,
} from "./quotaResetCore.js";
import { readConfig } from "./quotaResetSettings.js";

export const NOTIFIER_CONFIG = {
  tickIntervalMs: 60000,
  baselinePollMs: 10 * 60000,   // how often an account with known windows is re-read
  noWindowsPollMs: 30 * 60000,  // an account that reported no 5h/weekly window at all
  nearResetMs: 90000,           // poll every tick once a reset is this close
  sendTimeoutMs: 10000,
  recentLimit: 20,
  maxLateMs: 24 * 3600000,      // do not announce a reset that ended longer ago than this
};

const C = NOTIFIER_CONFIG;

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__quotaResetNotifier ??= {
  interval: null,
  running: false,
  loaded: false,  // persisted state read into `accounts` once per process
  accounts: {},   // connectionId -> { windows, lastPolledAt, hasWindows }
  recent: [],     // newest first, secrets never stored
});

export function getRecentNotifications() {
  return [...g.recent];
}

function remember(entry, state = g) {
  state.recent = [entry, ...state.recent].slice(0, C.recentLimit);
}

function accountLabel(conn) {
  return conn.name || conn.email || conn.displayName || `${String(conn.id).slice(0, 8)}…`;
}

function isDue(account, now) {
  if (!account) return true;
  const resets = Object.values(account.windows || {})
    .map((w) => w?.resetAt)
    .filter((v) => typeof v === "number");
  if (resets.some((at) => now >= at - C.nearResetMs)) return true;
  const interval = account.hasWindows ? C.baselinePollMs : C.noWindowsPollMs;
  return now - (account.lastPolledAt || 0) >= interval;
}

/**
 * POST one message to one target. Never throws and never puts the URL or token
 * into the returned error — both are credentials.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendToTarget(target, message, fetchImpl = globalThis.fetch) {
  let request;
  try {
    request = buildRequest(target, message);
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      redirect: "manual",
      signal: AbortSignal.timeout(C.sendTimeoutMs),
    });
    if (response.ok) return { ok: true };
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (e) {
    return { ok: false, error: e?.name === "TimeoutError" ? "timeout" : "request failed" };
  }
}

async function broadcast(targets, message, send) {
  const results = await Promise.all(targets.map(async (t) => ({ target: t, ...(await send(t, message)) })));
  return {
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => ({ name: r.target.name, error: r.error })),
  };
}

/**
 * Send a sample message so the user can check a target before relying on it.
 * @param {object} config stored (unmasked) config
 * @param {string} [targetId] limit to one target; otherwise every enabled target
 */
export async function sendTestNotification(config, targetId, send = sendToTarget) {
  const c = readConfig(config);
  const targets = targetId
    ? c.targets.filter((t) => t.id === targetId)
    : c.targets.filter((t) => t.enabled !== false);
  if (targets.length === 0) return { sent: 0, failed: [{ name: "-", error: "no target" }] };
  const vars = buildVars({
    provider: "claude", account: "example@account", now: Date.now(),
    event: {
      quotaKey: "session (5h)", window: WINDOW_FIVE_HOUR,
      previousResetAt: Date.now(), previousUsedPercent: 87, nextResetAt: Date.now() + 5 * 3600000,
    },
  });
  const message = {
    title: `[테스트] ${renderTemplate(c.titleTemplate, vars)}`,
    text: renderTemplate(c.bodyTemplate, vars),
  };
  return broadcast(targets, message, send);
}

function createDefaultDeps() {
  return {
    now: () => Date.now(),
    send: sendToTarget,
    async getSettings() {
      const { getSettings } = await import("@/lib/localDb");
      return getSettings();
    },
    async getProviderConnections(filter) {
      const { getProviderConnections } = await import("@/lib/localDb");
      return getProviderConnections(filter);
    },
    // Call the usage route's own handler so refresh, routed providers, API-key
    // eligibility and the 401 retry behave exactly as they do for the dashboard.
    async loadState() {
      return (await import("@/lib/db/repos/quotaResetStateRepo.js")).loadQuotaResetState();
    },
    async saveAccount(id, account) {
      return (await import("@/lib/db/repos/quotaResetStateRepo.js")).saveQuotaResetAccount(id, account);
    },
    async removeAccount(id) {
      return (await import("@/lib/db/repos/quotaResetStateRepo.js")).removeQuotaResetAccount(id);
    },
    async fetchUsage(conn) {
      await import("open-sse/index.js");
      const { GET } = await import("@/app/api/usage/[connectionId]/route.js");
      const response = await GET(
        new Request(`http://localhost/api/usage/${conn.id}`),
        { params: Promise.resolve({ connectionId: conn.id }) },
      );
      return response.json();
    },
  };
}

async function checkAccount(conn, config, targets, deps, state) {
  const wants = [WINDOW_FIVE_HOUR, WINDOW_WEEKLY].some((w) => isWindowEnabled(config, conn.id, w));
  if (!wants) return;

  const now = deps.now();
  const known = state.accounts[conn.id];
  if (!isDue(known, now)) return;

  const usage = await deps.fetchUsage(conn);
  // An error or a "not available" answer says nothing about the windows; keep
  // what we knew rather than reading it as every window vanishing.
  if (!usage || usage.error || typeof usage.quotas !== "object" || usage.quotas === null) {
    state.accounts[conn.id] = { ...(known || { windows: {} }), lastPolledAt: now, hasWindows: known?.hasWindows === true };
    return;
  }

  const { events, next } = detectResets(known?.windows, usage.quotas, now);
  const account = { windows: next, lastPolledAt: now, hasWindows: Object.keys(next).length > 0 };
  const changed = events.length > 0 || JSON.stringify(known?.windows || {}) !== JSON.stringify(next);
  state.accounts[conn.id] = account;

  for (const event of events) {
    if (!isWindowEnabled(config, conn.id, event.window)) continue;
    if (now - event.previousResetAt > C.maxLateMs) {
      console.log(`[QuotaReset] ${conn.provider}:${accountLabel(conn)} ${event.window} reset is too old to announce — skipped`);
      continue;
    }
    const vars = buildVars({ provider: conn.provider, account: accountLabel(conn), event, now });
    const message = {
      title: renderTemplate(config.titleTemplate, vars),
      text: renderTemplate(config.bodyTemplate, vars),
    };
    const result = await broadcast(targets, message, deps.send);
    remember({
      at: new Date(now).toISOString(), provider: conn.provider, account: accountLabel(conn),
      window: event.window, sent: result.sent, failed: result.failed.length,
    }, state);
    console.log(`[QuotaReset] ${conn.provider}:${accountLabel(conn)} ${event.window} reset → sent ${result.sent}, failed ${result.failed.length}`);
    for (const f of result.failed) console.warn(`[QuotaReset] target "${f.name}": ${f.error}`);
  }

  // Saved only after the messages went out: if the process dies in between, the
  // reset is announced again on restart rather than lost.
  if (changed) await persist(deps, () => deps.saveAccount?.(conn.id, account), conn);
}

async function persist(deps, write, conn) {
  try {
    await write();
  } catch (e) {
    console.warn(`[QuotaReset] could not save state for ${conn.provider}:${String(conn.id).slice(0, 8)}: ${e.message}`);
  }
}

// Read what the previous process knew, once. A failed read leaves memory empty,
// which degrades to "learn the windows again" rather than blocking the tick.
async function hydrate(deps, state) {
  if (state.loaded) return;
  try {
    const saved = (await deps.loadState?.()) || {};
    state.accounts = { ...saved, ...state.accounts };
  } catch (e) {
    console.warn("[QuotaReset] could not load saved state:", e.message);
  }
  state.loaded = true;
}

// Accounts that were deleted or switched off are not coming back with the same
// windows; drop them so a later re-add starts fresh.
async function prune(conns, deps, state) {
  const live = new Set(conns.map((c) => c.id));
  for (const id of Object.keys(state.accounts)) {
    if (live.has(id)) continue;
    delete state.accounts[id];
    await persist(deps, () => deps.removeAccount?.(id), { provider: "removed", id });
  }
}

export async function runQuotaResetTick(deps = createDefaultDeps(), state = g) {
  if (state.running) return;
  state.running = true;
  try {
    const settings = await deps.getSettings();
    const config = readConfig(settings?.quotaResetNotify);
    const targets = config.targets.filter((t) => t.enabled !== false);
    if (!config.enabled || targets.length === 0) return;

    await hydrate(deps, state);
    const conns = await deps.getProviderConnections({ isActive: true });
    await prune(conns, deps, state);
    for (const conn of conns) {
      try {
        await checkAccount(conn, config, targets, deps, state);
      } catch (e) {
        console.warn(`[QuotaReset] ${conn.provider}:${String(conn.id).slice(0, 8)}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn("[QuotaReset] tick error:", e.message);
  } finally {
    state.running = false;
  }
}

export function startQuotaResetNotifier() {
  if (g.interval) return;
  console.log("[QuotaReset] notifier started");
  runQuotaResetTick().catch(() => {});
  g.interval = setInterval(() => { runQuotaResetTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopQuotaResetNotifier() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[QuotaReset] notifier stopped");
}

// Turning the feature off forgets the windows it was waiting on. Switched back on
// a week later, it should learn the current windows rather than announce resets
// that happened while it was off.
async function forgetState() {
  g.accounts = {};
  g.loaded = false;
  try {
    await (await import("@/lib/db/repos/quotaResetStateRepo.js")).clearQuotaResetState();
  } catch (e) {
    console.warn("[QuotaReset] could not clear saved state:", e.message);
  }
}

/** Start or stop the scheduler to match the stored setting. */
export function configureQuotaResetNotifier(settings) {
  const config = readConfig(settings?.quotaResetNotify);
  const hasTarget = config.targets.some((t) => t.enabled !== false);
  if (config.enabled && hasTarget) {
    startQuotaResetNotifier();
  } else {
    const wasRunning = Boolean(g.interval);
    stopQuotaResetNotifier();
    if (wasRunning) forgetState();
  }
}
