import { describe, expect, it } from "vitest";

import { getProviderModelsForMapping } from "../../src/shared/constants/cliTools.js";

describe("getProviderModelsForMapping", () => {
  it("keeps only canonically eligible active connections", () => {
    const providers = [
      {
        id: "conn-eligible",
        provider: "codex",
        name: "Eligible",
        isActive: true,
        routingStatus: "eligible",
        testStatus: "unknown",
        models: ["gpt-4.1"],
      },
      {
        id: "conn-blocked",
        provider: "codex",
        name: "Blocked",
        isActive: true,
        routingStatus: "blocked",
        reasonCode: "auth_invalid",
        testStatus: "active",
        models: ["gpt-4.1"],
      },
      {
        id: "conn-exhausted",
        provider: "codex",
        name: "Exhausted",
        isActive: true,
        routingStatus: "exhausted",
        testStatus: "success",
        models: ["gpt-4.1"],
      },
      {
        id: "conn-inactive",
        provider: "codex",
        name: "Inactive",
        isActive: false,
        routingStatus: "eligible",
        testStatus: "active",
        models: ["gpt-4.1"],
      },
    ];

    expect(getProviderModelsForMapping(providers)).toEqual([
      {
        connectionId: "conn-eligible",
        provider: "codex",
        name: "Eligible",
        models: ["gpt-4.1"],
      },
    ]);
  });
});
