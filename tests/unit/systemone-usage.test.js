import { afterEach, expect, it, vi } from "vitest";
const saved = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: saved }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}) }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({ connectionId: "account", apiKey: "secret" }),
  extractApiKey: () => "client", isValidApiKey: async () => true,
  clearAccountError: async () => {}, markAccountUnavailable: async () => ({ shouldFallback: false }),
}));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "ollama-local", model: "clef" }) }));
vi.mock("../../src/sse/services/keyAccess.js", () => ({ getKeyAccessContext: async () => ({}), enforceKeyAccessResolved: async () => null }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_, credentials) => credentials }));
import { handleSystemone } from "../../src/sse/handlers/systemone.js";
import { resolveSmartChoice } from "../../src/sse/services/systemoneRouter.js";
afterEach(() => { vi.unstubAllGlobals(); saved.mockClear(); });
it.each([undefined, { input_tokens: 3, output_tokens: 2 }, { prompt_tokens: 4, completion_tokens: 1 }])("records direct decision inference with optional reported usage", async (usage) => {
  vi.stubGlobal("fetch", async () => Response.json({ usage, answers: {} }));
  const response = await handleSystemone(new Request("http://localhost/v1/systemone", { method: "POST", body: JSON.stringify({ model: "ollama-local/clef", state: "s", questions: {} }) }));
  expect(response.status).toBe(200);
  expect(saved.mock.calls[0][0]).toMatchObject({ endpoint: "/v1/systemone", apiKey: "client", connectionId: "account", status: "success", tokens: usage ? { prompt_tokens: usage.input_tokens ?? usage.prompt_tokens, completion_tokens: usage.output_tokens ?? usage.completion_tokens } : {} });
});
it("records internal router failure with caller attribution", async () => {
  vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
  expect(await resolveSmartChoice({ body: { messages: [{ role: "user", content: "route me" }] }, models: ["a", "b"], apiKey: "client", endpoint: "/v1/chat/completions" })).toBeNull();
  expect(saved.mock.calls[0][0]).toMatchObject({ provider: "ollama-local", model: "clef", connectionId: "account", apiKey: "client", endpoint: "/v1/chat/completions", status: "503", tokens: {} });
});
it("records internal router timeout once even if upstream later settles", async () => {
  vi.stubGlobal("fetch", async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return Response.json({}); });
  expect(await resolveSmartChoice({ body: { messages: [{ role: "user", content: "route me" }] }, models: ["a", "b"], timeoutMs: 1 })).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(saved).toHaveBeenCalledTimes(1);
  expect(saved.mock.calls[0][0].status).toBe("504");
});
