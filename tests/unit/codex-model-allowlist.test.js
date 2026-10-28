import { describe, expect, it } from "vitest";
import { isConnectionAllowedForModel } from "../../src/sse/services/auth.js";

describe("Codex account model allowlists", () => {
  it("keeps legacy accounts eligible for every model", () => {
    expect(isConnectionAllowedForModel({}, "gpt-6-astra")).toBe(true);
    expect(isConnectionAllowedForModel({ allowedModels: null }, "gpt-6-astra")).toBe(true);
    expect(isConnectionAllowedForModel({ allowedModels: [] }, "gpt-6-astra")).toBe(true);
  });

  it("only admits explicitly selected models", () => {
    const account = { allowedModels: ["gpt-6-astra"] };
    expect(isConnectionAllowedForModel(account, "gpt-6-astra")).toBe(true);
    expect(isConnectionAllowedForModel(account, "gpt-5.6-terra")).toBe(false);
  });
});
