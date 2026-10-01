import { describe, expect, it } from "vitest";

import agnes from "../../open-sse/providers/registry/agnes.js";

// Seeds for Agnes AI. The live catalogue (apihub.agnes-ai.com/v1/models)
// answers 401 without a token, so these ids are a curated starting set and
// passthroughModels still accepts anything the account actually has.

describe("agnes registry model seeds", () => {
  it("declares the four 2.5/3.0 models", () => {
    expect(agnes.models.map((m) => m.id)).toEqual([
      "agnes-2.5-flash",
      "agnes-2.5-pro",
      "agnes-2.5-pro-beta",
      "agnes-3.0-flash",
    ]);
  });

  it("gives every model a display name", () => {
    for (const m of agnes.models) {
      expect(typeof m.name, m.id).toBe("string");
      expect(m.name.length, m.id).toBeGreaterThan(0);
    }
  });

  it("keeps passthroughModels so newer ids still work", () => {
    expect(agnes.passthroughModels).toBe(true);
  });

  it("does not claim a modelsFetcher for an endpoint that needs a token", () => {
    // /v1/models returns 401 "Token not provided" without auth, so a public
    // modelsFetcher would just surface an error instead of a list.
    expect(agnes.modelsFetcher).toBeUndefined();
  });

  it("leaves transport untouched", () => {
    expect(agnes.transport.baseUrl).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
    expect(agnes.transport.validateUrl).toBe("https://apihub.agnes-ai.com/v1/models");
  });
});
