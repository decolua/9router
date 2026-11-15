import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

function transformSystem(model, systemContent, userContent = "hello") {
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
  const body = openaiToAntigravityRequest(model, { messages }, true);
  const finalBody = new AntigravityExecutor().transformRequest(model, body, true, {});
  return {
    systemText: finalBody.request.systemInstruction?.parts?.map((p) => p.text).join("\n") ?? "",
    userText: finalBody.request.contents?.[0]?.parts?.map((p) => p.text).join("\n") ?? "",
  };
}

describe("Antigravity rewrites OpenClaw personal assistant prompt", () => {
  const models = ["gemini-3.8-flash-high", "claude-sonnet-5-5-high"];

  for (const model of models) {
    it(`rewrites exact sentence for ${model}`, () => {
      const input = "You are a personal assistant running inside OpenClaw.";
      const { systemText } = transformSystem(model, input);
      expect(systemText).toBe("You are a personal assistant.");
    });

    it(`handles mixed case and prefix newline for ${model}`, () => {
      const input = "\n\nyou are a personal assistant running inside openclaw.";
      const { systemText } = transformSystem(model, input);
      expect(systemText).toContain("You are a personal assistant.");
      expect(systemText).not.toContain("running inside OpenClaw");
    });

    it(`preserves unrelated instructions and no-period phrase for ${model}`, () => {
      const input = "Keep this instruction.\nYou are a personal assistant running inside OpenClaw\nFollow all rules.";
      const { systemText } = transformSystem(model, input);
      expect(systemText).toContain("Keep this instruction.");
      expect(systemText).toContain("You are a personal assistant running inside OpenClaw");
      expect(systemText).toContain("Follow all rules.");
    });

    it(`preserves user conversation text untouched for ${model}`, () => {
      const userMsg = "Please tell me: You are a personal assistant running inside OpenClaw.";
      const { userText } = transformSystem(model, "System prompt.", userMsg);
      expect(userText).toContain(userMsg);
    });
  }

  it("preserves multipart systemInstruction parts while rewriting target sentence", () => {
    const rawBody = {
      model: "gemini-3.8-flash-high",
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        systemInstruction: {
          role: "user",
          parts: [
            { text: "Preamble." },
            { text: "You are a personal assistant running inside OpenClaw." },
            { text: "Postamble." },
          ],
        },
      },
    };
    const finalBody = new AntigravityExecutor().transformRequest("gemini-3.8-flash-high", rawBody, true, {});
    const parts = finalBody.request.systemInstruction.parts;
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toBe("Preamble.");
    expect(parts[1].text).toBe("You are a personal assistant.");
    expect(parts[2].text).toBe("Postamble.");
  });
});
