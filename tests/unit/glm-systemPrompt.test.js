import { describe, it, expect } from "vitest";
import { GlmExecutor, glmRequestContext } from "../../open-sse/executors/glm.js";

function atUrlIndex(executor, urlIndex, credentials, fn) {
  return glmRequestContext.run({ credentials, urlIndex }, () => {
    executor.buildUrl("glm-5.2", true, urlIndex, credentials);
    return fn();
  });
}
import {
  injectZcodeSystemPrompt,
  ZCODE_SYSTEM_IDENTITY_MARKER,
  buildZcodeEnvironmentBlock,
} from "../../src/lib/zcode/systemPrompt.js";

describe("injectZcodeSystemPrompt", () => {
  it("replaces Claude Code system prompt with ZCode blocks", () => {
    const body = {
      model: "GLM-5.2",
      system: [
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };

    const out = injectZcodeSystemPrompt(body, { modelRef: "builtin:zai-start-plan/GLM-5.2" });

    expect(JSON.stringify(out.system)).toContain(ZCODE_SYSTEM_IDENTITY_MARKER);
    expect(JSON.stringify(out.system)).not.toContain("Claude Code");
    expect(out.system).toHaveLength(3);
    expect(out.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("is idempotent when ZCode blocks are already present", () => {
    const body = injectZcodeSystemPrompt(
      { model: "GLM-5.2", system: [] },
      { modelRef: "builtin:zai-start-plan/GLM-5.2" }
    );
    const again = injectZcodeSystemPrompt(body);
    expect(again.system).toEqual(body.system);
  });

  it("preserves non-Claude caller system blocks after ZCode blocks", () => {
    const out = injectZcodeSystemPrompt({
      model: "GLM-5.2",
      system: [
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
        { type: "text", text: "Custom project rules" },
      ],
    });

    expect(out.system).toHaveLength(4);
    expect(out.system[3].text).toBe("Custom project rules");
  });

  it("includes model ref in environment block", () => {
    const text = buildZcodeEnvironmentBlock({
      modelRef: "builtin:zai-start-plan/GLM-5.2",
      workingDirectory: "/tmp/proj",
      platform: "darwin",
      shell: "zsh",
      osVersion: "darwin 25.5.0 arm64",
      isGitRepository: false,
    });
    expect(text).toContain("builtin:zai-start-plan/GLM-5.2");
    expect(text).toContain("Primary working directory: /tmp/proj");
  });
});

describe("GlmExecutor ZCode system prompt", () => {
  const codingPlanCreds = {
    apiKey: "org.key.secret",
    accessToken: "jwt-token",
    providerSpecificData: {
      useCodingPlan: true,
      zcodeJwtToken: "jwt-token",
    },
  };

  it("injects ZCode system on coding plan primary URL", () => {
    const executor = new GlmExecutor();
    const body = atUrlIndex(executor, 0, codingPlanCreds, () => executor.transformRequest(
      "glm-5.2",
      {
        model: "glm-5.2",
        system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
        messages: [],
      },
      false,
      codingPlanCreds
    ));

    expect(JSON.stringify(body.system)).toContain(ZCODE_SYSTEM_IDENTITY_MARKER);
    expect(JSON.stringify(body.system)).not.toContain("Claude Code");
  });

  it("does not inject ZCode system on API key fallback URL", () => {
    const executor = new GlmExecutor();
    const input = {
      model: "glm-5.2",
      system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
      messages: [],
    };
    const body = atUrlIndex(executor, 1, codingPlanCreds, () =>
      executor.transformRequest("glm-5.2", input, false, codingPlanCreds)
    );
    expect(body.system).toEqual(input.system);
  });
});