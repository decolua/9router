import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url), "utf8");
const selectSource = readFileSync(new URL("../../src/shared/components/Select.js", import.meta.url), "utf8");
const saveSource = source.slice(source.indexOf("  const saveProviderStrategy ="), source.indexOf("  useEffect(() => {", source.indexOf("  const saveProviderStrategy =")));

function saver(responses) {
  const state = { strategy: "fill-first", global: "fill-first", error: "previous error", saving: false };
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const context = vm.createContext({
    fetch,
    providerId: "claude",
    strategySavingRef: { current: false },
    setStrategySaving: (value) => { state.saving = value; },
    setProviderStrategy: (value) => { state.strategy = value; },
    setGlobalStrategy: (value) => { state.global = value; },
    setStrategyLoaded: vi.fn(),
    setStrategyError: (value) => { state.error = value; },
  });
  return { state, fetch, save: vm.runInContext(`${saveSource}\nsaveProviderStrategy`, context) };
}
const ok = (data = {}) => ({ ok: true, json: async () => data });

describe("provider account strategy UI persistence", () => {
  it("preserves unrelated provider fields and providers when selecting automatic order", async () => {
    const { save, state, fetch } = saver([
      ok({ fallbackStrategy: "random", providerStrategies: { claude: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2, proxyPoolId: "pool" }, codex: { fallbackStrategy: "random" } } }),
      ok(),
    ]);
    const pending = save("weekly-reset-asc", "1");
    expect(state.saving).toBe(true);
    await pending;
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ providerStrategies: { claude: { fallbackStrategy: "weekly-reset-asc", proxyPoolId: "pool" }, codex: { fallbackStrategy: "random" } } });
    expect(state).toMatchObject({ strategy: "weekly-reset-asc", global: "random", saving: false, error: "" });
  });

  it("inherits global settings without removing proxy settings", async () => {
    const { save, fetch, state } = saver([ok({ providerStrategies: { claude: { fallbackStrategy: "fill-first", stickyRoundRobinLimit: 2, proxyPoolId: "pool" } } }), ok()]);
    await save("", "1");
    expect(JSON.parse(fetch.mock.calls[1][1].body).providerStrategies.claude).toEqual({ proxyPoolId: "pool" });
    expect(state.strategy).toBe("");
  });

  it("does not patch after GET failure or display rejected PATCH as saved", async () => {
    for (const responses of [[{ ok: false, status: 503 }], [ok(), { ok: false, status: 400, json: async () => ({ error: "Invalid strategy" }) }]]) {
      const { save, state, fetch } = saver(responses);
      await save("random", "1");
      expect(state.strategy).toBe("fill-first");
      expect(state.error).toMatch(/503|Invalid strategy/);
      expect(state.saving).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(responses.length);
    }
  });

  it("validates consecutive uses and rejects concurrent saves", async () => {
    const { save, state, fetch } = saver([ok(), ok()]);
    await save("round-robin", "0");
    expect(fetch).not.toHaveBeenCalled();
    expect(state.error).toContain("positive integer");
    await Promise.all([save("round-robin", "3"), save("random", "1")]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).providerStrategies.claude.stickyRoundRobinLimit).toBe(3);
    expect(state.strategy).toBe("round-robin");
  });
});

describe("provider account strategy UI controls", () => {
  it("reuses accessible Select/Input with explicit inheritance and disabled unsupported modes", () => {
    expect(source).toContain('aria-label="Account selection strategy"');
    expect(source).toContain('{ value: "", label: "Use global setting" }');
    expect(source).toContain('providerId === "claude" || providerId === "codex"');
    expect(source).toContain("disabled: isWindowStrategy(value) && !supportsWindowStrategies");
    expect(selectSource).toContain("disabled={option.disabled}");
    expect(selectSource).toContain('!options.some((option) => option.value === "")');
    expect(source).toContain('effectiveStrategy === "round-robin" && (');
    expect(source).not.toContain("handleRoundRobinToggle");
  });

  it("polls windows only in supported automatic modes and keeps data on refresh failure", () => {
    const effect = source.slice(source.indexOf("    setQuotaSnapshots({});"), source.indexOf("  const saveThinkingConfig"));
    expect(effect).toContain("if (!windowStrategy || !supportsWindowStrategies) return;");
    expect(effect).toContain("setInterval(refresh, 15000)");
    expect(effect).toContain("clearInterval(interval)");
    expect(effect.slice(effect.indexOf("} catch (error)"))).not.toContain("setQuotaSnapshots");
    expect(source).toContain("Order can vary by model.");
    expect(source).toContain("No valid window data. Using manual order.");
  });

  it("refreshes snapshots without discarding data when HTTP refresh fails", async () => {
    const start = source.lastIndexOf("  useEffect(() => {", source.indexOf("    setQuotaSnapshots({});"));
    const effectSource = source.slice(start, source.indexOf("\n  useEffect(() => {", start + 1));
    const state = { snapshots: null, error: "", refreshing: false };
    const fetch = vi.fn().mockResolvedValueOnce(ok({ snapshots: { account: { fetchedAt: 123, quotas: [] } }, refreshing: false })).mockResolvedValueOnce({ ok: false, status: 503 });
    let cleanup;
    let tick;
    const clearInterval = vi.fn();
    vm.runInNewContext(effectSource, {
      windowStrategy: true,
      supportsWindowStrategies: true,
      providerId: "claude",
      fetch,
      useEffect: (fn) => { cleanup = fn(); },
      setQuotaSnapshots: (value) => { state.snapshots = value; },
      setQuotaError: (value) => { state.error = value; },
      setQuotaRefreshing: (value) => { state.refreshing = value; },
      setInterval: (fn) => { tick = fn; return 7; },
      clearInterval,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(state.snapshots.account.fetchedAt).toBe(123);
    await tick();
    expect(state.snapshots.account.fetchedAt).toBe(123);
    expect(state.error).toContain("503");
    expect(state.refreshing).toBe(false);
    cleanup();
    expect(clearInterval).toHaveBeenCalledWith(7);
  });

  it("uses shared ordering for preview without writing automatic priorities", () => {
    expect(source).toContain("orderAccountsByWindow(connections, effectiveStrategy, quotaSnapshots, null, previewNow)");
    expect(source).toContain('strategyLoaded && effectiveStrategy === "fill-first" && !strategySaving');
    expect(source).toContain("if (!canReorder || index1 < 0");
    expect(source).toContain("isFirst={!canReorder || index === 0}");
    expect(source).toContain("isLast={!canReorder || index === connections.length - 1}");
    expect(source).toContain('showOrdering={effectiveStrategy === "fill-first"}');
    expect(source).toContain('selectClassName="h-7 !py-0 !text-xs !rounded-[8px]"');
    expect(source).toContain('aria-label="Account selection settings"');
    expect(source).toContain('event.key !== "Escape"');
    expect(saveSource).not.toContain("priority");
  });
});
