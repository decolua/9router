import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

// Guards Kiro model ids that still need mappable defaultModels slots. Without
// a slot, getMappedModel (src/mitm/server.js) returns null and the request is
// passed through to AWS instead of being routed to the user's chosen provider.
describe("Kiro MITM model slots", () => {
  const kiro = MITM_TOOLS.kiro;

  it("exposes the kiro mitm tool", () => {
    expect(kiro).toBeTruthy();
    expect(kiro.configType).toBe("mitm");
    expect(Array.isArray(kiro.defaultModels)).toBe(true);
  });

  it("offers a mappable slot for the agent default model id 'auto'", () => {
    // اسلات auto برای vibe mode لازمه — وگرنه درخواست میره AWS
    const auto = kiro.defaultModels.find((m) => m.id === "auto");
    expect(auto).toBeTruthy();
    expect(auto.alias).toBe("auto");
  });

  it("offers a mappable slot for Claude Sonnet 4.5", () => {
    const sonnet = kiro.defaultModels.find((m) => m.id === "claude-sonnet-4.5");
    expect(sonnet).toBeTruthy();
    expect(sonnet.alias).toBe("claude-sonnet-4.5");
  });

  it("offers a mappable slot for the background sub-task model id 'simple-task'", () => {
    const simpleTask = kiro.defaultModels.find((m) => m.id === "simple-task");
    expect(simpleTask).toBeTruthy();
    expect(simpleTask.alias).toBe("simple-task");
  });

  it("keeps experimental GPT-5.6 tiers out of static MITM slots (live-catalog only)", () => {
    const ids = kiro.defaultModels.map((m) => m.id);
    expect(ids).not.toContain("gpt-5.6-sol");
    expect(ids).not.toContain("gpt-5.6-terra");
    expect(ids).not.toContain("gpt-5.6-luna");
  });
});

describe("Kiro static provider models", () => {
  it("includes the base catalog present on every account", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining([
      "auto",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "deepseek-3.2",
      "glm-5",
      "MiniMax-M2.5",
    ]));
  });

  it("keeps experimental GPT-5.6 tiers out of the static registry (live-catalog only)", () => {
    const ids = (PROVIDER_MODELS.kr || []).map((model) => model.id);
    expect(ids).not.toContain("gpt-5.6-sol");
    expect(ids).not.toContain("gpt-5.6-terra");
    expect(ids).not.toContain("gpt-5.6-luna");
  });
});
