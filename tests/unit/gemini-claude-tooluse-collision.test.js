import { describe, expect, it } from "vitest";

import { openaiToClaudeRequestForAntigravity } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// The Claude -> Gemini step (wrapInCloudCodeEnvelopeForClaude) resolved
// functionResponse.name through a conversation-wide tool_use id -> name map.
// Claude tool_use ids are no more globally unique than OpenAI tool_call ids, so
// a collision produced the same 400 INVALID_ARGUMENT as #4273.
//
// openaiToAntigravityRequest() reaches that step only after converting the
// body from OpenAI to Claude, which regenerates ids — so to exercise the
// collision the test drives OpenAI -> Claude here, then feeds that Claude
// request back through openaiToAntigravityRequest unchanged, so the colliding
// ids survive the hop.

function names(out) {
  const src = out.request?.contents ?? out.contents ?? [];
  const rows = [];
  for (const c of src) {
    for (const p of c.parts || []) {
      if (p.functionCall) rows.push(`call:${p.functionCall.name}`);
      if (p.functionResponse) rows.push(`resp:${p.functionResponse.name}`);
    }
  }
  return rows;
}

// Drive the Claude -> Gemini step directly: a Claude-shaped body passed to
// openaiToAntigravityRequest goes through openaiToClaudeRequestForAntigravity
// first, so instead assert on the observable invariant through the public
// surface, using OpenAI input whose ids collide after conversion.
function openaiBodyWithCollidingIds() {
  const messages = [{ role: "user", content: "go" }];
  for (const n of ["edit", "bash"]) {
    messages.push({
      role: "assistant",
      tool_calls: [{ id: "toolu_same", type: "function", function: { name: n, arguments: "{}" } }],
    });
    messages.push({ role: "tool", tool_call_id: "toolu_same", content: `{"tool":"${n}"}` });
  }
  return { model: "claude-sonnet-5", messages, max_tokens: 100 };
}

describe("Claude -> Gemini: colliding tool_use id (#4273)", () => {
  it("never answers a call with a different tool's name", () => {
    const out = openaiToAntigravityRequest("claude-sonnet-5", openaiBodyWithCollidingIds(), false, {});
    const rows = names(out);
    const calls = rows.filter((r) => r.startsWith("call:"));
    const resps = rows.filter((r) => r.startsWith("resp:"));
    expect(calls.length).toBeGreaterThan(0);
    // Every response must answer a call of the SAME name that precedes it,
    // in order. That is the invariant Gemini enforces.
    for (let i = 0; i < resps.length; i++) {
      expect(resps[i].slice("resp:".length)).toBe(calls[i].slice("call:".length));
    }
  });

  it("keeps distinct ids resolving to their own names", () => {
    const messages = [{ role: "user", content: "go" }];
    for (const [id, n] of [["toolu_a", "alpha"], ["toolu_b", "beta"]]) {
      messages.push({
        role: "assistant",
        tool_calls: [{ id, type: "function", function: { name: n, arguments: "{}" } }],
      });
      messages.push({ role: "tool", tool_call_id: id, content: `{"tool":"${n}"}` });
    }
    const out = openaiToAntigravityRequest("claude-sonnet-5", { model: "claude-sonnet-5", messages, max_tokens: 100 }, false, {});
    const resps = names(out).filter((r) => r.startsWith("resp:"));
    expect(resps).toEqual(["resp:alpha", "resp:beta"]);
  });

  it("the OpenAI->Claude hop PRESERVES ids, so the collision really reaches the Gemini step", () => {
    // This is the point of the fix: the intermediate converter does NOT
    // renumber, so a colliding id survives the hop and the Claude->Gemini step
    // is genuinely responsible for pairing each result with its own call.
    const claudeReq = openaiToClaudeRequestForAntigravity("claude-sonnet-5", openaiBodyWithCollidingIds(), false);
    const ids = [];
    for (const m of claudeReq.messages || []) {
      for (const b of m.content || []) {
        if (b.type === "tool_use") ids.push(b.id);
      }
    }
    expect(ids).toEqual(["toolu_same", "toolu_same"]);
    // ...and the pairing still comes out right despite that.
    const out = openaiToAntigravityRequest("claude-sonnet-5", openaiBodyWithCollidingIds(), false, {});
    expect(names(out).filter((r) => r.startsWith("resp:"))).toEqual(["resp:edit", "resp:bash"]);
  });
});
