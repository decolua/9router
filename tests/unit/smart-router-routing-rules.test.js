import { describe, it, expect, beforeEach, vi } from "vitest";

const handleSystemoneCore = vi.fn();

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "opencode", model: "jev-1.13-free" })),
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(async () => ({ apiKey: "test" })),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({
  handleSystemoneCore: (...args) => handleSystemoneCore(...args),
}));

const { resolveSmartChoice } = await import("../../src/sse/services/systemoneRouter.js");

const body = { messages: [{ role: "user", content: "Refactor this module" }] };
const models = ["combo-pro", "combo-deep"];

describe("resolveSmartChoice routing rules payload", () => {
  beforeEach(() => {
    handleSystemoneCore.mockReset();
    handleSystemoneCore.mockResolvedValue({
      success: true,
      response: { json: async () => ({ answers: { route: { choice: "combo-deep", confidence: 0.9 } } }) },
    });
  });

  it("sends custom instructions and member descriptions to System One", async () => {
    const route = await resolveSmartChoice({
      body,
      models,
      routerInstructions: "  Pick the cheapest member that can do the job.  ",
      memberDescriptions: { "combo-deep": " hard multi-step reasoning ", "not-a-member": "ignored" },
    });

    expect(route.choice).toBe("combo-deep");
    expect(handleSystemoneCore).toHaveBeenCalledTimes(1);
    expect(handleSystemoneCore.mock.calls[0][0].body).toEqual({
      model: "jev-1.13-free",
      state: "Refactor this module",
      questions: {
        route: {
          type: "choice",
          instructions: "Pick the cheapest member that can do the job.",
          criteria: { "combo-pro": null, "combo-deep": "hard multi-step reasoning" },
        },
      },
    });
  });

  it("keeps the payload byte-for-byte unchanged when nothing is configured", async () => {
    const legacy = JSON.stringify({
      model: "jev-1.13-free",
      state: "Refactor this module",
      questions: {
        route: {
          type: "choice",
          instructions: "Which of these configured models is the most appropriate for this request?",
          criteria: { "combo-pro": null, "combo-deep": null },
        },
      },
    });

    const variants = [
      {},
      { routerInstructions: undefined, memberDescriptions: undefined },
      { routerInstructions: "", memberDescriptions: {} },
      { routerInstructions: "   ", memberDescriptions: { "combo-pro": "  " } },
    ];
    for (const extra of variants) {
      handleSystemoneCore.mockClear();
      await resolveSmartChoice({ body, models, ...extra });
      expect(JSON.stringify(handleSystemoneCore.mock.calls[0][0].body)).toBe(legacy);
    }
  });
});
