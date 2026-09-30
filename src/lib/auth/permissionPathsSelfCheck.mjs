// Permission model self-check.
// Run: node src/lib/auth/permissionPathsSelfCheck.mjs
// No framework, no deps. Uses a local assert. See allowedModelsSqlSelfCheck.mjs for the same style.
import { PERMISSION_KEYS, DEFAULT_PERMISSIONS, FULL_PERMISSIONS, normalizePermissions, requiredPermissionsForPage, requiredPermissionsForApiPath, canOpenPage, firstAllowedPage } from "./permissionPaths.js";

const results = [];
const run = (n, f) => { try { f(); results.push({n, ok:true}); } catch(e) { results.push({n, ok:false, err:e.message}); } };
const eq = (a,b,m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m||""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v,m) => { if (!v) throw new Error(m || "expected truthy"); };

run("every permission key has a default and a full value", () => {
  for (const k of PERMISSION_KEYS) {
    if (DEFAULT_PERMISSIONS[k] === undefined) throw new Error(`DEFAULT_PERMISSIONS missing ${k}`);
    if (FULL_PERMISSIONS[k] !== true) throw new Error(`FULL_PERMISSIONS[${k}] must be true`);
  }
  eq(Object.keys(DEFAULT_PERMISSIONS).sort(), [...PERMISSION_KEYS].sort(), "default key set matches");
  eq(Object.keys(FULL_PERMISSIONS).sort(), [...PERMISSION_KEYS].sort(), "full key set matches");
});

run("new manage permissions default to off, viewUsage stays on", () => {
  eq(DEFAULT_PERMISSIONS.manageTools, false, "manageTools off");
  eq(DEFAULT_PERMISSIONS.manageAdvanced, false, "manageAdvanced off");
  eq(DEFAULT_PERMISSIONS.managePlugins, false, "managePlugins off");
  eq(DEFAULT_PERMISSIONS.manageMediaProviders, false, "manageMediaProviders off");
  eq(DEFAULT_PERMISSIONS.viewUsage, true, "viewUsage on");
});

run("a key stored before this change gains no new permission", () => {
  const legacy = { manageApiKeys: true, manageModels: true, manageProviders: false, viewUsage: true };
  const n = normalizePermissions(legacy);
  eq(n.manageTools, false, "no silent grant");
  eq(n.manageAdvanced, false, "no silent grant");
  eq(n.managePlugins, false, "no silent grant");
  eq(n.manageMediaProviders, false, "no silent grant");
  eq(n.manageApiKeys, true, "existing grant kept");
});

run("normalizePermissions on garbage still returns a full key set", () => {
  eq(Object.keys(normalizePermissions(null)).sort(), [...PERMISSION_KEYS].sort(), "null");
  eq(Object.keys(normalizePermissions("nope")).sort(), [...PERMISSION_KEYS].sort(), "string");
});

run("each new permission opens exactly its own pages", () => {
  const only = (p) => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, k === p]));
  const cases = [
    ["manageTools", "/dashboard/cli-tools"],
    ["manageTools", "/dashboard/token-saver"],
    ["manageAdvanced", "/dashboard/console-log"],
    ["manageAdvanced", "/dashboard/translator"],
    ["manageAdvanced", "/dashboard/proxy-pools"],
    ["manageAdvanced", "/dashboard/pxpipe"],
    ["manageAdvanced", "/dashboard/mitm"],
    ["managePlugins", "/dashboard/plugins"],
    ["managePlugins", "/dashboard/skills"],
    ["manageMediaProviders", "/dashboard/media-providers"],
    ["manageMediaProviders", "/dashboard/media-providers/web"],
  ];
  for (const [perm, page] of cases) {
    ok(canOpenPage(page, only(perm)), `${page} should open with ${perm}`);
    for (const other of PERMISSION_KEYS.filter((k) => k !== perm)) {
      if (!canOpenPage(page, only(other))) continue;
      throw new Error(`${page} also opens with ${other}`);
    }
  }
});

run("a new permission does not leak into the other sections", () => {
  const tools = { manageTools: true, viewUsage: true };
  ok(!canOpenPage("/dashboard/plugins", tools), "tools must not open plugins");
  ok(!canOpenPage("/dashboard/console-log", tools), "tools must not open console log");
  ok(!canOpenPage("/dashboard/media-providers", tools), "tools must not open media providers");
  ok(!canOpenPage("/dashboard/providers", tools), "tools must not open providers");
  ok(!canOpenPage("/dashboard/endpoint", tools), "tools must not open endpoint");
});

run("basic-chat and profile keep their previous closed-to-restricted-sessions rule", () => {
  // `permissions: []` cannot be satisfied by `needed.some(...)` on an empty array,
  // so these two stay shut to any API-key session. That is exactly what they did
  // before the change, and keeping the [] entries is what preserves it.
  for (const page of ["/dashboard/basic-chat", "/dashboard/profile"]) {
    const need = requiredPermissionsForPage(page);
    if (need === null) throw new Error(`${page} should keep an explicit [] rule, got null`);
    if (need.length !== 0) throw new Error(`${page} should stay [], got ${JSON.stringify(need)}`);
    ok(!canOpenPage(page, { viewUsage: true, manageApiKeys: true }), `${page} stays shut to a key`);
  }
});

run("an unknown page stays admin only rather than opening up", () => {
  const everyKey = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
  ok(!canOpenPage("/dashboard/something-new", everyKey), "new page closed");
  ok(!canOpenPage("/dashboard/media-providersx", everyKey), "prefix lookalike closed");
});

run("media-providers sub-paths inherit the parent rule", () => {
  const media = { manageMediaProviders: true, viewUsage: true };
  ok(canOpenPage("/dashboard/media-providers/tts", media), "tts page opens");
  ok(canOpenPage("/dashboard/media-providers/embedding", media), "embedding page opens");
});

run("the new API rules gate the right methods", () => {
  const cases = [
    ["manageTools", "/api/cli-tools/config"],
    ["manageTools", "/api/headroom/status"],
    ["manageAdvanced", "/api/translator/run"],
    ["manageAdvanced", "/api/proxy-pools"],
    ["manageAdvanced", "/api/pxpipe/preview"],
    ["managePlugins", "/api/plugins"],
    ["manageMediaProviders", "/api/media-providers/tts"],
  ];
  for (const [perm, path] of cases) {
    const need = requiredPermissionsForApiPath(path, "GET");
    if (!need || !need.includes(perm)) throw new Error(`${path} should require ${perm}, got ${JSON.stringify(need)}`);
  }
});

run("existing API rules still gate the same paths", () => {
  const keys = { manageApiKeys: true, viewUsage: true };
  ok(requiredPermissionsForApiPath("/api/keys", "GET").includes("manageApiKeys"), "keys still api-key gated");
  ok(requiredPermissionsForApiPath("/api/providers", "POST").includes("manageProviders"), "providers still gated");
  ok(requiredPermissionsForApiPath("/api/usage/stats", "GET").includes("viewUsage"), "usage still viewUsage");
  const usageKeys = { manageApiKeys: true, viewUsage: true };
  ok(requiredPermissionsForApiPath("/api/models", "GET").includes("manageApiKeys"), "model read still shared");
  ok(requiredPermissionsForApiPath("/api/models", "POST").includes("manageModels"), "model write still manageModels");
});

run("firstAllowedPage lands somewhere real for every single permission", () => {
  for (const k of PERMISSION_KEYS) {
    const page = firstAllowedPage(Object.fromEntries(PERMISSION_KEYS.map((x) => [x, x === k])));
    if (!page) throw new Error(`${k} alone lands nowhere`);
    if (!canOpenPage(page, Object.fromEntries(PERMISSION_KEYS.map((x) => [x, x === k])))) {
      throw new Error(`${k} lands on ${page} which it cannot open`);
    }
  }
});

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.n}${r.err ? ` — ${r.err}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
