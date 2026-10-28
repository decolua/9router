import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ providerOverrides: { openrouter: { routing: { zdr: true, quantizations: ["bf16"] } } } }) }));
const target = vi.hoisted(() => ({ model: "typesafe/jev-1.13" }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "openrouter", model: target.model }) }));
vi.mock("../../src/sse/services/auth.js", () => ({ getProviderCredentials: async () => ({ apiKey: "test" }) }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_provider, credentials) => credentials }));

import { resolveSmartChoice } from "../../src/sse/services/systemoneRouter.js";

afterEach(() => {
  vi.unstubAllGlobals();
  target.model = "typesafe/jev-1.13";
});

it("enforces saved OpenRouter policy on internal Smart Router inference", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {} })));
  vi.stubGlobal("fetch", fetchMock);
  await resolveSmartChoice({
    body: { messages: [{ role: "user", content: "Choose a model for coding" }] },
    models: ["openrouter/vendor/model-a", "openrouter/vendor/model-b"],
    routerModel: "openrouter/typesafe/jev-1.13",
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ zdr: true, quantizations: ["bf16"] });
});

it("keeps ZDR but omits saved precision on proprietary Smart Router inference", async () => {
  target.model = "anthropic/claude-sonnet-4.5";
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {} })));
  vi.stubGlobal("fetch", fetchMock);
  await resolveSmartChoice({
    body: { messages: [{ role: "user", content: "Choose a model for coding" }] },
    models: ["openrouter/vendor/model-a", "openrouter/vendor/model-b"],
    routerModel: "openrouter/anthropic/claude-sonnet-4.5",
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.model).toBe(target.model);
  expect(body.provider).toEqual({ zdr: true });
});
