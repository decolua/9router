import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import {
  DEFAULT_THINKING_AG_SIGNATURE,
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
} from "../../open-sse/config/defaultThinkingSignature.js";

describe("Antigravity tool execution and data bridge alignment", () => {
  const executor = new AntigravityExecutor();

  it("combines multiple system messages instead of overwriting earlier ones", () => {
    const req = {
      model: "gemini-4-argon-high",
      messages: [
        { role: "system", content: "INSTRUCTION_ALPHA" },
        { role: "system", content: "INSTRUCTION_BETA" },
        { role: "user", content: "hello" },
      ],
    };

    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      "gemini-4-argon-high",
      req,
      true,
      { _clientSessionId: "sess-1", projectId: "proj-1" },
      "antigravity"
    );

    const systemParts = out.request?.systemInstruction?.parts || [];
    const fullSystemText = systemParts.map((p) => p.text).join("\n");
    expect(fullSystemText).toContain("INSTRUCTION_ALPHA");
    expect(fullSystemText).toContain("INSTRUCTION_BETA");
  });

  it("does not double-wrap string tool results in { result: { result: ... } }", () => {
    const req = {
      model: "gemini-4-argon-high",
      messages: [
        { role: "user", content: "check status" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_git_1", type: "function", function: { name: "git", arguments: '{"args":"status"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_git_1", content: "On branch main\nnothing to commit" },
      ],
    };

    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      "gemini-4-argon-high",
      req,
      true,
      { _clientSessionId: "sess-1", projectId: "proj-1" },
      "antigravity"
    );

    const transformed = executor.transformRequest(
      "gemini-4-argon-high",
      translated,
      true,
      { _clientSessionId: "sess-1", projectId: "proj-1" }
    );

    const toolMsg = transformed.request.contents.find(
      (c) => c.parts?.some((p) => p.functionResponse)
    );
    const fr = toolMsg?.parts.find((p) => p.functionResponse)?.functionResponse;
    expect(fr).toBeDefined();
    expect(fr.id).toBe("call_git_1");
    expect(fr.name).toBe("git");
    expect(fr.response).toEqual({ result: "On branch main\nnothing to commit" });
    // Must NOT be double-wrapped
    expect(fr.response.result).not.toHaveProperty("result");
  });

  it("formats failed tool execution (is_error: true) as response: { error: ... }", () => {
    const claudeReq = {
      model: "gemini-4-argon-high",
      messages: [
        { role: "user", content: "run invalid" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_err_1", name: "Bash", input: { command: "exit 1" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_err_1",
              content: "command failed with exit code 1",
              is_error: true,
            },
          ],
        },
      ],
    };

    const translated = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.ANTIGRAVITY,
      "gemini-4-argon-high",
      claudeReq,
      true,
      { _clientSessionId: "sess-1", projectId: "proj-1" },
      "antigravity"
    );

    const transformed = executor.transformRequest(
      "gemini-4-argon-high",
      translated,
      true,
      { _clientSessionId: "sess-1", projectId: "proj-1" }
    );

    const toolMsg = transformed.request.contents.find(
      (c) => c.parts?.some((p) => p.functionResponse)
    );
    const fr = toolMsg?.parts.find((p) => p.functionResponse)?.functionResponse;
    expect(fr).toBeDefined();
    expect(fr.response).toHaveProperty("error");
    expect(fr.response.error).toContain("command failed with exit code 1");
  });

  it("selects correct default signature family for Gemini vs Claude models", () => {
    // Gemini model with no cached signature should use Gemini signature
    const geminiTransformed = executor.transformRequest(
      "gemini-4-argon-high",
      {
        request: {
          contents: [
            {
              role: "user",
              parts: [{ text: "hi" }],
            },
            {
              role: "model",
              parts: [{ functionCall: { id: "call_1", name: "Read", args: {} } }],
            },
          ],
        },
      },
      true,
      { _clientSessionId: "sess-1" }
    );
    const geminiModelMsg = geminiTransformed.request.contents.find((c) => c.role === "model");
    const geminiSig = geminiModelMsg?.parts[0]?.thoughtSignature;
    expect(geminiSig).toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);

    // Claude model with no cached signature should use Claude AG signature
    const claudeTransformed = executor.transformRequest(
      "claude-sonnet-5-5-high",
      {
        request: {
          contents: [
            {
              role: "user",
              parts: [{ text: "hi" }],
            },
            {
              role: "model",
              parts: [{ functionCall: { id: "call_2", name: "Read", args: {} } }],
            },
          ],
        },
      },
      true,
      { _clientSessionId: "sess-2" }
    );
    const claudeModelMsg = claudeTransformed.request.contents.find((c) => c.role === "model");
    const claudeSig = claudeModelMsg?.parts[0]?.thoughtSignature;
    expect(claudeSig).toBe(DEFAULT_THINKING_AG_SIGNATURE);
  });

  it("defaults Claude Antigravity max_tokens to 64000 matching server limit", () => {
    const claudeReq = {
      model: "claude-sonnet-5-5-high",
      messages: [{ role: "user", content: "write large file" }],
    };

    const translated = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.ANTIGRAVITY,
      "claude-sonnet-5-5-high",
      claudeReq,
      true,
      { _clientSessionId: "sess-1", projectId: "proj-1" },
      "antigravity"
    );

    expect(translated.request.generationConfig.maxOutputTokens).toBe(64000);
  });
});
