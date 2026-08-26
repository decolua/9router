import { describe, it, expect } from "vitest";

import {
  openaiToGeminiRequest,
  findSpeakerBoundaryViolation,
  openaiToAntigravityRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

// A model that never sees its own voice in the history stops behaving like the
// responder. Gemini is handed `contents`; if the assistant's turns are missing
// from it, the transcript reads as an unfinished user monologue and the model
// continues it — completing the user's sentence rather than replying to it.
//
// Two lines in this translator used to make that happen together: an assistant
// turn whose parts came out empty was never pushed, and normalizeGeminiContents
// merged whatever ended up adjacent. Drop a model turn between two user turns
// and those user turns fuse. In an agentic session, where every tool result
// arrives as a `user` turn, the model's voice erodes a little more each round.

const modelTurns = (r) => r.contents.filter((c) => c.role === "model");
const userTurns = (r) => r.contents.filter((c) => c.role === "user");

describe("gemini request: speaker boundaries survive translation", () => {
  it("keeps an assistant turn whose content was scrubbed to empty", () => {
    const body = {
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "" },
        { role: "user", content: "second question" },
      ],
    };

    const r = openaiToGeminiRequest("gemini-pro", body, false);

    expect(modelTurns(r)).toHaveLength(1);
    expect(userTurns(r)).toHaveLength(2);
  });

  it("never fuses two user turns that had an assistant turn between them", () => {
    const body = {
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "   " },
        { role: "user", content: "second question" },
      ],
    };

    const r = openaiToGeminiRequest("gemini-pro", body, false);

    expect(r.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    const fused = r.contents.find(
      (c) =>
        c.role === "user" &&
        c.parts.some((p) => p.text?.includes("first")) &&
        c.parts.some((p) => p.text?.includes("second"))
    );
    expect(fused).toBeUndefined();
  });

  it("preserves alternation across a long tool-driven exchange", () => {
    // The shape Claude Code produces: assistant tool_call, tool result, and a
    // scrubbed assistant reply, repeated. Every round used to erase one more
    // model turn.
    const messages = [{ role: "user", content: "start the task" }];
    for (let i = 0; i < 6; i++) {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `call_${i}`, type: "function", function: { name: "Bash", arguments: '{"cmd":"ls"}' } },
        ],
      });
      messages.push({ role: "tool", tool_call_id: `call_${i}`, content: "ok" });
      messages.push({ role: "assistant", content: "" });
      messages.push({ role: "user", content: `follow up ${i}` });
    }

    const r = openaiToGeminiRequest("gemini-pro", body_of(messages), false);

    // Twelve assistant turns went in: six tool calls and six replies. Counting
    // roles is not enough — when the scrubbed reply vanishes, its neighbouring
    // user turns merge and the result still alternates perfectly. The erasure
    // only shows up in the tally.
    expect(modelTurns(r)).toHaveLength(12);
    expect(userTurns(r)).toHaveLength(13);
  });

  it("still merges user turns that were genuinely adjacent in the source", () => {
    const body = {
      messages: [
        { role: "user", content: "part one" },
        { role: "user", content: "part two" },
      ],
    };

    const r = openaiToGeminiRequest("gemini-pro", body, false);

    expect(r.contents).toHaveLength(1);
    expect(r.contents[0].role).toBe("user");
  });

  it("reports a violation when assistant turns went in and none came out", () => {
    // The end state of the erosion. Diagnostic only — the translator logs it and
    // still sends the request; it exists so a reintroduction is visible rather
    // than silent.
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];

    expect(findSpeakerBoundaryViolation(messages, [
      { role: "user", parts: [{ text: "a" }] },
      { role: "user", parts: [{ text: "c" }] },
    ])).toMatch(/model/i);

    expect(findSpeakerBoundaryViolation(messages, [
      { role: "user", parts: [{ text: "a" }] },
      { role: "model", parts: [{ text: "b" }] },
      { role: "user", parts: [{ text: "c" }] },
    ])).toBeNull();
  });

  it("keeps an emptied assistant turn on the antigravity envelope path too", () => {
    // wrapInCloudCodeEnvelopeForClaude builds `contents` itself and had the same
    // `if (parts.length > 0)` hole, so the fix has to land in both places.
    const claudeRequest = {
      model: "claude-sonnet-4",
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "" },
        { role: "user", content: "second question" },
      ],
    };

    const env = openaiToAntigravityRequest("claude-sonnet-4", claudeRequest, false, null);
    const contents = env?.request?.contents || [];

    expect(contents.filter((c) => c.role === "model")).toHaveLength(1);
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("never leaves a trailing model turn holding only a placeholder", () => {
    // A trailing model turn is a prefill Gemini continues from — the same defect
    // this placeholder exists to prevent, entered from the other end.
    const r = openaiToGeminiRequest("gemini-pro", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "" },
      ],
    }, false);

    expect(r.contents.at(-1).role).toBe("user");
  });

  it("keeps the turn when tool_calls carry no function-shaped entry", () => {
    // Entries that are not `type: "function"` are skipped, so an assistant turn
    // can reach the push with nothing accumulated. It used to vanish along with
    // its tool result, fusing the user turns on either side.
    const r = openaiToGeminiRequest("gemini-pro", {
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "Bash", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "x", content: "ok" },
        { role: "user", content: "b" },
      ],
    }, false);

    expect(modelTurns(r).length).toBeGreaterThanOrEqual(1);
    const fused = r.contents.find(
      (c) => c.role === "user" && c.parts.some((p) => p.text === "a") && c.parts.some((p) => p.text === "b")
    );
    expect(fused).toBeUndefined();
  });

  it("survives prepareClaudeRequest, which strips whitespace-only blocks", async () => {
    // The placeholder has to be non-whitespace: hasValidContent requires
    // block.text?.trim(), so a blank one is filtered back out and the two user
    // turns fuse again — the fix would look present and do nothing.
    const { prepareClaudeRequest } = await import("../../open-sse/translator/formats/claude.js");
    const { openaiToClaudeRequest } = await import("../../open-sse/translator/request/openai-to-claude.js");

    const raw = openaiToClaudeRequest("claude-sonnet-4", {
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "" },
        { role: "user", content: "second" },
      ],
    }, false);

    const prepared = prepareClaudeRequest(raw);
    const roles = prepared.messages.map((m) => m.role);

    expect(roles).toEqual(["user", "assistant", "user"]);
  });

  it("does not prepend a placeholder to a turn that has real content", () => {
    // prepareClaudeRequest filters whole messages, never individual blocks, so a
    // stray placeholder beside real text would reach Anthropic and 400.
    const raw = openaiToClaudeRequestSync({
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "" },
        { role: "assistant", content: "real reply" },
        { role: "user", content: "next" },
      ],
    });

    const assistant = raw.messages.find((m) => m.role === "assistant");
    expect(assistant.content.every((b) => b.text?.trim())).toBe(true);
  });

  it("does not report a violation on a first turn, which has no model voice yet", () => {
    expect(findSpeakerBoundaryViolation(
      [{ role: "user", content: "hello" }],
      [{ role: "user", parts: [{ text: "hello" }] }]
    )).toBeNull();
  });
});

function body_of(messages) {
  return { messages };
}

function openaiToClaudeRequestSync(body) {
  return openaiToClaudeRequest("claude-sonnet-4", body, false);
}
