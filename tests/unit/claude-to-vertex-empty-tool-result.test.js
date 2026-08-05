import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Claude → Vertex with empty tool_result content", () => {
  it("handles tool_result with empty string content", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Do X" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "run_cmd", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "" }] },
        { role: "assistant", content: [{ type: "text", text: "Done" }] },
        { role: "user", content: [{ type: "text", text: "Now do Y" }] },
      ],
      tools: [{ name: "run_cmd", description: "Run command", input_schema: { type: "object", properties: { cmd: { type: "string" } } } }],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    
    // Verify all turns alternate user/model properly
    for (let i = 1; i < result.contents.length; i++) {
      const prev = result.contents[i - 1];
      const curr = result.contents[i];
      expect(prev.role).not.toBe(curr.role);
    }
    
    // Last turn should be user
    expect(result.contents.at(-1).role).toBe("user");
    
    // Check that there's a user turn with functionResponse after the model turn with functionCall
    let foundFunctionCall = false;
    for (let i = 0; i < result.contents.length; i++) {
      const turn = result.contents[i];
      if (turn.role === "model" && turn.parts.some(p => p?.functionCall)) {
        foundFunctionCall = true;
        // Next turn must be user with functionResponse
        const nextTurn = result.contents[i + 1];
        expect(nextTurn).toBeDefined();
        expect(nextTurn.role).toBe("user");
        expect(nextTurn.parts.some(p => p?.functionResponse)).toBe(true);
      }
    }
    expect(foundFunctionCall).toBe(true);
  });

  it("handles multi-turn with empty tool results (11 messages)", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Do task" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "run_cmd", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "" }] },
        { role: "assistant", content: [{ type: "text", text: "Found files" }, { type: "tool_use", id: "toolu_2", name: "run_cmd", input: { cmd: "cat file" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "" }] },
        { role: "assistant", content: [{ type: "text", text: "Content loaded" }, { type: "tool_use", id: "toolu_3", name: "run_cmd", input: { cmd: "echo done" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_3", content: "" }] },
        { role: "assistant", content: [{ type: "text", text: "All done" }, { type: "tool_use", id: "toolu_4", name: "run_cmd", input: { cmd: "pwd" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_4", content: "" }] },
        { role: "assistant", content: [{ type: "text", text: "Directory listed" }] },
        { role: "user", content: [{ type: "text", text: "Thanks" }] },
      ],
      tools: [{ name: "run_cmd", description: "Run command", input_schema: { type: "object", properties: { cmd: { type: "string" } } } }],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    
    // Verify proper alternation
    for (let i = 1; i < result.contents.length; i++) {
      const prev = result.contents[i - 1];
      const curr = result.contents[i];
      expect(prev.role, `Turn ${i}: expected alternating roles but got ${prev.role} → ${curr.role}`).not.toBe(curr.role);
    }
    
    // Last turn should be user
    expect(result.contents.at(-1).role).toBe("user");
  });

  it("handles tool_result with null content", () => {
    const body = {
      model: "claude-opus",
      system: "You are helpful.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Do X" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "run_cmd", input: { cmd: "ls" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1" }] },
        { role: "assistant", content: [{ type: "text", text: "Done" }] },
        { role: "user", content: [{ type: "text", text: "Thanks" }] },
      ],
      tools: [{ name: "run_cmd", description: "Run command", input_schema: { type: "object", properties: { cmd: { type: "string" } } } }],
      max_tokens: 4096
    };

    const result = translateRequest(FORMATS.CLAUDE, FORMATS.VERTEX, "gemini-3.6-flash", body, true, null, "vertex");
    
    // Verify proper alternation
    for (let i = 1; i < result.contents.length; i++) {
      const prev = result.contents[i - 1];
      const curr = result.contents[i];
      expect(prev.role, `Turn ${i}: expected alternating roles but got ${prev.role} → ${curr.role}`).not.toBe(curr.role);
    }
  });
});
