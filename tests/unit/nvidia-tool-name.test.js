import { describe, it, expect } from "vitest";
import { normalizeOpenAIToolNames, restoreOpenAIToolNames } from "../../open-sse/translator/concerns/toolCall.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

describe("NVIDIA / OpenAI tool name normalization & restoration", () => {
  it("normalizes OpenAI tool definitions, tool_choice, and message tool calls", () => {
    const original = "mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message";
    const body = {
      tools: [{ type: "function", function: { name: original } }],
      tool_choice: { type: "function", function: { name: original } },
      messages: [{ role: "assistant", tool_calls: [{ function: { name: original } }] }],
    };

    const names = normalizeOpenAIToolNames(body, 64);
    const alias = body.tools[0].function.name;

    expect(alias).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(alias.length).toBeLessThanOrEqual(64);
    expect(body.tool_choice.function.name).toBe(alias);
    expect(body.messages[0].tool_calls[0].function.name).toBe(alias);

    const response = { choices: [{ delta: { tool_calls: [{ function: { name: alias } }] } }] };
    expect(restoreOpenAIToolNames(response, names)).toBe(true);
    expect(response.choices[0].delta.tool_calls[0].function.name).toBe(original);
  });

  it("normalizes Claude/raw tool definitions and content tool_use blocks", () => {
    const original = "mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message";
    const body = {
      tools: [{ name: original, description: "MCP test", input_schema: { type: "object" } }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: original, input: {} }],
        },
      ],
    };

    const names = normalizeOpenAIToolNames(body, 64);
    const alias = body.tools[0].name;

    expect(alias).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(alias.length).toBeLessThanOrEqual(64);
    expect(body.messages[0].content[0].name).toBe(alias);
  });

  it("handles collisions deterministically", () => {
    const collisions = { tools: ["a.b", "a?b"].map(name => ({ type: "function", function: { name } })) };
    normalizeOpenAIToolNames(collisions, 64);
    expect(collisions.tools[0].function.name).not.toBe(collisions.tools[1].function.name);
  });

  it("translates OpenAI streaming responses back to Claude tool names using toolNameMap", () => {
    const original = "mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message";
    const body = { tools: [{ type: "function", function: { name: original } }] };
    const names = normalizeOpenAIToolNames(body, 64);
    const alias = body.tools[0].function.name;

    const translated = openaiToClaudeResponse(
      {
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: alias, arguments: "" } }] } }],
      },
      { toolNameMap: names, toolCalls: new Map(), nextBlockIndex: 0, textBlockIndex: -1, thinkingBlockIndex: -1 }
    );

    const startBlock = translated.find(x => x.type === "content_block_start");
    expect(startBlock.content_block.name).toBe(original);
  });

  it("reserializes passthrough SSE chunks with original tool names", async () => {
    const original = "mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_console_message";
    const body = { tools: [{ type: "function", function: { name: original } }] };
    const names = normalizeOpenAIToolNames(body, 64);
    const alias = body.tools[0].function.name;
    const transform = createPassthroughStreamWithLogger("nvidia", null, null, null, null, null, null, names);
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();

    const outputPromise = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += new TextDecoder().decode(value);
      }
    })();

    await writer.write(
      new TextEncoder().encode(
        `data: ${JSON.stringify({
          id: "chatcmpl_1",
          object: "chat.completion.chunk",
          created: 1,
          choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: alias, arguments: "" } }] } }],
        })}\n\n`
      )
    );
    await writer.close();

    const text = await outputPromise;
    expect(text).toContain(original);
    expect(text).not.toContain(alias);
  });
});
