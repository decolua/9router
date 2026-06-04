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
import { openaiToCommandCode } from "../../open-sse/translator/request/openai-to-commandcode.js";

const MODEL = "moonshotai/Kimi-K2.6";

describe("openaiToCommandCode — basic envelope", () => {
  it("returns the expected top-level envelope shape", () => {
    const out = openaiToCommandCode(MODEL, {
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

describe("openaiToCommandCode — system handling", () => {
  it("hoists system messages to params.system (string), not messages[]", () => {
    const out = openaiToCommandCode(MODEL, {
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
    const out = openaiToCommandCode(MODEL, {
      messages: [
        { role: "system", content: "A" },
        { role: "system", content: "B" },
        { role: "user", content: "hi" },
      ],
    }, true);

    expect(out.params.system).toBe("A\n\nB");
  });

  it("omits params.system when no system messages", () => {
    const out = openaiToCommandCode(MODEL, {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(out.params.system).toBeUndefined();
  });
});

describe("openaiToCommandCode — content shape", () => {
  it("MUST always emit content as Array (never string) for user", () => {
    const out = openaiToCommandCode(MODEL, {
      messages: [{ role: "user", content: "hello" }],
    }, true);

    const u = out.params.messages[0];
    expect(Array.isArray(u.content)).toBe(true);
    expect(u.content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("MUST always emit content as Array for assistant", () => {
    const out = openaiToCommandCode(MODEL, {
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

describe("openaiToCommandCode — tool role / tool-result (AI SDK)", () => {
  it("converts role:\"tool\" to role:\"tool\" with tool-result block; output is {type:\"text\",value}", () => {
    const out = openaiToCommandCode(MODEL, {
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
});

describe("openaiToCommandCode — assistant tool_calls / tool-call", () => {
  it("converts assistant.tool_calls[] into content blocks of type tool-call", () => {
    const out = openaiToCommandCode(MODEL, {
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

describe("openaiToCommandCode — tools schema conversion", () => {
  it("converts OpenAI {type:\"function\", function:{...}} to Anthropic plain {name, input_schema}", () => {
    const out = openaiToCommandCode(MODEL, {
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
    const out = openaiToCommandCode(MODEL, {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "ping", description: "Ping the server", parameters: { type: "object" } } },
      ],
    }, true);
    expect(out.params.tools[0].description).toBe("Ping the server");
  });

  it("does not include tools field when input has none", () => {
    const out = openaiToCommandCode(MODEL, {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(out.params.tools).toBeUndefined();
  });
});
