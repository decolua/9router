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

  it("uses the preserving helper from every provider strategy control", () => {
    expect(pageSource).toContain("updateProviderStrategy(current, providerId");
    expect(cardSource).toContain("updateProviderStrategy(current, providerId");
  });

  it("forwards accessible switch names", () => {
    expect(toggleSource).toContain("aria-label={ariaLabel || label}");
    expect(pageSource).toContain('aria-label="Round Robin"');
    expect(pageSource).toContain('aria-label="Cache affinity"');
  });
});
