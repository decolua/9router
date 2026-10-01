import { describe, expect, it } from "vitest";

import { openaiToGeminiRequest, openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// #4273: tool_call_id is only unique WITHIN one assistant turn. A long agent
// session can reuse an id for two different tools (call_81334 for `edit` at turn
// 30, then for `bash` at turn 70). The translator kept a conversation-wide
// id -> name map, so the later call overwrote the earlier name and Gemini saw
// functionCall "edit" answered by functionResponse "bash" — a 400
// INVALID_ARGUMENT that then re-broke every later turn, because the client
// re-sends the same history each time.

function pairs(out) {
  const rows = [];
  for (const c of out.contents) {
    for (const p of c.parts || []) {
      if (p.functionCall) rows.push({ kind: "call", name: p.functionCall.name, id: p.functionCall.id });
      if (p.functionResponse) rows.push({ kind: "resp", name: p.functionResponse.name, id: p.functionResponse.id });
    }
  }
  return rows;
}

describe("OpenAI -> Gemini: colliding tool_call_id (#4273)", () => {
  const body = (ids) => ({
    model: "gemini-2.0-flash",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", tool_calls: [{ id: ids[0], type: "function", function: { name: "edit", arguments: "{}" } }] },
      { role: "tool", tool_call_id: ids[0], content: '{"n":1}' },
      { role: "user", content: "second" },
      { role: "assistant", tool_calls: [{ id: ids[1], type: "function", function: { name: "bash", arguments: "{}" } }] },
      { role: "tool", tool_call_id: ids[1], content: '{"n":2}' },
    ],
  });

  it("keeps each call paired with its own name when the id repeats", () => {
    const out = openaiToGeminiRequest("gemini-2.0-flash", body(["call_81334", "call_81334"]), false);
    expect(pairs(out).map((p) => `${p.kind}:${p.name}`)).toEqual([
      "call:edit",
      "resp:edit",
      "call:bash",
      "resp:bash",
    ]);
  });

  it("gives each repeated id its OWN result, not the first one twice", () => {
    const out = openaiToGeminiRequest("gemini-2.0-flash", body(["call_x", "call_x"]), false);
    const p = pairs(out);
    // Sanity: the second response must not be a copy of the first.
    expect(p[3].kind).toBe("resp");
    expect(p[3].name).toBe("bash");
  });

  it("is unchanged for the normal, non-colliding case", () => {
    const out = openaiToGeminiRequest("gemini-2.0-flash", body(["call_1", "call_2"]), false);
    expect(pairs(out).map((p) => `${p.kind}:${p.name}`)).toEqual([
      "call:edit",
      "resp:edit",
      "call:bash",
      "resp:bash",
    ]);
  });

  it("handles three collisions of one id", () => {
    const names = ["alpha", "beta", "gamma"];
    const messages = [{ role: "user", content: "go" }];
    for (const n of names) {
      messages.push({ role: "assistant", tool_calls: [{ id: "same", type: "function", function: { name: n, arguments: "{}" } }] });
      messages.push({ role: "tool", tool_call_id: "same", content: JSON.stringify({ n }) });
    }
    const out = openaiToGeminiRequest("gemini-2.0-flash", { model: "gemini-2.0-flash", messages }, false);
    const got = pairs(out).filter((p) => p.kind === "resp").map((p) => p.name);
    expect(got).toEqual(["alpha", "beta", "gamma"]);
  });

  it("collides across parallel calls in one turn as well as across turns", () => {
    const out = openaiToGeminiRequest("gemini-2.0-flash", {
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          tool_calls: [
            { id: "dup", type: "function", function: { name: "read", arguments: "{}" } },
            { id: "dup", type: "function", function: { name: "write", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "dup", content: '{"r":1}' },
        { role: "tool", tool_call_id: "dup", content: '{"w":2}' },
      ],
    }, false);
    expect(pairs(out).map((p) => `${p.kind}:${p.name}`)).toEqual([
      "call:read",
      "call:write",
      "resp:read",
      "resp:write",
    ]);
  });

  it("still emits a response part for a call with no result (intermediate turn)", () => {
    const out = openaiToGeminiRequest("gemini-2.0-flash", {
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "search", arguments: "{}" } }] },
      ],
    }, false);
    const p = pairs(out);
    expect(p.some((x) => x.kind === "call" && x.name === "search")).toBe(true);
    expect(p.some((x) => x.kind === "resp" && x.name === "search")).toBe(true);
  });

  it("falls back to the id-derived name only when the call is unknown", () => {
    const out = openaiToGeminiRequest("gemini-2.0-flash", {
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", tool_calls: [{ id: "toolu_01_do_thing", type: "function", function: { name: "renamed", arguments: "{}" } }] },
      ],
    }, false);
    // The declared name wins over the id-derived guess.
    expect(pairs(out).some((p) => p.name === "renamed")).toBe(true);
  });

  it("works the same through the Antigravity path", () => {
    const out = openaiToAntigravityRequest("gemini-2.0-flash", body(["call_81334", "call_81334"]), false);
    const p = pairs(out.request ?? out);
    expect(p.map((x) => `${x.kind}:${x.name}`)).toEqual([
      "call:edit",
      "resp:edit",
      "call:bash",
      "resp:bash",
    ]);
  });
});
