// Guards the refactored USAGE_HANDLERS dispatch: unsupported → message, supported → routed.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub network so handlers don't hit real APIs; each call resolves an empty 200.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "{}",
  })),
}));

// Spy handler: the dispatch ctx must carry authType so lease-mode handlers can see it.
const mcode = vi.hoisted(() => ({ getMiniMaxCodeUsage: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../open-sse/services/minimaxCodeUsage.js", () => mcode);

const load = () => import("../../open-sse/services/usage.js");
const SUPPORTED = [
  "github", "gemini-cli", "antigravity", "claude", "codex", "kiro",
  "qoder", "qoder-cn", "iflow", "ollama", "glm", "glm-cn",
  "minimax", "minimax-cn", "minimax-code", "minimax-code-global", "vercel-ai-gateway", "grok-cli", "kimi",
  "deepseek", "opencode-go", "zed", "commandcode", "synthetic",
];

// The first case imports the usage-provider graph, which exceeds the 5s default under
// full-suite load (it passes in isolation).
describe("usage dispatch", { timeout: 20_000 }, () => {
  beforeEach(() => vi.clearAllMocks());

  it("unsupported provider → not-implemented message", async () => {
    const { getUsageForProvider } = await load();
    const res = await getUsageForProvider({ provider: "totally-unknown" });
    expect(res).toEqual({ message: "Usage API not implemented for totally-unknown" });
  });

  it("every supported provider routes to its handler (no fallback message)", async () => {
    const { getUsageForProvider } = await load();
    for (const provider of SUPPORTED) {
      const res = await getUsageForProvider({ provider, accessToken: "t", apiKey: "k" });
      // Routed handler must return an object and never the unsupported fallback
      expect(res, `${provider} routed`).toBeTypeOf("object");
      expect(res?.message).not.toBe(`Usage API not implemented for ${provider}`);
    }
  });

  it("routes authType through to the handler (lease connections rely on it)", async () => {
    const { getUsageForProvider } = await load();
    await getUsageForProvider({ provider: "minimax-code", authType: "mcode-lease" });
    expect(mcode.getMiniMaxCodeUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "minimax-code", authType: "mcode-lease" }),
    );
  });
});
