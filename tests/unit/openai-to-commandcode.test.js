/**
 * Unit tests for open-sse/translator/request/openai-to-commandcode.js
 *
 * Verified live against upstream `/alpha/generate` (curl, 2026-05-07):
 *  - params.system: STRING at top level (Anthropic-style; "system" role NOT in messages[])
 *  - params.messages[*].role ∈ {"user","assistant","tool"}
 *  - params.messages[*].content: Array<content_block> (NEVER string)
 *  - tools[*]: Anthropic plain {name, description, input_schema}
 */

import { describe, it, expect } from "vitest";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";

const MODEL = "moonshotai/Kimi-K2.6";

describe("openaiToCommandCodeRequest — basic envelope", () => {
  it("returns the expected top-level envelope shape", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
    }, true);

    expect(out).toHaveProperty("threadId");
    expect(out).toHaveProperty("memory");
    expect(out).toHaveProperty("config");
    expect(out).toHaveProperty("params");
    expect(out.params.model).toBe(MODEL);
    expect(out.params.stream).toBe(true);
  });
});

describe("openaiToCommandCodeRequest — system handling", () => {
  it("hoists system messages to params.system (string), not messages[]", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "hi" },
      ],
    }, true);

    expect(typeof out.params.system).toBe("string");
    expect(out.params.system).toBe("You are concise.");
    const roles = out.params.messages.map((m) => m.role);
    expect(roles).not.toContain("system");
  });

  it("joins multiple system messages with blank line", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "system", content: "A" },
        { role: "system", content: "B" },
        { role: "user", content: "hi" },
      ],
    }, true);

    expect(out.params.system).toBe("A\n\nB");
  });

  it("omits params.system when no system messages", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(out.params.system).toBeUndefined();
  });
});

describe("openaiToCommandCodeRequest — content shape", () => {
  it("MUST always emit content as Array (never string) for user", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hello" }],
    }, true);

    const u = out.params.messages[0];
    expect(Array.isArray(u.content)).toBe(true);
    expect(u.content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("MUST always emit content as Array for assistant", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    }, true);
    const a = out.params.messages[1];
    expect(Array.isArray(a.content)).toBe(true);
    expect(a.content[0]).toEqual({ type: "text", text: "b" });
  });
});

describe("openaiToCommandCodeRequest — tool role / tool-result (AI SDK)", () => {
  it("converts role:\"tool\" to role:\"tool\" with tool-result block; output is {type:\"text\",value}", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "run X" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "do_x", arguments: "{\"a\":1}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", name: "do_x", content: "RESULT_OK" },
      ],
    }, true);

    const toolMsg = out.params.messages[out.params.messages.length - 1];
    expect(toolMsg.role).toBe("tool");
    const block = toolMsg.content[0];
    expect(block.type).toBe("tool-result");
    expect(block.toolCallId).toBe("call_1");
    expect(block.toolName).toBe("do_x");
    expect(block.output).toEqual({ type: "text", value: "RESULT_OK" });
  });

  it("resolves toolName from prior assistant tool_calls when name is omitted (Claude Code & OpenAI SDK standard)", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "read file" },
        {
          role: "assistant",
          content: "Let me check",
          tool_calls: [
            { id: "toolu_read_1", type: "function", function: { name: "Read", arguments: "{\"path\":\"a.txt\"}" } },
          ],
        },
        // Real-world Claude Code / OpenAI client turn: tool name is NOT sent on role: "tool"
        { role: "tool", tool_call_id: "toolu_read_1", content: "FILE_CONTENT" },
      ],
    }, true);

    const toolMsg = out.params.messages[out.params.messages.length - 1];
    expect(toolMsg.role).toBe("tool");
    const block = toolMsg.content[0];
    expect(block.toolCallId).toBe("toolu_read_1");
    expect(block.toolName).toBe("Read");
    expect(block.output).toEqual({ type: "text", value: "FILE_CONTENT" });
  });

  it("emits error-text output type when is_error is true", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "run command" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_bash_1", type: "function", function: { name: "Bash", arguments: "{\"command\":\"exit 1\"}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_bash_1", content: "Command failed: exit 1", is_error: true },
      ],
    }, true);

    const toolMsg = out.params.messages[out.params.messages.length - 1];
    const block = toolMsg.content[0];
    expect(block.toolName).toBe("Bash");
    expect(block.output).toEqual({ type: "error-text", value: "Command failed: exit 1" });
  });
});

describe("openaiToCommandCodeRequest — assistant reasoning handling", () => {
  it("does not inject empty reasoning block when assistant has tool_calls but no reasoning", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "I will call a tool",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "test", arguments: "{}" } },
          ],
        },
      ],
    }, true);

    const asst = out.params.messages[1];
    const reasoning = asst.content.find((b) => b.type === "reasoning");
    expect(reasoning).toBeUndefined();
  });

  it("preserves actual reasoning_content when present", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "think" },
        {
          role: "assistant",
          reasoning_content: "Step 1: analyze problem",
          content: "Here is the answer",
        },
      ],
    }, true);

    const asst = out.params.messages[1];
    const reasoning = asst.content.find((b) => b.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning.text).toBe("Step 1: analyze problem");
  });
});

describe("openaiToCommandCodeRequest — defaults & envelope", () => {
  it("defaults max_tokens to 64000 matching official CLI", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
    }, true);

    expect(out.params.max_tokens).toBe(64000);
    expect(out.memory).toBeNull();
    expect(out.taste).toBeNull();
    expect(out.skills).toBeNull();
    expect(out.permissionMode).toBe("standard");
  });

  it("preserves client max_tokens when specified", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16384,
    }, true);

    expect(out.params.max_tokens).toBe(16384);
  });

  it("forwards reasoning_effort inside params", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    }, true);

    expect(out.params.reasoning_effort).toBe("high");
  });

  it("extracts effort from Claude output_config.effort", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
      output_config: { effort: "max" },
    }, true);

    expect(out.params.reasoning_effort).toBe("max");
  });
});

describe("openaiToCommandCodeRequest — assistant tool_calls / tool-call", () => {
  it("converts assistant.tool_calls[] into content blocks of type tool-call", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_42", type: "function", function: { name: "search", arguments: "{\"q\":\"hi\"}" } },
          ],
        },
      ],
    }, true);

    const asst = out.params.messages[1];
    expect(asst.role).toBe("assistant");
    const tc = asst.content.find((b) => b.type === "tool-call");
    expect(tc).toBeDefined();
    expect(tc.toolCallId).toBe("call_42");
    expect(tc.toolName).toBe("search");
    expect(tc.input).toEqual({ q: "hi" });
  });
});

describe("openaiToCommandCodeRequest — tools schema conversion", () => {
  it("converts OpenAI {type:\"function\", function:{...}} to Anthropic plain {name, input_schema}", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          },
        },
      ],
    }, true);

    const t = out.params.tools[0];
    expect(t.name).toBe("weather");
    expect(t.input_schema).toBeDefined();
    expect(t.input_schema.type).toBe("object");
    expect(t.function).toBeUndefined();
    expect(t.parameters).toBeUndefined();
  });

  it("preserves description on converted tool", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "ping", description: "Ping the server", parameters: { type: "object" } } },
      ],
    }, true);
    expect(out.params.tools[0].description).toBe("Ping the server");
  });

  it("does not include tools field when input has none", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(out.params.tools).toBeUndefined();
  });
});

describe("openaiToCommandCodeRequest — native image blocks", () => {
  const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const DATA_URI = `data:image/png;base64,${PNG_B64}`;

  it("maps OpenAI image_url data URI to CommandCode {type:image,image,mimeType}", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what color?" },
          { type: "image_url", image_url: { url: DATA_URI } },
        ],
      }],
    }, true);

    expect(out.params.messages[0].content).toEqual([
      { type: "text", text: "what color?" },
      { type: "image", image: DATA_URI, mimeType: "image/png", mediaType: "image/png" },
    ]);
  });

  it("maps Claude/OpenAI base64 image source to a data-URI image block", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
        ],
      }],
    }, true);

    expect(out.params.messages[0].content).toEqual([
      { type: "image", image: DATA_URI, mimeType: "image/png", mediaType: "image/png" },
    ]);
  });

  it("does not stub dropped images as [image omitted]", () => {
    const out = openaiToCommandCodeRequest(MODEL, {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "see this" },
          { type: "image_url", image_url: { url: DATA_URI } },
        ],
      }],
    }, true);

    const texts = out.params.messages[0].content
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    expect(texts).not.toContain("[image omitted]");
  });
});
