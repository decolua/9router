// #3795 — a proxy must not dispatch more cache_control blocks than Anthropic
// accepts, and must not lose turns that use single-object content (#3567 interplay).
import { describe, it, expect } from "vitest";
import {
  anchorClaudeCache,
  normalizeClaudePassthrough,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const CC = { type: "ephemeral" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name, extra = {}) => ({ name, description: "d", input_schema: {}, ...extra });

// counts markers incl. single-object content — mirrors the upstream contract
function countMarkers(body) {
  let n = 0;
  if (Array.isArray(body.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body.messages)) for (const m of body.messages) {
    if (Array.isArray(m?.content)) {
      for (const b of m.content) if (b?.cache_control) n++;
    } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
  }
  return n;
}

describe("cache marker budget and single-block content", () => {
  it("never emits more than four markers when the client already spent its budget", () => {
    const out = anchorClaudeCache({
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1"), tool("t2", { cache_control: CC })],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: text("a1", { cache_control: CC }) },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBeLessThanOrEqual(4);   // base: 5
  });

  it("normalizes a single-object turn in passthrough and anchors it", () => {
    const body = {
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },     // single object, no marker
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    const assistant = body.messages.find(m => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant.content)).toBe(true); // base: still bare object
    expect(assistant.content).toHaveLength(1);
    const out = anchorClaudeCache(body);
    expect(countMarkers(out)).toBe(1);
  });

  it("keeps a turn whose content is a single object and strips its marker", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1")],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    const kept = out.messages.filter(m => JSON.stringify(m.content).includes("u1"));
    expect(kept.length).toBe(1);                        // base: 0 (dropped)
    expect(kept[0].content).toHaveLength(1);           // normalized to array
    expect(kept[0].content[0].cache_control).toBeUndefined();
  });

  it("drops no conversation turn when content is a single text object", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(out.messages.length).toBe(3);               // base: 1
    expect(Array.isArray(out.messages[0].content)).toBe(true);
  });

  it("re-anchors the last assistant turn even when it uses single-object content", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(countMarkers(out)).toBe(1);                 // base: 0
  });

  it("keeps a marked single-object turn when the marker budget is spent", () => {
    const body = {
      system: [text("s1", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC })],
      messages: [
        { role: "user", content: [text("c1"), text("c2")] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    const out = anchorClaudeCache(body);
    const kept = out.messages.filter(m => JSON.stringify(m.content).includes("u1"));
    expect(kept.length).toBe(1);
    expect(Array.isArray(kept[0].content)).toBe(true); // base: bare object survives
    expect(kept[0].content).toHaveLength(1);
    expect(kept[0].content[0].cache_control).toBeUndefined();
    const ctx = out.messages.find(m => JSON.stringify(m.content).includes("c1"));
    expect(ctx.content).toEqual([text("c1"), text("c2")]);
    expect(countMarkers(out)).toBeLessThanOrEqual(4);  // fixed: 3
  });

  it("keeps single-object turns on the claude-to-openai leg", () => {
    const out = claudeToOpenAIRequest("m", {
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } } },
      ],
    }, false);
    expect(out.messages.some(m => JSON.stringify(m.content).includes("u1"))).toBe(true); // base: dropped
    const img = out.messages.find(m => m.role === "assistant");
    expect(JSON.stringify(img.content)).toContain("image_url"); // base: dropped
  });

  it("keeps a bare-object user turn folded with a mid-conversation system message", () => {
    const body = {
      messages: [
        { role: "user", content: text("u1") },
        { role: "system", content: [text("reminder")] },
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    const first = body.messages[0];
    expect(Array.isArray(first.content)).toBe(true);
    expect(JSON.stringify(first.content).includes("u1")).toBe(true); // pre-hoist: fold zeroes bare-object content
    expect(JSON.stringify(first.content).includes("reminder")).toBe(true);
  });
  it("prunes a client body that already carries five markers down to four", () => {
    const out = anchorClaudeCache({
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2", { cache_control: CC })],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBe(4);                    // pre-fix: 5 forwarded unchanged
    expect(out.system[0].cache_control).toBeUndefined();  // earliest marker pruned
  });

  // A spent budget must not cost the head anchors their 1h TTL: system/tools are
  // the whole point of re-anchoring, and a 5m fallback silently halves the cache
  // lifetime on exactly the requests that already cached aggressively.
  it("keeps the 1h head anchors when the client spent the whole budget", () => {
    const out = anchorClaudeCache({
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2")],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
    expect(out.system.at(-1).cache_control?.ttl).toBe("1h");  // pre-fix: fell back to 5m
    expect(out.tools.at(-1).cache_control?.ttl).toBe("1h");   // pre-fix: fell back to 5m
  });

  it("keeps the 1h head anchors on an over-budget body", () => {
    const out = anchorClaudeCache({
      system: [text("s1", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2")],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("u2", { cache_control: CC })] },
        { role: "assistant", content: [text("a2", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBe(4);
    expect(out.system.at(-1).cache_control?.ttl).toBe("1h");
    expect(out.tools.at(-1).cache_control?.ttl).toBe("1h");
  });

  it("strips a marker from a deferred tool even when the budget is spent", () => {
    const out = anchorClaudeCache({
      system: [text("s1", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC, defer_loading: true })],
      messages: [
        { role: "user", content: [text("u1", { cache_control: CC })] },
        { role: "assistant", content: [text("a1", { cache_control: CC })] },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBeLessThanOrEqual(4);
    const deferred = out.tools.find(t => t.defer_loading);
    expect(deferred?.cache_control).toBeUndefined();      // pre-fix: invalid marker forwarded
  });

  it("keeps a bare-object system reminder on the claude-to-openai leg", () => {
    const out = claudeToOpenAIRequest("m", {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: text("be brief") },
      ],
    }, false);
    expect(JSON.stringify(out.messages)).toContain("be brief"); // pre-fix: turn dropped
  });
});
