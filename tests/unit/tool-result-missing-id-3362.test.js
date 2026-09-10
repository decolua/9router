// #3362 — Claude tool-result requests intermittently failed with
// "messages.N.content.0.tool_result.tool_use_id: Field required".
//
// ensureToolCallIds repaired an assistant tool_call whose id was missing, but
// both tool-result branches were guarded on the id being truthy, so a result
// arriving without one passed through untouched and openai-to-claude emitted
// `tool_use_id: undefined`. Anthropic rejects the whole request.
import { describe, it, expect } from "vitest";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { fixMissingToolResponses } from "../../open-sse/translator/concerns/toolCall.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assistantCall(...ids) {
  return {
    role: "assistant",
    content: null,
    tool_calls: ids.map((id) => ({ id, type: "function", function: { name: "read_file", arguments: "{}" } })),
  };
}

describe("tool_result id repair (#3362)", () => {
  it("pairs a result that arrived without an id with the open tool call", () => {
    const body = {
      messages: [
        { role: "user", content: "read it" },
        assistantCall("call_abc123"),
        { role: "tool", content: "file contents" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[2].tool_call_id).toBe("call_abc123");
  });

  it("pairs parallel results in order", () => {
    const body = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", content: "first" },
        { role: "tool", content: "second" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages.slice(1).map((m) => m.tool_call_id)).toEqual(["call_one", "call_two"]);
  });

  // An id already claimed by an explicit result must not be handed out again,
  // whichever order the results arrive in.
  it("does not hand the same id to two results", () => {
    const inOrder = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", tool_call_id: "call_one", content: "first" },
        { role: "tool", content: "second, id dropped" },
      ],
    };

    ensureToolCallIds(inOrder);

    expect(inOrder.messages.slice(1).map((m) => m.tool_call_id)).toEqual(["call_one", "call_two"]);

    const outOfOrder = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", tool_call_id: "call_two", content: "second arrived first" },
        { role: "tool", content: "the other one" },
      ],
    };

    ensureToolCallIds(outOfOrder);

    expect(outOfOrder.messages.slice(1).map((m) => m.tool_call_id)).toEqual(["call_two", "call_one"]);
  });

  it("repairs the Claude shape too (tool_result block in user content)", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "call_xyz", name: "read_file", input: {} }] },
        { role: "user", content: [{ type: "tool_result", content: "ok" }] },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[1].content[0].tool_use_id).toBe("call_xyz");
  });

  it("leaves a valid id alone", () => {
    const body = {
      messages: [assistantCall("call_abc"), { role: "tool", tool_call_id: "call_abc", content: "ok" }],
    };

    ensureToolCallIds(body);

    expect(body.messages[1].tool_call_id).toBe("call_abc");
  });

  it("still sanitizes an id that breaks Anthropic's pattern", () => {
    const body = {
      messages: [
        assistantCall("call:abc/1"),
        { role: "tool", tool_call_id: "call:abc/1", content: "ok" },
      ],
    };

    ensureToolCallIds(body);

    const id = body.messages[0].tool_calls[0].id;
    expect(id).toBe("callabc1");
    expect(body.messages[1].tool_call_id).toBe(id);
  });

  // Nothing to pair with is still not a reason to emit an absent field: a
  // well-formed id keeps the request shape valid instead of guaranteeing a 400.
  it("never leaves the id empty when there is no open call", () => {
    const body = { messages: [{ role: "tool", content: "orphan" }] };

    ensureToolCallIds(body);

    expect(body.messages[0].tool_call_id).toBeTruthy();
    expect(body.messages[0].tool_call_id).toMatch(TOOL_ID_PATTERN);
  });

  it("does not reuse ids across assistant turns", () => {
    const body = {
      messages: [
        assistantCall("call_first"),
        { role: "tool", tool_call_id: "call_first", content: "a" },
        assistantCall("call_second"),
        { role: "tool", content: "b" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[3].tool_call_id).toBe("call_second");
  });

  // hasToolResults() matches on the id, so before the repair a result with no
  // id looked absent and fixMissingToolResponses spliced in an empty duplicate.
  it("stops a duplicate empty result being inserted after it", () => {
    const body = {
      messages: [assistantCall("call_abc"), { role: "tool", content: "real output" }],
    };

    fixMissingToolResponses(ensureToolCallIds(body));

    const results = body.messages.filter((m) => m.role === "tool");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("real output");
  });

  it("reaches Anthropic with a tool_use_id, end to end", () => {
    const body = {
      messages: [
        { role: "user", content: "read it" },
        assistantCall("call_abc123"),
        { role: "tool", content: "file contents" },
      ],
    };

    const claude = openaiToClaudeRequest("claude-sonnet-5", ensureToolCallIds(body), false);

    const blocks = claude.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const results = blocks.filter((b) => b.type === "tool_result");
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe("call_abc123");
  });
});
