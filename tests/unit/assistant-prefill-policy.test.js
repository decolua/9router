import { describe, it, expect } from "vitest";
import { applyAssistantPrefillPolicy } from "open-sse/translator/concerns/assistantPrefillPolicy.js";
import { CLAUDE_BLOCK, ROLE } from "open-sse/translator/schema/index.js";

// Issue #2302: Vertex-backed Claude routes return
//   400 "This model does not support assistant message prefill.
//        The conversation must end with a user message."
// when the conversation ends with an assistant turn. Agentic clients send that
// shape legitimately, so the request is repaired instead of rejected.

// E-form signature: single-layer base64 whose first decoded byte is 0x12.
const VALID_SIGNATURE = "EnZhbGlkLWNsYXVkZS1zaWduYXR1cmU=";

const roles = (body) => body.messages.map(m => m.role);
const user = (text) => ({ role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text }] });

describe("applyAssistantPrefillPolicy", () => {
  it("leaves a conversation that already ends with a user turn untouched", () => {
    const body = { messages: [user("hello")] };
    const before = JSON.stringify(body);
    applyAssistantPrefillPolicy(body);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("appends a user turn after a text-only assistant prefill", () => {
    const body = {
      messages: [user("hi"), { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TEXT, text: "Sure, I" }] }],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
    // The assistant text is preserved, not discarded.
    expect(body.messages[1].content[0].text).toBe("Sure, I");
  });

  it("accepts a plain string assistant content", () => {
    const body = { messages: [user("hi"), { role: ROLE.ASSISTANT, content: "partial answer" }] };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
  });

  it("closes an unresolved tool_use with a matching error tool_result", () => {
    const body = {
      messages: [
        user("run it"),
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_1", name: "bash", input: {} }] },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);

    const results = body.messages.at(-1).content;
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe(CLAUDE_BLOCK.TOOL_RESULT);
    // Pairing must be exact, otherwise the next request is structurally invalid.
    expect(results[0].tool_use_id).toBe("toolu_1");
    expect(results[0].is_error).toBe(true);
  });

  it("closes every unresolved tool_use, not only the first", () => {
    const body = {
      messages: [
        user("run both"),
        {
          role: ROLE.ASSISTANT,
          content: [
            { type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_1", name: "a", input: {} },
            { type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_2", name: "b", input: {} },
          ],
        },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(body.messages.at(-1).content.map(b => b.tool_use_id)).toEqual(["toolu_1", "toolu_2"]);
  });

  it("keeps signed thinking and adds a user boundary instead of dropping it", () => {
    const body = {
      messages: [
        user("think"),
        {
          role: ROLE.ASSISTANT,
          content: [{ type: CLAUDE_BLOCK.THINKING, thinking: "reasoning", signature: VALID_SIGNATURE }],
        },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
    expect(body.messages[1].content[0].type).toBe(CLAUDE_BLOCK.THINKING);
  });

  it("keeps redacted_thinking, which cannot be regenerated", () => {
    const body = {
      messages: [
        user("think"),
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque" }] },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
    expect(body.messages[1].content[0].type).toBe(CLAUDE_BLOCK.REDACTED_THINKING);
  });

  it("keeps a server_tool_use turn", () => {
    const body = {
      messages: [
        user("search"),
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.SERVER_TOOL_USE, id: "srvtoolu_1", name: "web_search" }] },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
  });

  it("drops an assistant turn holding only unsigned thinking", () => {
    const body = {
      messages: [
        user("think"),
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.THINKING, thinking: "x", signature: "not-valid" }] },
      ],
    };
    applyAssistantPrefillPolicy(body);
    // Anthropic rejects unsigned thinking, so nothing is lost by removing it.
    expect(roles(body)).toEqual([ROLE.USER]);
  });

  it("drops an empty assistant turn", () => {
    const body = { messages: [user("hi"), { role: ROLE.ASSISTANT, content: [] }] };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER]);
  });

  it("drops a whitespace-only assistant turn", () => {
    const body = {
      messages: [user("hi"), { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TEXT, text: "   " }] }],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER]);
  });

  it("always yields a conversation ending in a user turn", () => {
    const trailing = [
      [{ type: CLAUDE_BLOCK.TEXT, text: "partial" }],
      [{ type: CLAUDE_BLOCK.TOOL_USE, id: "t1", name: "x", input: {} }],
      [{ type: CLAUDE_BLOCK.THINKING, thinking: "r", signature: VALID_SIGNATURE }],
      [{ type: CLAUDE_BLOCK.REDACTED_THINKING, data: "d" }],
      [{ type: CLAUDE_BLOCK.SERVER_TOOL_USE, id: "s1", name: "web_search" }],
      [],
    ];
    for (const content of trailing) {
      const body = { messages: [user("q"), { role: ROLE.ASSISTANT, content }] };
      applyAssistantPrefillPolicy(body);
      expect(body.messages.at(-1).role).toBe(ROLE.USER);
    }
  });

  it.each([
    ["empty content", []],
    ["empty text", [{ type: CLAUDE_BLOCK.TEXT, text: "" }]],
    ["whitespace text", [{ type: CLAUDE_BLOCK.TEXT, text: "   " }]],
    ["missing content", undefined],
  ])("re-checks the invariant after dropping a stacked assistant with %s", (_name, content) => {
    const body = {
      messages: [
        user("q"),
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TEXT, text: "partial" }] },
        { role: ROLE.ASSISTANT, ...(content === undefined ? {} : { content }) },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER, ROLE.ASSISTANT, ROLE.USER]);
  });

  it("re-checks an interrupted tool_use exposed by dropping an empty assistant", () => {
    const body = {
      messages: [
        user("run it"),
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TOOL_USE, id: "toolu_1", name: "bash", input: {} }] },
        { role: ROLE.ASSISTANT, content: [] },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(body.messages.at(-1).content[0]).toMatchObject({
      type: CLAUDE_BLOCK.TOOL_RESULT,
      tool_use_id: "toolu_1",
      is_error: true,
    });
  });

  it("never leaves messages empty after dropping contentless assistant turns", () => {
    const body = {
      messages: [
        { role: ROLE.ASSISTANT, content: [] },
        { role: ROLE.ASSISTANT, content: [{ type: CLAUDE_BLOCK.TEXT, text: " " }] },
      ],
    };
    applyAssistantPrefillPolicy(body);
    expect(roles(body)).toEqual([ROLE.USER]);
  });

  it("ignores bodies without a messages array", () => {
    expect(() => applyAssistantPrefillPolicy({})).not.toThrow();
    expect(() => applyAssistantPrefillPolicy(null)).not.toThrow();
    expect(applyAssistantPrefillPolicy({ messages: "nope" })).toEqual({ messages: "nope" });
  });
});
