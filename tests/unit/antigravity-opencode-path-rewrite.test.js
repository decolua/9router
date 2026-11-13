import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

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

describe("Antigravity prompt rewrites preserve paths and identifiers while rebranding identity tokens (#5650)", () => {
  it("rewrites standalone OpenCode identity tokens", () => {
    const text = systemTextSentToAntigravity("You are OpenCode, an AI assistant. Tokens: opencode OpenCode OPENCODE.");
    expect(text).toBe("You are Antigravity, an AI assistant. Tokens: antigravity Antigravity ANTIGRAVITY.");
  });

  it("preserves paths, directories, extensions, URLs, and identifiers containing opencode", () => {
    const original = [
      "Working dir is /tmp/opencode-sys-123",
      "Config in ~/.config/opencode/opencode.json",
      "Windows path: C:\\Users\\user\\opencode\\project",
      "Identifier: const opencode_client = 1;",
      "Package: @opencode/sdk and opencode@1.2.0",
      "URL: https://github.com/opencode/opencode.git",
      "File: opencode.ts and opencode.js",
    ].join("\n");

    const text = systemTextSentToAntigravity(original);
    expect(text).toBe(original);
  });
});
