// Prompt-cache breakpoint placement on the claude request path.
//
// Regression guard for a production incident: a single breakpoint pinned to the
// LAST assistant message meant the breakpoint advanced every turn, leaving
// nothing at the previous position for Anthropic to read cache from. Result was
// ~688k cache-creation tokens re-written 29s after the prior request while the
// context had only grown ~985 tokens — cache writes became 52% of spend.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { prepareClaudeRequest, pickCacheBreakpointIndices, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

const U = (t) => ({ role: "user", content: [{ type: "text", text: t }] });
const A = (t) => ({ role: "assistant", content: [{ type: "text", text: t }] });
const THINK = () => ({ role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "s" }] });

// Collect message indices carrying a cache_control breakpoint.
const msgBreakpoints = (body) => {
  const idx = [];
  body.messages.forEach((msg, i) => {
    if (Array.isArray(msg.content) && msg.content.some((b) => b.cache_control)) idx.push(i);
  });
  return idx;
};

const run = (messages) =>
  prepareClaudeRequest(
    {
      model: "claude-opus-5",
      max_tokens: 1024,
      system: [{ type: "text", text: "sys" }],
      tools: [{ name: "t1", description: "d", input_schema: { type: "object" } }],
      messages: structuredClone(messages),
    },
    "claude", "k", null, {}, null
  );

describe("pickCacheBreakpointIndices", () => {
  it("never exceeds the 2-slot message budget", () => {
    const messages = [];
    for (let i = 0; i < 20; i++) messages.push(U("u" + i), A("a" + i));
    expect(pickCacheBreakpointIndices(messages).size).toBeLessThanOrEqual(2);
  });

  // The whole point of the fix: this turn's anchor must sit exactly where the
  // previous turn's tail was, so the cache written then is read back now.
  it("anchors on the position the previous turn used as its tail", () => {
    let messages = [];
    let prevTail = null;
    for (let turn = 1; turn <= 6; turn++) {
      messages = [...messages, U("u" + turn), A("a" + turn)];
      const picked = [...pickCacheBreakpointIndices(messages)].sort((a, b) => a - b);
      if (prevTail !== null) {
        expect(picked.length, `turn ${turn} should have anchor + tail`).toBe(2);
        expect(picked[0], `turn ${turn} anchor must equal turn ${turn - 1} tail`).toBe(prevTail);
      }
      prevTail = picked[picked.length - 1];
    }
  });

  it("skips messages a breakpoint cannot attach to", () => {
    // thinking-only assistant: cache_control is illegal on thinking blocks, so
    // picking it would burn a slot and emit nothing.
    expect(pickCacheBreakpointIndices([U("u"), THINK()]).size).toBe(0);
    expect(pickCacheBreakpointIndices([U("u"), { role: "assistant", content: [] }]).size).toBe(0);
    // ...but skip past it to reach real assistants.
    expect([...pickCacheBreakpointIndices([U("u1"), A("a1"), U("u2"), THINK(), U("u3"), A("a3")])].sort((a, b) => a - b))
      .toEqual([1, 5]);
  });

  it("returns nothing when there is no assistant turn yet", () => {
    expect(pickCacheBreakpointIndices([]).size).toBe(0);
    expect(pickCacheBreakpointIndices([U("only user")]).size).toBe(0);
  });
});

describe("prepareClaudeRequest cache breakpoints", () => {
  // Anthropic rejects requests carrying more than 4 breakpoints, and system +
  // tools already claim one each.
  it("stays within Anthropic's 4-breakpoint limit as the conversation grows", () => {
    let messages = [];
    for (let turn = 1; turn <= 8; turn++) {
      messages = [...messages, U("u" + turn), A("a" + turn)];
      const out = run(messages);
      const total =
        msgBreakpoints(out).length +
        (out.system || []).filter((b) => b.cache_control).length +
        (out.tools || []).filter((t) => t.cache_control).length;
      expect(total, `turn ${turn} breakpoint count`).toBeLessThanOrEqual(4);
    }
  });

  it("emits two message breakpoints once a second assistant turn exists", () => {
    const single = run([U("u1"), A("a1")]);
    expect(msgBreakpoints(single)).toHaveLength(1);

    const multi = run([U("u1"), A("a1"), U("u2"), A("a2")]);
    expect(msgBreakpoints(multi)).toHaveLength(2);
  });

  it("keeps the long-lived 1h breakpoints on system and tools", () => {
    const out = run([U("u1"), A("a1")]);
    expect(out.system.at(-1).cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(out.tools.at(-1).cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  // Messages churn far more than system/tools, and 1h writes cost 2x base input
  // vs 1.25x for 5m. With 99% of observed turns under 5 minutes apart, the
  // default TTL is both sufficient and cheaper here.
  it("leaves message breakpoints at the default 5m TTL", () => {
    const out = run([U("u1"), A("a1"), U("u2"), A("a2")]);
    for (const i of msgBreakpoints(out)) {
      const block = out.messages[i].content.find((b) => b.cache_control);
      expect(block.cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("drops cache_control the client sent so the budget stays predictable", () => {
    const noisy = [
      { role: "user", content: [{ type: "text", text: "u1", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: [{ type: "text", text: "a1", cache_control: { type: "ephemeral" } }] },
      { role: "user", content: [{ type: "text", text: "u2", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: [{ type: "text", text: "a2", cache_control: { type: "ephemeral" } }] },
    ];
    const out = run(noisy);
    // User turns must not keep client-supplied breakpoints.
    for (const msg of out.messages.filter((m) => m.role === "user")) {
      expect(msg.content.some((b) => b.cache_control)).toBe(false);
    }
    expect(msgBreakpoints(out)).toHaveLength(2);
  });
});

// Native passthrough (Claude Code → claude provider) skips prepareClaudeRequest
// entirely — 21k of 21.5k observed requests took this path — so breakpoint
// handling here matters far more than in the translator.
describe("normalizeClaudePassthrough mid-conversation system messages", () => {
  const norm = (messages, extra = {}) =>
    normalizeClaudePassthrough({ messages: structuredClone(messages), ...extra }, "claude-opus-5");

  const countMsgBreakpoints = (body) => {
    let n = 0;
    (body.messages || []).forEach((m) => {
      if (Array.isArray(m.content)) m.content.forEach((b) => { if (b.cache_control) n++; });
    });
    return n;
  };

  it("rewrites role system to user without moving it", () => {
    const out = norm([
      { role: "user", content: [{ type: "text", text: "u1" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "system", content: [{ type: "text", text: "reminder" }] },
    ]);
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out.messages[2].content[0].text).toBe("reminder");
    // The API rejects role:"system" inside messages — none may survive.
    expect(out.messages.some((m) => m.role === "system")).toBe(false);
  });

  // The whole point of the change: `system` must not grow, because it sits
  // BEFORE messages in the cached prefix. Growth there invalidated every
  // cached message behind it and re-wrote ~133k tokens per occurrence.
  it("does not grow the top-level system as reminders accumulate", () => {
    const base = [
      { role: "user", content: [{ type: "text", text: "u1" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
    ];
    const turn1 = norm([...base, { role: "system", content: [{ type: "text", text: "r1" }] }],
      { system: [{ type: "text", text: "fixed prompt" }] });
    const turn2 = norm([...base,
      { role: "system", content: [{ type: "text", text: "r1" }] },
      { role: "assistant", content: [{ type: "text", text: "a2" }] },
      { role: "system", content: [{ type: "text", text: "r2" }] },
    ], { system: [{ type: "text", text: "fixed prompt" }] });

    expect(turn2.system).toEqual(turn1.system);
    expect(turn2.system).toHaveLength(1);
  });

  // Cache hits require a byte-exact prefix, so everything the previous turn
  // already sent must be untouched — new content may only append at the tail.
  it("keeps the previous turn's prefix byte-identical", () => {
    const base = [
      { role: "user", content: [{ type: "text", text: "u1" }] },
      { role: "assistant", content: [{ type: "text", text: "a1" }] },
      { role: "system", content: [{ type: "text", text: "r1" }] },
    ];
    const turn1 = norm(base);
    const turn2 = norm([...base,
      { role: "assistant", content: [{ type: "text", text: "a2" }] },
      { role: "system", content: [{ type: "text", text: "r2" }] },
    ]);

    expect(turn2.messages.slice(0, turn1.messages.length)).toEqual(turn1.messages);
  });

  it("preserves a cache_control the client put on a system message", () => {
    const out = norm([
      { role: "user", content: [{ type: "text", text: "u1" }] },
      { role: "system", content: [{ type: "text", text: "r", cache_control: { type: "ephemeral" } }] },
    ]);
    expect(countMsgBreakpoints(out)).toBe(1);
  });

  it("accepts string content and never emits an empty message", () => {
    const out = norm([
      { role: "system", content: "plain string" },
      { role: "system", content: [{ type: "text", text: "   " }] },
    ]);
    expect(out.messages[0].content).toEqual([{ type: "text", text: "plain string" }]);
    expect(out.messages[1].content.length).toBeGreaterThan(0);
    expect(out.messages[1].content[0].text.trim()).not.toBe("");
  });

  it("leaves conversations without system messages alone", () => {
    const out = norm([{ role: "user", content: [{ type: "text", text: "u", cache_control: { type: "ephemeral" } }] }]);
    expect(countMsgBreakpoints(out)).toBe(1);
    expect(out.messages).toHaveLength(1);
  });
});
