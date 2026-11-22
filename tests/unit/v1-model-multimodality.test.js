import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [
    { id: "gemini-connection", provider: "gemini", isActive: true, providerSpecificData: {} },
  ]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getStudioModels: vi.fn(async () => []),
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getAllowedModelsOfKey: vi.fn(async () => null),
  matchesAllowedModels: vi.fn(() => true),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

import { buildModelsList } from "@/app/api/v1/models/route.js";

describe("connected provider model modalities", () => {
  it("lists a multi-modality Gemini model once under both chat and STT filters", async () => {
    const chatModels = await buildModelsList(["llm"]);
    const sttModels = await buildModelsList(["stt"]);

    expect(chatModels.filter((model) => model.id === "gemini/gemini-2.5-pro")).toHaveLength(1);
    expect(sttModels.filter((model) => model.id === "gemini/gemini-2.5-pro")).toHaveLength(1);
  });
});
