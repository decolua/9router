import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  refreshCopilotToken: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshCopilotToken: mocks.refreshCopilotToken,
}));

import { clearCopilotModelCache, resolveCopilotModels } from "../../open-sse/services/copilotModels.js";

beforeEach(() => {
  mocks.proxyAwareFetch.mockReset();
  mocks.refreshCopilotToken.mockReset();
  clearCopilotModelCache();
});

describe("Copilot live model capabilities", () => {
  it("normalizes upstream limits and supported features", async () => {
    mocks.proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{
        id: "claude-fable-5",
        name: "Claude Fable 5",
        capabilities: {
          type: "chat",
          limits: {
            max_context_window_tokens: 264000,
            max_prompt_tokens: 200000,
            max_output_tokens: 64000,
          },
          supports: {
            adaptive_thinking: true,
            reasoning_effort: ["low", "medium", "high", "xhigh", "max"],
            tool_calls: true,
            vision: true,
          },
        },
        policy: { state: "enabled" },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await resolveCopilotModels({
      providerSpecificData: { copilotToken: "test-token" },
    }, { forceRefresh: true });

    expect(result.models).toEqual([{
      id: "claude-fable-5",
      name: "Claude Fable 5",
      capabilities: expect.objectContaining({
        contextWindow: 264000,
        maxPrompt: 200000,
        maxOutput: 64000,
        reasoning: true,
        tools: true,
        vision: true,
      }),
    }]);
  });
});
