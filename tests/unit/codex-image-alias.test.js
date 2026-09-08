import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCodexImageModel } from "../../open-sse/config/codexConstants.js";
const mocks = vi.hoisted(() => ({ credentials: vi.fn(), core: vi.fn(), modelInfo: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireApiKey: true }) }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.credentials, markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
  extractApiKey: (r) => r.headers.get("authorization"), isValidApiKey: async (key) => key === "Bearer fixture",
}));
vi.mock("../../src/sse/services/model.js", () => ({ getComboModels: async () => null, getModelInfo: mocks.modelInfo }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, creds) => creds, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: mocks.core }));
import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";
const alias = '{"gpt-5.5-image":"gpt-5.6-luna-image"}';
function request(key = "fixture") {
  return new Request("http://localhost/v1/images/generations", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "cx/gpt-5.5-image", prompt: "fixture" }) });
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Codex image aliases", () => {
  it("does not rewrite models by default or infer a global retirement", () => {
    expect(resolveCodexImageModel("gpt-5.5-image", "")).toBe("gpt-5.5-image");
    expect(resolveCodexImageModel("gpt-5.4-image", alias)).toBe("gpt-5.4-image");
  });
  it.each(["invalid", "null", "[]", '{"gpt-5.5-image":"https://example.org"}', '{"gpt-5.5-image":42}'])("rejects invalid configuration %s", (value) => {
    expect(() => resolveCodexImageModel("gpt-5.5-image", value)).toThrow("CODEX_IMAGE_MODEL_ALIASES");
  });
  it("uses only explicit, exact, single-hop aliases", () => {
    expect(resolveCodexImageModel("gpt-5.5-image", alias)).toBe("gpt-5.6-luna-image");
    expect(resolveCodexImageModel("gpt-5.5-image", '{"gpt-5.5-image":"gpt-5.6-luna-image","gpt-5.6-luna-image":"gpt-5.6-sol-image"}')).toBe("gpt-5.6-luna-image");
  });
  it.each(["codex", "openai"])("applies configured aliases only to Codex before credential selection (%s)", async (provider) => {
    vi.stubEnv("CODEX_IMAGE_MODEL_ALIASES", alias);
    mocks.modelInfo.mockResolvedValue({ provider, model: "gpt-5.5-image" });
    mocks.credentials.mockResolvedValue({ connectionId: "fixture" });
    mocks.core.mockResolvedValue({ success: true, response: Response.json({ data: [] }) });
    expect((await handleImageGeneration(request())).status).toBe(200);
    const expected = provider === "codex" ? "gpt-5.6-luna-image" : "gpt-5.5-image";
    expect(mocks.credentials.mock.calls[0][2]).toBe(expected);
    expect(mocks.core.mock.calls[0][0].modelInfo.model).toBe(expected);
  });
  it("rejects invalid API keys before model resolution or upstream access", async () => {
    expect((await handleImageGeneration(request("wrong"))).status).toBe(401);
    expect(mocks.modelInfo).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("reports invalid server alias configuration before using credentials", async () => {
    vi.stubEnv("CODEX_IMAGE_MODEL_ALIASES", "invalid");
    mocks.modelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.5-image" });
    expect((await handleImageGeneration(request())).status).toBe(400);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
});
