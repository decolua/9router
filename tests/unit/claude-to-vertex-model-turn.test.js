import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Claude → Vertex requests ending with model turn", () => {
  it("appends user turn when Claude conversation ends with assistant text", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi! How can I help?" }] }
      ],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    const lastTurn = result.contents.at(-1);

    expect(lastTurn.role).toBe("user");
    expect(lastTurn.parts[0].text).toBe("Continue");
  });

  it("appends user turn with functionResponse when Claude conversation ends with assistant tool_use", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Check weather" }] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_123", name: "get_weather", input: { city: "Jakarta" } }
          ]
        }
      ],
      tools: [{ name: "get_weather", description: "Get weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    const lastTurn = result.contents.at(-1);

    expect(lastTurn.role).toBe("user");
    expect(lastTurn.parts[0].functionResponse).toBeDefined();
    expect(lastTurn.parts[0].functionResponse.name).toBe("get_weather");
  });

  it("handles multi-turn conversation with 11 messages ending with assistant", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Do task 1" }] },
        { role: "assistant", content: [{ type: "text", text: "Sure" }, { type: "tool_use", id: "toolu_1", name: "run_cmd", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file1.txt" }] },
        { role: "assistant", content: [{ type: "text", text: "Found file1" }, { type: "tool_use", id: "toolu_2", name: "run_cmd", input: { cmd: "cat file1.txt" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "content of file1" }] },
        { role: "assistant", content: [{ type: "text", text: "Here's the content" }] },
        { role: "user", content: [{ type: "text", text: "Now do task 2" }] },
        { role: "assistant", content: [{ type: "text", text: "OK" }, { type: "tool_use", id: "toolu_3", name: "run_cmd", input: { cmd: "mkdir test" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_3", content: "done" }] },
        { role: "assistant", content: [{ type: "text", text: "Created dir" }, { type: "tool_use", id: "toolu_4", name: "run_cmd", input: { cmd: "touch test/a.txt" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_4", content: "done" }] },
      ],
      tools: [{ name: "run_cmd", description: "Run command", input_schema: { type: "object", properties: { cmd: { type: "string" } } } }],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    const lastTurn = result.contents.at(-1);

    // Last turn should be user (tool_result converts to functionResponse)
    expect(lastTurn.role).toBe("user");
  });

  it("handles 11 messages ending with assistant (no trailing tool_result)", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Do task 1" }] },
        { role: "assistant", content: [{ type: "text", text: "Sure" }, { type: "tool_use", id: "toolu_1", name: "run_cmd", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file1.txt" }] },
        { role: "assistant", content: [{ type: "text", text: "Found file1" }, { type: "tool_use", id: "toolu_2", name: "run_cmd", input: { cmd: "cat file1.txt" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "content of file1" }] },
        { role: "assistant", content: [{ type: "text", text: "Here's the content" }] },
        { role: "user", content: [{ type: "text", text: "Now do task 2" }] },
        { role: "assistant", content: [{ type: "text", text: "OK" }, { type: "tool_use", id: "toolu_3", name: "run_cmd", input: { cmd: "mkdir test" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_3", content: "done" }] },
        { role: "assistant", content: [{ type: "text", text: "Created dir" }] },
        { role: "user", content: [{ type: "text", text: "And task 3" }] },
      ],
      tools: [{ name: "run_cmd", description: "Run command", input_schema: { type: "object", properties: { cmd: { type: "string" } } } }],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    const lastTurn = result.contents.at(-1);

    // Last turn should be user (the "And task 3" user message)
    expect(lastTurn.role).toBe("user");
  });

  it("handles thinking content in assistant messages", () => {
    // Claude format with thinking - after Claude→OpenAI, assistant gets reasoning_content
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "Let me think about this..." },
          { type: "text", text: "Hi there!" }
        ] }
      ],
      thinking: { type: "enabled", budget_tokens: 8192 },
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    const lastTurn = result.contents.at(-1);

    expect(lastTurn.role).toBe("user");
    expect(lastTurn.parts[0].text).toBe("Continue");
  });
});
