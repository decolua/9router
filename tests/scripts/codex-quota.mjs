import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { DEFAULT_CODEX_QUOTA, getCodexQuotaPriority, validateCodexQuota } from "../../src/shared/utils/codexQuota.js";

// Run with node tests/scripts/codex-quota.mjs. No database, credentials, or network.
const state = {
  connections: [], settings: {}, calls: [], failed: false, proxy: { strictProxy: true },
  payload: { rate_limit: { primary_window: { used_percent: 20 }, secondary_window: { used_percent: 50 } } },
};
globalThis.__codexQuotaCheck = state;
const stub = source => `data:text/javascript,${encodeURIComponent(source)}`;
const db = stub(`
  const s = globalThis.__codexQuotaCheck;
  export const getProviderConnections = async () => s.connections;
  export const getProviderConnectionById = async id => s.connections.find(c => c.id === id);
  export const getSettings = async () => s.settings;
  export const getProxyPools = async () => [];
  export const validateApiKey = async () => true;
  export const getProxyPoolById = async () => null;
  export const updateProviderConnection = async (id, update) => {
    s.saved = update;
    return { ...s.connections.find(c => c.id === id), ...update };
  };
  export const deleteProviderConnection = async () => true;
`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (["@/lib/localDb", "@/models"].includes(specifier)) return { url: db, shortCircuit: true };
    if (specifier === "@/lib/network/connectionProxy") return { shortCircuit: true, url: stub(`
      export const resolveConnectionProxyConfig = async () => globalThis.__codexQuotaCheck.proxy;
      export const pickProxyPoolId = () => null;
    `) };
    if (specifier.endsWith("/utils/proxyFetch.js")) return { shortCircuit: true, url: stub(`
      export async function proxyAwareFetch(url, options, proxy) {
        const s = globalThis.__codexQuotaCheck;
        s.calls.push({ url, options, proxy });
        if (s.failed) throw Error("offline");
        return { ok: true, json: async () => s.payload };
      }
    `) };
    let target = specifier;
    if (specifier === "next/server") target = "next/server.js";
    if (specifier.startsWith("@/")) target = new URL(`../../src/${specifier.slice(2)}`, import.meta.url).href;
    if (specifier.startsWith("open-sse/")) target = new URL(`../../${specifier}`, import.meta.url).href;
    if (target.startsWith("file:") && !/\.[a-z]+$/i.test(target)) target += ".js";
    return nextResolve(target, context);
  },
});

const { refreshCodexQuotas, getCodexQuotaSnapshot, selectCodexQuotaConnection } = await import("../../src/sse/services/codexQuota.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { PUT } = await import("../../src/app/api/providers/[id]/route.js");
const now = Date.parse("2026-10-28T00:00:00Z");
const sessionReset = new Date(now + 5 * 3600_000).toISOString();
const weeklyReset = new Date(now + 7 * 24 * 3600_000).toISOString();
const quotas = (session, weekly) => ({ session: { used: session, resetAt: sessionReset }, weekly: { used: weekly, resetAt: weeklyReset } });
const headroom = { ...DEFAULT_CODEX_QUOTA, sessionCeiling: 80, weeklyCeiling: 60 };
const rules = { ...DEFAULT_CODEX_QUOTA, mode: "rules" };

try {
  mock.method(Date, "now", () => now);
  assert.equal(validateCodexQuota(headroom), null);
  for (const config of [[], 5, { mode: "invalid" }, { sessionCeiling: 0 }, { weeklyCeiling: 101 },
    { sessionRules: [] }, { weeklyRules: [{ upTo: 50, priority: 0 }] },
    { sessionRules: [{ upTo: 90, priority: 1 }, { upTo: 80, priority: 2 }] }]) {
    assert.equal(typeof validateCodexQuota(config), "string");
  }
  assert.equal(getCodexQuotaPriority(quotas(20, 50), headroom).priority, 10);
  assert.equal(getCodexQuotaPriority(quotas(80, 10), headroom).blocked, true);
  assert.equal(getCodexQuotaPriority(quotas(90, 70), headroom).retryAt, Date.parse(weeklyReset));
  assert.equal(getCodexQuotaPriority(quotas(70, 80), rules).priority, 5);
  assert.equal(getCodexQuotaPriority(quotas(95, 20), rules).priority, 10);
  assert.equal(getCodexQuotaPriority(quotas(100, 10), rules).blocked, true);
  assert.equal(getCodexQuotaPriority(quotas(95, 20), { ...rules, sessionRules: [{ upTo: 90, priority: 1 }] }).blocked, true);
  assert.equal(getCodexQuotaPriority(quotas(80, 10), headroom, null, Date.parse(sessionReset)).blocked, false);
  assert.equal(getCodexQuotaPriority({ session: { used: "garbage" } }, headroom).known, false);
  assert.equal(getCodexQuotaPriority(quotas(100, 100), headroom, "gpt-5.3-codex-spark").blocked, false);
  assert.equal(getCodexQuotaPriority({ spark_session: { used: 80, resetAt: sessionReset } }, headroom, "gpt-5.3-codex-spark").blocked, true);

  const connection = { id: "a", provider: "codex", priority: 1, accessToken: "test-only-token", providerSpecificData: { workspaceId: "test-workspace", codexQuota: headroom } };
  state.connections = [connection];
  state.settings = { providerStrategies: { codex: { fallbackStrategy: "quota-weighted" } } };
  state.payload.rate_limit.primary_window.reset_at = sessionReset;
  state.payload.rate_limit.secondary_window.reset_at = weeklyReset;
  await Promise.all([refreshCodexQuotas([connection]), refreshCodexQuotas([connection])]);
  assert.equal(state.calls.length, 1, "concurrent probes are coalesced");
  assert.equal(state.calls[0].options.headers["ChatGPT-Account-ID"], "test-workspace");
  assert.equal(state.calls[0].proxy.strictProxy, true);
  assert.ok(state.calls[0].options.signal instanceof AbortSignal);
  assert.equal(getCodexQuotaSnapshot(connection).weekly.used, 50);
  assert.equal((await getProviderCredentials("cx", null, "gpt-5.3-codex")).connectionId, "a");

  const second = { ...connection, id: "b", priority: 2 };
  state.connections.push(second);
  await refreshCodexQuotas([second]);
  mock.method(Math, "random", () => 0.5);
  assert.equal(selectCodexQuotaConnection(state.connections).id, "a");
  mock.method(Math, "random", () => 0.9);
  assert.equal(selectCodexQuotaConnection(state.connections).id, "b");
  connection.providerSpecificData = { ...connection.providerSpecificData, codexQuota: { ...headroom, sessionCeiling: 20 } };
  assert.equal((await getProviderCredentials("codex", null, "gpt-5.3-codex")).connectionId, "b");
  assert.equal((await getProviderCredentials("codex", null, "gpt-5.3-codex", { preferredConnectionId: "a" })).connectionId, "b");
  assert.equal((await getProviderCredentials("codex", new Set(["b"]), "gpt-5.3-codex")).allRateLimited, true);
  state.connections = [connection];
  const blocked = await getProviderCredentials("codex", null, "gpt-5.3-codex");
  assert.equal(blocked.retryAfter, sessionReset);
  connection["modelLock_gpt-5.3-codex"] = weeklyReset;
  assert.equal((await getProviderCredentials("codex", null, "gpt-5.3-codex")).retryAfter, weeklyReset, "retry waits for quota and model cooldown");
  delete connection["modelLock_gpt-5.3-codex"];
  state.settings = {};
  assert.equal((await getProviderCredentials("codex", null, "gpt-5.3-codex")).connectionId, "a", "opt-out preserves fill-first");

  state.settings = { providerStrategies: { codex: { fallbackStrategy: "quota-weighted" } } };
  mock.method(Date, "now", () => now + 60_000);
  state.failed = true;
  const beforeFailure = state.calls.length;
  await refreshCodexQuotas([connection]);
  await refreshCodexQuotas([connection]);
  assert.equal(state.calls.length, beforeFailure + 1, "failed probes are throttled");
  assert.equal(getCodexQuotaSnapshot(connection).session.used, 20, "failed reads preserve last-known quotas");
  mock.method(Date, "now", () => now + 5 * 60_000);
  assert.equal(getCodexQuotaSnapshot(connection), null, "stale reads expire");
  assert.equal((await getProviderCredentials("codex", null, "gpt-5.3-codex")).connectionId, "a", "quota outage fails open");
  assert.equal(getCodexQuotaSnapshot({ ...connection, accessToken: "changed-token" }), null);
  assert.equal(getCodexQuotaSnapshot({ ...connection, providerSpecificData: { workspaceId: "different" } }), null);

  state.failed = false;
  state.payload = { rate_limit: { primary_window: {}, secondary_window: { used_percent: "invalid" } } };
  const unknown = { ...second, id: "unknown" };
  await refreshCodexQuotas([unknown]);
  assert.equal(getCodexQuotaSnapshot(unknown), null, "missing percentages are not treated as unused quota");

  const put = codexQuota => PUT(new Request("http://localhost/api/providers/a", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerSpecificData: { codexQuota } }),
  }), { params: Promise.resolve({ id: "a" }) });
  assert.equal((await put({ sessionCeiling: -1 })).status, 400);
  assert.equal(state.saved, undefined);
  const response = await put(rules);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.connection.providerSpecificData.codexQuota.mode, "rules");
  assert.equal(body.connection.accessToken, undefined, "responses never expose credentials");
  assert.equal(state.saved.providerSpecificData.workspaceId, "test-workspace", "quota updates preserve account binding");
  console.log("Codex quota priority, cache, routing, proxy, and API checks passed.");
} finally {
  mock.restoreAll();
  delete globalThis.__codexQuotaCheck;
}