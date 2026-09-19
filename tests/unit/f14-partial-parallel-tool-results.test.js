// F14 / T1.2 A4 — partial parallel tool results must not leave an orphan tool_use.
//
// Scenario: an OpenAI-format client assistant turn calls TWO tools in parallel,
// the agent answers only one of them and then moves on with a new user message.
// `fixMissingToolResponses` (concerns/toolCall.js) treats the batch as answered
// because `hasToolResults` matches on ANY id, and `fixToolUseOrdering`
// (formats/claude.js) only reorders — it never inserts the missing result. A
// Claude target therefore used to receive N tool_use blocks with fewer
// tool_result blocks and Anthropic rejects it ("every tool_use must have a
// tool_result"), breaking parallel agent loops with an HTTP 400.
import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { hasToolResults } from "../../open-sse/translator/concerns/toolCall.js";
import {
  SYNTHETIC_TOOL_RESULT_TEXT,
  synthesizeMissingToolResults,
} from "../../open-sse/translator/formats/claude.js";

// Exact payload the claude-side synthetic result uses (same text/contract as
// the openai-leg analogue, request/claude-to-openai.js fixMissingToolResponsesOpenAI).
const SYNTHETIC = SYNTHETIC_TOOL_RESULT_TEXT;

const call = (id, name = "search") => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify({ q: id }) },
});

function assistantWithCalls(ids) {
  return { role: "assistant", content: "", tool_calls: ids.map((id) => call(id)) };
}

function toolResult(id, content) {
  return { role: "tool", tool_call_id: id, content };
}

function partialBody() {
  return {
    messages: [
      { role: "user", content: "run two tools" },
      assistantWithCalls(["call_A", "call_B"]),
      toolResult("call_A", "result A"),
      { role: "user", content: "and now?" },
    ],
  };
}

function completeBody() {
  return {
    messages: [
      { role: "user", content: "run two tools" },
      assistantWithCalls(["call_A", "call_B"]),
      toolResult("call_A", "result A"),
      toolResult("call_B", "result B"),
      { role: "user", content: "and now?" },
    ],
  };
}

function serialBody() {
  return {
    messages: [
      { role: "user", content: "run one tool" },
      assistantWithCalls(["call_A"]),
      toolResult("call_A", "result A"),
      { role: "user", content: "and now?" },
    ],
  };
}

function unansweredBody() {
  return {
    messages: [
      { role: "user", content: "run one tool" },
      assistantWithCalls(["call_A"]),
      { role: "user", content: "actually, forget it" },
    ],
  };
}

const toClaude = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", body, true, { apiKey: "sk-x" }, "claude");

// Anthropic's rule, verbatim: every tool_use block must have a matching
// tool_result block in the message that immediately follows the assistant turn.
// A trailing assistant turn is a prefill, not a dangling call.
function findOrphanToolUses(messages) {
  const orphans = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const used = msg.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (used.length === 0) continue;
    const next = messages[i + 1];
    if (!next) continue;
    const answered = new Set(
      (Array.isArray(next.content) ? next.content : [])
        .filter((b) => b.type === "tool_result")
        .map((b) => b.tool_use_id)
    );
    for (const id of used) if (!answered.has(id)) orphans.push(id);
  }
  return orphans;
}

// Structural skeleton of the conversation: roles, block kinds and tool ids.
// cache_control / thinking plumbing is deliberately ignored so the assertions
// describe the tool-call graph only.
function skeleton(messages) {
  return messages.map((msg) => ({
    role: msg.role,
    content: (Array.isArray(msg.content) ? msg.content : [{ type: "raw", text: msg.content }]).map((block) => {
      if (block.type === "tool_use") return { type: "tool_use", id: block.id };
      if (block.type === "tool_result") {
        return { type: "tool_result", id: block.tool_use_id, content: block.content, is_error: block.is_error };
      }
      if (block.type === "text") return { type: "text", text: block.text };
      return { type: block.type };
    }),
  }));
}

describe("F14 — partial parallel tool results against a Claude target", () => {
  it("keeps the documented loose contract of hasToolResults (ANY id match)", () => {
    // Audited call-site: hasToolResults is the *trigger* used by
    // fixMissingToolResponses ("does this batch have any reply at all?"), and
    // the exported helper is referenced nowhere else in the repo. Completeness
    // is repaired downstream on the Claude leg instead of by tightening this
    // predicate for every non-kiro target.
    expect(hasToolResults(toolResult("call_A", "a"), ["call_A", "call_B"])).toBe(true);
    expect(hasToolResults({ role: "user", content: [{ type: "text", text: "hi" }] }, ["call_A"])).toBe(false);
  });

  it("synthesizes the missing tool_result so no tool_use is orphaned (A4 repro)", () => {
    const out = toClaude(partialBody());

    expect(findOrphanToolUses(out.messages)).toEqual([]);

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content.filter((b) => b.type === "tool_use").map((b) => b.id)).toEqual([
      "call_A",
      "call_B",
    ]);

    const reply = out.messages[out.messages.indexOf(assistant) + 1];
    const results = reply.content.filter((b) => b.type === "tool_result");
    expect(results.map((b) => b.tool_use_id)).toEqual(["call_A", "call_B"]);
    expect(results[0].content).toBe("result A");
    expect(results[1].content).toBe(SYNTHETIC);
    // Same contract as the openai-leg synthetic result: plain text, no error flag.
    expect(results[1].is_error).toBeUndefined();
  });

  it("places every tool_result before the user's own text block", () => {
    const out = toClaude(partialBody());
    const reply = out.messages.find(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")
    );
    const kinds = reply.content.map((b) => b.type);
    expect(kinds.lastIndexOf("tool_result")).toBeLessThan(kinds.indexOf("text") === -1 ? kinds.length : kinds.indexOf("text"));
    expect(kinds).toEqual(["tool_result", "tool_result", "text"]);
  });

  it("leaves a fully answered parallel batch untouched", () => {
    const out = toClaude(completeBody());
    expect(findOrphanToolUses(out.messages)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain(SYNTHETIC);
    expect(skeleton(out.messages)).toEqual([
      { role: "user", content: [{ type: "text", text: "run two tools" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_A" }, { type: "tool_use", id: "call_B" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", id: "call_A", content: "result A", is_error: undefined },
          { type: "tool_result", id: "call_B", content: "result B", is_error: undefined },
          { type: "text", text: "and now?" },
        ],
      },
    ]);
  });

  it("leaves a serial (single call) conversation untouched", () => {
    const out = toClaude(serialBody());
    expect(findOrphanToolUses(out.messages)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain(SYNTHETIC);
    expect(skeleton(out.messages)).toEqual([
      { role: "user", content: [{ type: "text", text: "run one tool" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_A" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", id: "call_A", content: "result A", is_error: undefined },
          { type: "text", text: "and now?" },
        ],
      },
    ]);
  });

  it("does not double-inject when the batch had no reply at all", () => {
    // fixMissingToolResponses (pre-translation) already inserts an OpenAI
    // role:"tool" message here; the Claude-leg repair must stay silent.
    const out = toClaude(unansweredBody());
    expect(findOrphanToolUses(out.messages)).toEqual([]);
    const assistant = out.messages.find((m) => m.role === "assistant");
    const reply = out.messages[out.messages.indexOf(assistant) + 1];
    expect(reply.content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id)).toEqual(["call_A"]);
    expect(JSON.stringify(out)).not.toContain(SYNTHETIC);
  });

  it("mirrors the OpenAI-leg synthetic contract byte for byte (claude → openai leg)", () => {
    // The same dropped call, repaired on the other leg, must read identically —
    // that is what "same semantics as fixMissingToolResponsesOpenAI" means.
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "gpt-oss:120b",
      {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "toolu_A", name: "search", input: { q: "a" } },
              { type: "tool_use", id: "toolu_B", name: "search", input: { q: "b" } },
            ],
          },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "result A" }] },
          { role: "user", content: "and now?" },
        ],
      },
      true,
      null,
      "openai"
    );

    expect(SYNTHETIC).toBe("[No response received]");
    const synthetic = out.messages.find((m) => m.role === "tool" && m.tool_call_id === "toolu_B");
    expect(synthetic).toBeTruthy();
    expect(synthetic.content).toBe("[No response received]");
  });

  it("opens its own user turn when the dangling call is followed by an assistant turn", () => {
    // Direct helper use: tool_results cannot live in an assistant message, so
    // the repair must create the user turn that carries them.
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_A", name: "search", input: {} }] },
      { role: "assistant", content: [{ type: "text", text: "thinking out loud" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ];
    const out = synthesizeMissingToolResults(messages);

    expect(skeleton(out)).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_A" }] },
      {
        role: "user",
        content: [{ type: "tool_result", id: "toolu_A", content: SYNTHETIC, is_error: undefined }],
      },
      { role: "assistant", content: [{ type: "text", text: "thinking out loud" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ]);
  });

  it("repairs a plain-string user turn without fabricating an empty text block", () => {
    const withText = synthesizeMissingToolResults([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_A", name: "search", input: {} }] },
      { role: "user", content: "and now?" },
    ]);
    expect(skeleton(withText)).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_A" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", id: "toolu_A", content: SYNTHETIC, is_error: undefined },
          { type: "text", text: "and now?" },
        ],
      },
    ]);

    const emptyTurn = synthesizeMissingToolResults([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_B", name: "search", input: {} }] },
      { role: "user", content: "" },
    ]);
    expect(skeleton(emptyTurn)).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_B" }] },
      { role: "user", content: [{ type: "tool_result", id: "toolu_B", content: SYNTHETIC, is_error: undefined }] },
    ]);
  });

  it("leaves a trailing assistant prefill alone", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_A", name: "search", input: {} }] },
    ];
    expect(skeleton(synthesizeMissingToolResults(messages))).toEqual([
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_A" }] },
    ]);
  });

  it("keeps the direct Claude → Kiro route free of Claude-leg repairs", () => {
    const kiroBody = {
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_A", name: "search", input: { q: "a" } },
            { type: "tool_use", id: "toolu_B", name: "search", input: { q: "b" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "result A" }],
        },
        { role: "user", content: "and now?" },
      ],
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4-5", kiroBody, true, null, "kiro");
    const wire = JSON.stringify(out);
    expect(wire).not.toContain(SYNTHETIC);
    // Kiro reconciles the unanswered call its own way (flatten to text), never
    // with a Claude tool_result block.
    expect(wire).not.toContain("tool_result");
  });
});
