import { describe, it, expect } from "vitest";
import {
  addCustomModel,
  deleteCustomModel,
  getCustomModels,
  pruneCustomModels,
} from "../../src/lib/db/repos/aliasRepo.js";
import {
  buildLeaderboardIndex,
  classifyModel,
} from "../../src/lib/aihot/modelMatcher.js";

const TEST_CATALOG = [
  {
    slug: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    rawAliases: ["anthropic/claude-opus-5-5"],
  },
  {
    slug: "gpt-6-astra",
    name: "GPT-6 Astra",
    rawAliases: ["openai/gpt-6-astra"],
  },
  {
    slug: "deepseek-v-4-1-flash",
    name: "DeepSeek V4.1 Flash",
    rawAliases: ["deepseek-ai/DeepSeek-V4.1-Flash"],
  },
];

describe("models cleanup and dynamic resurrection", () => {
  const index = buildLeaderboardIndex(TEST_CATALOG);

  it("prunes customModels keeping only specified keys without affecting others", async () => {
    const existing = await getCustomModels();
    const existingKeys = existing.map((m) => `${m.providerAlias}|${m.id}|${m.type || m.kind || "llm"}`);

    // Add test models
    await addCustomModel({ providerAlias: "test-prune", id: "keep-me", name: "Keep Me" });
    await addCustomModel({ providerAlias: "test-prune", id: "delete-me", name: "Delete Me" });

    const keyToKeep = "test-prune|keep-me|llm";
    const keysToPreserve = [...existingKeys, keyToKeep];
    const deletedCount = await pruneCustomModels(keysToPreserve);

    expect(deletedCount).toBe(1);

    const remaining = await getCustomModels();
    const remainingIds = remaining.map((m) => m.id);
    expect(remainingIds).toContain("keep-me");
    expect(remainingIds).not.toContain("delete-me");

    // Clean up test model
    await deleteCustomModel({ providerAlias: "test-prune", id: "keep-me" });
  });

  it("resurrects/whitelists a model when it appears on the leaderboard even if previously rejected", () => {
    // Stale user decision: "claude-opus-5-5" was rejected previously
    const staleDecisions = {
      "claude-opus-5-5": { decision: "reject", updatedAt: "2026-01-01" },
    };

    // But now it is on the fresh leaderboard index!
    const res = classifyModel("claude-opus-5-5", index, staleDecisions);

    // Fresh leaderboard presence overrides stale rejection
    expect(res.status).toBe("keep");
    expect(res.reason).toBe("exact_slug_match");
  });

  it("still rejects models not on leaderboard if user marked them reject", () => {
    const memory = {
      "unknown-variant-x": { decision: "reject" },
    };

    const res = classifyModel("unknown-variant-x", index, memory);
    expect(res.status).toBe("reject");
    expect(res.reason).toBe("remembered_user_reject");
  });
});
