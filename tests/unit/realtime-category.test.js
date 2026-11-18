import { describe, expect, it, vi } from "vitest";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers.js";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => ["openai", "codex"].map((provider) => ({ provider, isActive: true })),
  getCombos: async () => [],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));

import { buildModelsList } from "@/app/api/v1/models/route.js";
import { enforceKeyAccessResolved, filterModelsListForKey } from "@/sse/services/keyAccess.js";
import codex from "open-sse/providers/registry/codex.js";

describe("realtime category", () => {
  it("exposes typed OpenAI and Codex models without putting them in the LLM catalog", async () => {
    expect(codex.imageConfig.baseUrl).toBe("https://chatgpt.com/backend-api/codex/images/generations");
    expect(codex.models.filter((model) => model.kind === "image").map((model) => model.id)).toEqual(expect.arrayContaining(["gpt-image-2.5", "gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]));
    expect(MEDIA_PROVIDER_KINDS.find((kind) => kind.id === "realtime").endpoint.path).toBe("/v1/realtime");
    for (const [provider, model] of [["openai", "gpt-realtime"], ["codex", "gpt-live-1-codex"]]) {
      expect(AI_PROVIDERS[provider].serviceKinds).toContain("realtime");
      expect(getModelKind(getModelsByProviderId(provider).find((entry) => entry.id === model))).toBe("realtime");
    }
    const realtime = await buildModelsList(["realtime"]);
    const llm = await buildModelsList(["llm"]);
    expect(realtime.map((entry) => entry.id)).toEqual(expect.arrayContaining(["openai/gpt-realtime", "cx/gpt-live-1-codex"]));
    expect(llm.some((entry) => entry.id.endsWith("/gpt-live-1-codex") || entry.id.endsWith("/gpt-realtime"))).toBe(false);
    const context = { keyId: "test", keyName: "test", allow: ["cx/gpt-live-1-codex"], _sets: null };
    expect(await enforceKeyAccessResolved(context, "cx/gpt-live-1-codex", "codex", "gpt-live-1-codex")).toBeNull();
    expect((await enforceKeyAccessResolved(context, "openai/gpt-realtime", "openai", "gpt-realtime")).status).toBe(403);
    expect((await filterModelsListForKey(context, realtime)).map((entry) => entry.id)).toEqual(["cx/gpt-live-1-codex"]);
  });
});