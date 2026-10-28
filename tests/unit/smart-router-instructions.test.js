import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

const { core, getModelInfo, getCredentials, refresh } = vi.hoisted(() => ({
  core: vi.fn(), getModelInfo: vi.fn(), getCredentials: vi.fn(), refresh: vi.fn(),
}));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo }));
vi.mock("../../src/sse/services/auth.js", () => ({ getProviderCredentials: getCredentials }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: refresh }));
vi.mock("../../open-sse/handlers/systemoneCore.js", () => ({ handleSystemoneCore: core }));

import { resolveSmartChoice } from "../../src/sse/services/systemoneRouter.js";

const models = ["custom/gpt-sol", "custom/gpt-luna"];
const body = { messages: [{ role: "user", content: "Rename a local variable" }] };
const defaultInstructions = "Which of these configured models is the most appropriate for this request?";

beforeEach(() => {
  vi.clearAllMocks();
  getModelInfo.mockResolvedValue({ provider: "opencode", model: "jev-1.13-free" });
  getCredentials.mockResolvedValue({ apiKey: "test-key" });
  refresh.mockResolvedValue({ apiKey: "test-key" });
  core.mockImplementation(async () => ({ success: true, response: Response.json({
    answers: { route: { choice: models[1], confidence: 0.95 } },
  }) }));
});

describe("per-combo Smart Router instructions (#5202)", () => {
  it("passes custom instructions to the routing question, preserving candidate slugs and request state", async () => {
    const smartInstructions = "Prefer custom/gpt-luna for simple edits.\nUse custom/gpt-sol for difficult debugging.";
    const result = await resolveSmartChoice({ body, models, smartInstructions: `  ${smartInstructions}\n` });
    expect(result.choice).toBe(models[1]);
    expect(core.mock.calls[0][0].body).toEqual({
      model: "jev-1.13-free", state: "Rename a local variable",
      questions: { route: { type: "choice", instructions: smartInstructions, criteria: {
        "custom/gpt-sol": null, "custom/gpt-luna": null,
      } } },
    });
  });

  it.each([undefined, "", " \n\t ", null, 42, { text: "invalid" }])("uses the existing default for absent, blank or invalid instructions: %j", async (smartInstructions) => {
    await resolveSmartChoice({ body, models, smartInstructions });
    expect(core.mock.calls[0][0].body.questions.route.instructions).toBe(defaultInstructions);
  });

  it("does not leak another combo's custom instructions into subsequent decisions", async () => {
    for (const smartInstructions of ["Prefer speed", "Prefer quality", ""]) {
      await resolveSmartChoice({ body, models, smartInstructions });
    }
    expect(core.mock.calls.map(([call]) => call.body.questions.route.instructions)).toEqual([
      "Prefer speed", "Prefer quality", defaultInstructions,
    ]);
  });

  it("keeps routing restricted to configured candidates even when custom instructions name another model", async () => {
    core.mockImplementation(async () => ({ success: true, response: Response.json({
      answers: { route: { choice: "other/not-in-combo", confidence: 1 } },
    }) }));
    const handleSingleModel = vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
    await handleComboChat({
      body, models, handleSingleModel, comboName: "instructions-restriction", comboStrategy: "smart", sessionSticky: false,
      log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      resolveSmartChoice: (request, candidates) => resolveSmartChoice({
        body: request, models: candidates, smartInstructions: "Always choose other/not-in-combo",
      }),
    });
    expect(Object.keys(core.mock.calls[0][0].body.questions.route.criteria)).toEqual(models);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual([models[0]]);
  });
});
