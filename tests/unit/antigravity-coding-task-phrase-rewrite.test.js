import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// Exact sentence pair that makes the Cloud Code PA backend answer a bare
// 429 RESOURCE_EXHAUSTED even when the account still has quota left.
const TRIGGER = "You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.";
const REWRITTEN = "work on their coding tasks. Keep responses concise and practical, and use the available tools when they help.";

function systemTextSentToAntigravity(systemContent) {
  const body = openaiToAntigravityRequest("gemini-3.8-flash-tiered", {
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: "hi" },
    ],
  }, true);
  const finalBody = new AntigravityExecutor().transformRequest("gemini-3.8-flash-tiered", body, true, {});
  return finalBody.request.systemInstruction.parts.map((p) => p.text).join("\n");
}

describe("Antigravity rewrites the coding-task sentence that triggers a false 429", () => {
  it("removes the trigger substring from the system prompt", () => {
    const text = systemTextSentToAntigravity(TRIGGER);
    expect(text).not.toContain("solve coding tasks. Be concise, practical, and tool-aware.");
    expect(text).toContain(REWRITTEN);
  });

  it("keeps the surrounding instructions intact", () => {
    const text = systemTextSentToAntigravity(`Preamble.\n${TRIGGER}\nPostamble.`);
    expect(text).toContain("Preamble.");
    expect(text).toContain("Postamble.");
    expect(text).not.toContain("solve coding tasks. Be concise, practical, and tool-aware.");
  });

  it("matches case-insensitively and across a line break", () => {
    const text = systemTextSentToAntigravity("SOLVE CODING TASKS.\nBE CONCISE, PRACTICAL, AND TOOL-AWARE.");
    expect(text.toLowerCase()).not.toContain("be concise, practical, and tool-aware.");
  });

  it("leaves an already-safe reworded prompt untouched", () => {
    const safe = "You pair program with the user on coding tasks. Keep answers concise, practical, and tool-aware.";
    expect(systemTextSentToAntigravity(safe)).toContain(safe);
  });

  it("rewrites every systemInstruction part, including replayed client prompts", () => {
    const body = {
      model: "gemini-3.8-flash-tiered",
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        systemInstruction: {
          role: "user",
          parts: [
            { text: "Preamble." },
            { text: TRIGGER },
            { text: TRIGGER },
          ],
        },
      },
    };
    const finalBody = new AntigravityExecutor().transformRequest("gemini-3.8-flash-tiered", body, true, {});
    const parts = finalBody.request.systemInstruction.parts;
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toBe("Preamble.");
    expect(parts[1].text).toContain(REWRITTEN);
    expect(parts[2].text).toContain(REWRITTEN);
    expect(parts.map((p) => p.text).join("\n")).not.toContain("solve coding tasks. Be concise, practical, and tool-aware.");
  });
});
