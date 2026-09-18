import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const root = new URL("../../src/app/(dashboard)/dashboard/providers/", import.meta.url);

for (const [file, name] of [["components/ConnectionsCard.js", "saveStrategy"], ["[id]/page.js", "saveProviderStrategy"]]) {
  const source = readFileSync(new URL(file, root), "utf8");
  const body = source.split(`const ${name} = async (strategy, stickyLimit, quotaPreference) => {`)[1].split("\n  };", 1)[0];
  const createSave = new Function("fetch", "providerId", "strategySaveRef", "setStrategySaving", "setStrategyError", "setProviderStrategy", "setProviderStickyLimit", "setQuotaResetFirst", `return async (strategy, stickyLimit, quotaPreference) => {${body}}`);

  function harness(current = {}, getOk = true, patchOk = true) {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: getOk, json: async () => ({ providerStrategies: current }) })
      .mockResolvedValueOnce({ ok: patchOk });
    const setters = Array.from({ length: 5 }, () => vi.fn());
    return { fetch, setters, save: createSave(fetch, "codex", { current: false }, ...setters) };
  }

  describe(file, () => {
    it("shows an opt-in modifier only for supported providers with reset and tie semantics", () => {
      expect(source).toContain('["codex", "claude", "antigravity", "gemini-cli"].includes(providerId)');
      expect(source).toContain('const [quotaResetFirst, setQuotaResetFirst] = useState(false)');
      expect(source).toContain("{supportsQuotaRouting && (");
      expect(source).toContain('label="Prefer earliest quota reset"');
      expect(source).toContain("Use the available account whose applicable quota resets first. Refreshes quota in the background; cooldowns and stagger protection still apply.");
      expect(source).toContain("earliest applicable session or weekly reset");
      expect(source).toContain("Ties use the existing Round Robin or fill-first strategy.");
      expect(source).toContain('role="alert"');
      expect(source).toContain("setQuotaResetFirst(override.quotaResetFirst === true)");
    });

    it.each([true, false])("saves quota %s without changing existing provider fields or other strategies", async (enabled) => {
      const current = { codex: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 4, custom: { keep: true } }, claude: { quotaResetFirst: true } };
      const { fetch, save, setters } = harness(current);
      await save(undefined, undefined, enabled);
      const payload = JSON.parse(fetch.mock.calls[1][1].body);
      expect(payload.providerStrategies).toEqual({ ...current, codex: { ...current.codex, quotaResetFirst: enabled } });
      expect(setters[4]).toHaveBeenCalledWith(enabled);
      expect(current.codex).not.toHaveProperty("quotaResetFirst");
    });

    it("preserves quota and unrelated fields when changing RR and sticky or clearing overrides", async () => {
      const current = { codex: { quotaResetFirst: true, custom: 7, fallbackStrategy: "round-robin", stickyRoundRobinLimit: 4 } };
      for (const strategy of ["round-robin", null]) {
        const { fetch, save } = harness(current);
        await save(strategy, "2");
        expect(JSON.parse(fetch.mock.calls[1][1].body).providerStrategies.codex).toEqual({ quotaResetFirst: true, custom: 7, ...(strategy ? { fallbackStrategy: strategy, stickyRoundRobinLimit: 2 } : {}) });
      }
    });

    it("removes an empty strategy override only", async () => {
      const { fetch, save } = harness({ codex: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 }, claude: { custom: 1 } });
      await save(null, "2");
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ providerStrategies: { claude: { custom: 1 } } });
    });

    it.each([[false, true], [true, false]])("does not update controls after failed requests (GET %s, PATCH %s)", async (getOk, patchOk) => {
      const { fetch, save, setters } = harness({}, getOk, patchOk);
      await save(undefined, undefined, true);
      expect(fetch).toHaveBeenCalledTimes(getOk ? 2 : 1);
      expect(setters[1]).toHaveBeenLastCalledWith(expect.stringContaining("Unable to"));
      for (const setter of setters.slice(2)) expect(setter).not.toHaveBeenCalled();
      expect(setters[0]).toHaveBeenLastCalledWith(false);
    });

    it("handles network failure and prevents overlapping writes", async () => {
      const { fetch, save, setters } = harness();
      fetch.mockReset().mockRejectedValue(new Error("Network unavailable"));
      await Promise.all([save(null, "1"), save(undefined, undefined, true)]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(setters[1]).toHaveBeenLastCalledWith("Network unavailable");
      expect(setters[4]).not.toHaveBeenCalled();
    });
  });
}
