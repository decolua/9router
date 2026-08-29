import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { updateProviderStrategy } from "../../src/shared/utils/providerStrategies.js";

const pageSource = fs.readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/providers/[id]/page.js", import.meta.url),
  "utf8",
);
const cardSource = fs.readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js", import.meta.url),
  "utf8",
);
const toggleSource = fs.readFileSync(
  new URL("../../src/shared/components/Toggle.js", import.meta.url),
  "utf8",
);
const settingsRepoSource = fs.readFileSync(
  new URL("../../src/lib/db/repos/settingsRepo.js", import.meta.url),
  "utf8",
);

describe("provider cache affinity control", () => {
  it("preserves unrelated and omitted provider settings", () => {
    const current = {
      codex: {
        proxyPoolId: "pool-us",
        rotateStrategy: "sticky",
        cacheAffinityEnabled: true,
        futureSetting: true,
      },
    };

    const updated = updateProviderStrategy(current, "codex", {
      strategy: "round-robin",
      stickyLimit: "2",
    });

    expect(updated.codex).toEqual({
      proxyPoolId: "pool-us",
      rotateStrategy: "sticky",
      cacheAffinityEnabled: true,
      futureSetting: true,
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 2,
    });
    expect(updated.codex).not.toBe(current.codex);
  });

  it("loads and saves affinity through the provider detail page", () => {
    expect(pageSource).toContain("setProviderCacheAffinity(override.cacheAffinityEnabled === true)");
    expect(pageSource).toContain("cacheAffinityEnabled");
    expect(pageSource).toContain("checked={providerCacheAffinity}");
    expect(pageSource).toContain("onChange={handleCacheAffinityToggle}");
  });

  it("uses an atomic provider patch instead of saving a stale full map", () => {
    expect(pageSource).toContain("providerStrategyPatch: {");
    expect(cardSource).toContain("providerStrategyPatch: {");
    expect(settingsRepoSource).toContain("const { providerStrategyPatch, ...plainUpdates }");
    expect(pageSource).not.toContain("body: JSON.stringify({ providerStrategies: updated })");
    expect(cardSource).not.toContain("body: JSON.stringify({ providerStrategies: updated })");
  });

  it("serializes saves and only rolls back the latest request", () => {
    expect(pageSource).toContain("providerStrategySaveQueueRef");
    expect(cardSource).toContain("providerStrategySaveQueueRef");
    expect(pageSource).toContain("!saved && isLatest");
    expect(cardSource).toContain("!saved && isLatest");
  });

  it("refetches confirmed strategy state when the latest save fails", () => {
    expect(pageSource).toContain("if (!saved && isLatest) await fetchConnections()");
    expect(cardSource).toContain("if (!saved && isLatest) await fetch_()");
  });

  it("forwards accessible switch names", () => {
    expect(toggleSource).toContain("aria-label={ariaLabel || label}");
    expect(pageSource).toContain('aria-label="Round Robin"');
    expect(pageSource).toContain('aria-label="Cache affinity"');
  });
});
