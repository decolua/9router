import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Combo-to-Combo Mirroring & Recursion Guards (Issue #3798)", () => {
  describe("open-sse/services/combo.js - resolveComboModelsWithGuard", () => {
    it("resolves simple combo models directly", async () => {
      const { resolveComboModelsWithGuard } = await import(
        "../../open-sse/services/combo.js"
      );

      const combos = [
        { name: "combo-simple", models: ["providerA/model1", "providerB/model2"] },
      ];

      const resolved = resolveComboModelsWithGuard("combo-simple", combos);
      expect(resolved).toEqual(["providerA/model1", "providerB/model2"]);
    });

    it("expands nested combos up to allowed depth", async () => {
      const { resolveComboModelsWithGuard } = await import(
        "../../open-sse/services/combo.js"
      );

      const combos = [
        { name: "combo-leaf", models: ["leafProvider/leafModel"] },
        { name: "combo-mid", models: ["combo-leaf", "providerB/model2"] },
        { name: "combo-top", models: ["combo-mid"] },
      ];

      const resolved = resolveComboModelsWithGuard("combo-top", combos);
      expect(resolved).toEqual(["leafProvider/leafModel", "providerB/model2"]);
    });

    it("throws clear error on direct cycle (comboA -> comboB -> comboA)", async () => {
      const { resolveComboModelsWithGuard } = await import(
        "../../open-sse/services/combo.js"
      );

      const combos = [
        { name: "comboA", models: ["comboB"] },
        { name: "comboB", models: ["comboA"] },
      ];

      expect(() => resolveComboModelsWithGuard("comboA", combos)).toThrow(
        /Combo recursion cycle detected/
      );
    });

    it("throws clear error on self-referencing combo", async () => {
      const { resolveComboModelsWithGuard } = await import(
        "../../open-sse/services/combo.js"
      );

      const combos = [
        { name: "combo-self", models: ["combo-self"] },
      ];

      expect(() => resolveComboModelsWithGuard("combo-self", combos)).toThrow(
        /Combo recursion cycle detected/
      );
    });
  });

  describe("Mirror Group propagation in combosRepo", () => {
    it("propagates models and kind updates to all peers in the mirror group", async () => {
      // In-memory mock adapter mimicking SQLite
      const store = new Map();
      const mockAdapter = {
        all: (sql, params = []) => {
          if (sql.includes("SELECT * FROM combos WHERE mirrorGroup = ?")) {
            const mg = params[0];
            return Array.from(store.values()).filter((c) => c.mirrorGroup === mg);
          }
          if (sql.includes("SELECT * FROM combos")) {
            return Array.from(store.values());
          }
          return [];
        },
        get: (sql, params = []) => {
          if (sql.includes("WHERE id = ?")) {
            return store.get(params[0]) || null;
          }
          if (sql.includes("WHERE name = ?")) {
            return Array.from(store.values()).find((c) => c.name === params[0]) || null;
          }
          return null;
        },
        run: (sql, params = []) => {
          if (sql.startsWith("INSERT INTO combos")) {
            const [id, name, kind, models, mirrorGroup, createdAt, updatedAt] = params;
            store.set(id, { id, name, kind, models, mirrorGroup: mirrorGroup || null, createdAt, updatedAt });
            return { changes: 1 };
          }
          if (sql.includes("UPDATE combos SET") && sql.includes("WHERE mirrorGroup = ? AND id != ?")) {
            const [models, kind, updatedAt, mirrorGroup, excludeId] = params;
            for (const [id, item] of store.entries()) {
              if (item.mirrorGroup === mirrorGroup && id !== excludeId) {
                store.set(id, { ...item, models, kind, updatedAt });
              }
            }
            return { changes: 1 };
          }
          if (sql.includes("UPDATE combos SET") && sql.includes("WHERE id = ?")) {
            const [name, kind, models, mirrorGroup, updatedAt, id] = params;
            const item = store.get(id);
            if (item) {
              store.set(id, { ...item, name, kind, models, mirrorGroup, updatedAt });
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        transaction: (fn) => fn(),
      };

      vi.doMock("../../src/lib/db/driver.js", () => ({
        getAdapter: async () => mockAdapter,
      }));

      const { createCombo, updateCombo, getCombosByMirrorGroup } = await import(
        "../../src/lib/db/repos/combosRepo.js"
      );

      // Create combo A under mirror group 'canonical-group'
      const comboA = await createCombo({
        name: "claude-sonnet-4-6",
        kind: "fallback",
        models: ["codex/gpt-5.6-terra", "anthropic/claude-sonnet-4-6"],
        mirrorGroup: "canonical-group",
      });

      // Create combo B under same mirror group with different initial name
      const comboB = await createCombo({
        name: "gpt-5.6-terra",
        kind: "fallback",
        models: ["codex/gpt-5.6-terra", "anthropic/claude-sonnet-4-6"],
        mirrorGroup: "canonical-group",
      });

      expect(comboA.mirrorGroup).toBe("canonical-group");
      expect(comboB.mirrorGroup).toBe("canonical-group");

      const members = await getCombosByMirrorGroup("canonical-group");
      expect(members.map((m) => m.name).sort()).toEqual(["claude-sonnet-4-6", "gpt-5.6-terra"]);

      // Update comboA models -> comboB should update atomically
      const updatedA = await updateCombo(comboA.id, {
        models: ["gemini-cli/gemini-2.5-flash", "anthropic/claude-sonnet-4-6"],
      });
      expect(updatedA.models).toEqual(["gemini-cli/gemini-2.5-flash", "anthropic/claude-sonnet-4-6"]);

      const membersAfterUpdate = await getCombosByMirrorGroup("canonical-group");
      const peerB = membersAfterUpdate.find((m) => m.id === comboB.id);
      expect(peerB.models).toEqual(["gemini-cli/gemini-2.5-flash", "anthropic/claude-sonnet-4-6"]);
    });
  });

  describe("usageHistory meta observability", () => {
    it("stores requestedModel and comboChain inside usageHistory meta column", async () => {
      let savedMeta = null;
      const mockAdapter = {
        all: () => [],
        get: () => null,
        run: (sql, params = []) => {
          if (sql.startsWith("INSERT INTO usageHistory")) {
            // params: [timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta]
            savedMeta = JSON.parse(params[11]);
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        transaction: (fn) => fn(),
      };

      vi.doMock("../../src/lib/db/driver.js", () => ({
        getAdapter: async () => mockAdapter,
      }));

      const { saveRequestUsage } = await import("../../src/lib/db/repos/usageRepo.js");

      await saveRequestUsage({
        provider: "codex",
        model: "gpt-5.6-terra",
        requestedModel: "claude-sonnet-4-6",
        comboChain: ["claude-sonnet-4-6", "gpt-5.6-terra"],
        tokens: { prompt_tokens: 10, completion_tokens: 20 },
        timestamp: new Date().toISOString(),
      });

      expect(savedMeta).toEqual(expect.objectContaining({
        requestedModel: "claude-sonnet-4-6",
        comboChain: ["claude-sonnet-4-6", "gpt-5.6-terra"],
      }));
    });
  });
});
