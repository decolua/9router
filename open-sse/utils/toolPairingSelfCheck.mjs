// Tool-pairing invariant self-check (OpenAI intermediate format).
// Run: node open-sse/utils/toolPairingSelfCheck.mjs
// No framework, no deps. Uses assert. Mirrors openaiResponsesToolPairingSelfCheck.mjs style.
import { salvageOrphanedToolResults } from "../translator/concerns/toolCall.js";

const results = [];
function run(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
  }
}
const assert = {
  equal(a, b, msg) { if (a !== b) throw new Error(`${msg || ""} expected ${b}, got ${a}`); },
  ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); },
};

// 1. Matched OpenAI tool_calls + role:tool preserved
run("OpenAI matched tool result preserved", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "result" },
      { role: "user", content: "next" }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 3, "message count");
  assert.equal(out.messages[1].tool_call_id, "call_1", "tool result preserved");
});

// 2. Orphan OpenAI role:tool salvaged to user text (merged with adjacent user)
run("OpenAI orphan tool result salvaged to user text", () => {
  const body = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "call_ghost", content: "stale" },
      { role: "user", content: "next" }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 1, "salvaged user merged with adjacent user messages");
  assert.ok(!out.messages.some(m => m.role === "tool"), "no tool messages remain");
  assert.ok(out.messages[0].content.includes("[Tool result: stale]"), "salvaged text present");
  assert.ok(out.messages[0].content.includes("hi"), "original user text preserved");
  assert.ok(out.messages[0].content.includes("next"), "next user text preserved");
});

// 3. Zero-call truncation salvages all stale tool results to user text (merged)
run("Zero-call truncation salvages all stale tool results", () => {
  const body = {
    messages: [
      { role: "tool", tool_call_id: "call_a", content: "x" },
      { role: "tool", tool_call_id: "call_b", content: "y" },
      { role: "user", content: "next" }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 1, "all salvaged user msgs merged with existing user");
  assert.ok(!out.messages.some(m => m.role === "tool"), "no tool messages remain");
  assert.ok(out.messages[0].content.includes("[Tool result: x]"), "first orphan salvaged");
  assert.ok(out.messages[0].content.includes("[Tool result: y]"), "second orphan salvaged");
  assert.ok(out.messages[0].content.includes("next"), "original user text preserved");
});

// 4. Claude-shaped tool_use + tool_result preserved
run("Claude-shaped matched tool_result preserved", () => {
  const body = {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "bar", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 3, "claude matched preserved");
  assert.equal(out.messages[1].content[0].tool_use_id, "tu_1", "claude tool_result preserved");
});

// 5. Orphan Claude-shaped tool_result salvaged to text block while text remains
run("Claude-shaped orphan tool_result salvaged to text block in mixed user content", () => {
  const body = {
    messages: [
      { role: "user", content: [
        { type: "text", text: "keep me" },
        { type: "tool_result", tool_use_id: "tu_ghost", content: "stale" }
      ] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 2, "mixed user message kept");
  assert.equal(out.messages[0].content.length, 2, "orphan block salvaged (not dropped)");
  assert.equal(out.messages[0].content[0].text, "keep me", "original text block preserved");
  assert.equal(out.messages[0].content[1].text, "[Tool result: stale]", "orphan salvaged to text block");
});

// 6. User message with only orphan tool_result blocks is kept with salvaged text
run("User message with only orphan tool_result blocks salvaged to text", () => {
  const body = {
    messages: [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_ghost", content: "stale" }] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 2, "message kept with salvaged text");
  assert.equal(out.messages[0].content[0].text, "[Tool result: stale]", "orphan salvaged to text block");
  assert.equal(out.messages[1].content[0].text, "next", "next user message preserved");
});

// 7. No-op body keeps same messages array reference
run("No-op keeps same body when no orphans", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "result" }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out, body, "same body reference returned on no-op");
});

// 8. Mixed: one matched, one orphan — matched kept, orphan salvaged (merged with next user)
run("Mixed: matched kept, orphan salvaged", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "matched" },
      { role: "tool", tool_call_id: "call_orphan", content: "stale" },
      { role: "user", content: "next" }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 3, "orphan salvaged and merged with next user");
  assert.ok(out.messages.some(m => m.role === "tool" && m.tool_call_id === "call_1"), "matched tool kept");
  assert.ok(!out.messages.some(m => m.role === "tool" && m.tool_call_id === "call_orphan"), "orphan tool removed");
  assert.ok(out.messages.some(m => m.role === "user" && typeof m.content === "string" && m.content.includes("[Tool result: stale]")), "orphan salvaged to text");
  assert.ok(out.messages.some(m => m.role === "user" && typeof m.content === "string" && m.content.includes("next")), "next user text merged");
});

// 9. Image-only orphan tool_result is dropped (no text to salvage — #2122)
run("Image-only orphan tool_result dropped (no text representation)", () => {
  const body = {
    messages: [
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "tu_ghost", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR..." } }] }
      ] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 1, "image-only orphan dropped, message removed");
  assert.equal(out.messages[0].content[0].text, "next", "next user message preserved");
});

// 10. Claude-shape mixed message with image-only orphan + text block — text kept, image dropped
run("Claude mixed: image-only orphan dropped, text block preserved in same message", () => {
  const body = {
    messages: [
      { role: "user", content: [
        { type: "text", text: "keep me" },
        { type: "tool_result", tool_use_id: "tu_ghost", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR..." } }] }
      ] },
      { role: "user", content: [{ type: "text", text: "next" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 2, "mixed message kept (has text block)");
  assert.equal(out.messages[0].content.length, 1, "image-only orphan dropped, text block kept");
  assert.equal(out.messages[0].content[0].text, "keep me", "text block preserved");
});

// 11. Gemini contents[] — orphaned functionResponse salvaged to text part
run("Gemini orphan functionResponse salvaged to text part", () => {
  const body = {
    contents: [
      { role: "user", parts: [
        { functionResponse: { id: "fn_gone", name: "search", response: { result: "stale data" } } },
        { text: "continue" }
      ] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.contents[0].parts.length, 2, "orphan salvaged (not dropped)");
  assert.equal(out.contents[0].parts[0].text, "[Tool result: stale data]", "orphan salvaged to text part");
  assert.equal(out.contents[0].parts[1].text, "continue", "original text part preserved");
});

// 12. Gemini contents[] — matched functionResponse preserved
run("Gemini matched functionResponse preserved", () => {
  const body = {
    contents: [
      { role: "model", parts: [{ functionCall: { id: "fn_live", name: "search", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { id: "fn_live", name: "search", response: { result: "ok" } } }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.contents[1].parts.length, 1, "matched functionResponse preserved");
  assert.equal(out.contents[1].parts[0].functionResponse.id, "fn_live", "id preserved");
});

// 13. Gemini name-based fallback pairing (no id, match by name)
run("Gemini name-based fallback: orphan by name salvaged, matched by name kept", () => {
  const body = {
    contents: [
      { role: "model", parts: [{ functionCall: { name: "search", args: {} } }] },
      { role: "user", parts: [
        { functionResponse: { name: "search", response: { result: "ok" } } },
        { functionResponse: { name: "gone_fn", response: { result: "stale" } } }
      ] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.contents[1].parts.length, 2, "matched kept, orphan salvaged");
  assert.equal(out.contents[1].parts[0].functionResponse.name, "search", "matched by name kept");
  assert.equal(out.contents[1].parts[1].text, "[Tool result: stale]", "orphan by name salvaged to text");
});

// 14. Consecutive user messages merged after salvage (prevents Gemini 400)
run("Consecutive user messages merged after salvage", () => {
  const body = {
    messages: [
      { role: "tool", tool_call_id: "call_a", content: "x" },
      { role: "tool", tool_call_id: "call_b", content: "y" },
      { role: "user", content: "next" }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 1, "all salvaged user msgs merged with existing user");
  assert.equal(out.messages[0].content, "[Tool result: x]\n[Tool result: y]\nnext", "all text merged into one user message");
});

// 15. Consecutive user merge does NOT merge array-content messages (structured blocks)
run("Consecutive user merge skips array-content messages", () => {
  const body = {
    messages: [
      { role: "tool", tool_call_id: "call_ghost", content: "salvaged" },
      { role: "user", content: [{ type: "text", text: "structured" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  assert.equal(out.messages.length, 2, "array-content user message not merged with string salvage");
  assert.equal(out.messages[0].content, "[Tool result: salvaged]", "salvaged string user message");
  assert.ok(Array.isArray(out.messages[1].content), "array-content user message preserved as array");
});

// 16. Gemini: functionCall in a non-model turn does NOT mask orphans (role guard)
run("Gemini role guard: non-model functionCall does not mask orphans", () => {
  const body = {
    contents: [
      // Malformed: a user turn carrying functionCall (shouldn't happen, but be defensive)
      { role: "user", parts: [{ functionCall: { id: "fn_x", name: "search", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { id: "fn_x", name: "search", response: { result: "stale" } } }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  // fn_x was only in a user turn, not a model turn → it's an orphan → salvaged to text
  assert.ok(!out.contents[1].parts.some(p => p.functionResponse), "orphan not masked by non-model functionCall");
  assert.ok(out.contents[1].parts.some(p => p.text === "[Tool result: stale]"), "orphan salvaged to text");
});

// 17. Gemini: turn with all image-only orphans dropped (no empty parts[] → Gemini 400)
run("Gemini: turn with all-orphan parts dropped (no empty parts[])", () => {
  const body = {
    contents: [
      { role: "user", parts: [
        { functionResponse: { id: "fn_gone", name: "screenshot", response: { result: "" } } }
      ] },
      { role: "user", parts: [{ text: "continue" }] }
    ]
  };
  const out = salvageOrphanedToolResults(body);
  // The orphan turn had only an empty-result functionResponse → no text salvaged → turn dropped
  assert.equal(out.contents.length, 1, "empty-orphan turn dropped, not left with parts:[]");
  assert.equal(out.contents[0].parts[0].text, "continue", "remaining turn preserved");
});

// 18. null/undefined body returns unchanged (fail-open guard)
run("null body returns null (fail-open guard)", () => {
  assert.equal(salvageOrphanedToolResults(null), null, "null body returns null");
  assert.equal(salvageOrphanedToolResults(undefined), undefined, "undefined body returns undefined");
});

// 19. Salvage does not mutate input messages by reference (clone-on-merge)
run("Salvage does not mutate input messages by reference", () => {
  const originalUser = { role: "user", content: "hi" };
  const body = {
    messages: [
      originalUser,
      { role: "tool", tool_call_id: "call_ghost", content: "stale" },
      { role: "user", content: "next" }
    ]
  };
  salvageOrphanedToolResults(body);
  assert.equal(originalUser.content, "hi", "original user msg content not mutated by merge");
});

// 20. Duplicate OpenAI tool result (same call_id twice) → second salvaged to user text
run("OpenAI duplicate tool result salvaged", () => {
  const body = {
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "first result" },
      { role: "user", content: "new topic" },
      { role: "tool", tool_call_id: "call_1", content: "stale duplicate" },
    ]
  };
  const out = salvageOrphanedToolResults(body);
  const toolMsgs = out.messages.filter(m => m.role === "tool");
  assert.equal(toolMsgs.length, 1, "only first tool result kept, duplicate salvaged");
  assert.equal(toolMsgs[0].content, "first result", "first result preserved");
  assert.ok(out.messages.some(m => m.role === "user" && m.content.includes("stale duplicate")), "duplicate salvaged to user text");
});

// 21. Duplicate Claude tool_result block (same tool_use_id twice) → second salvaged
run("Claude duplicate tool_result block salvaged", () => {
  const body = {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "foo", input: {} }] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "tu_1", content: "first" },
        { type: "text", text: "some text" },
        { type: "tool_result", tool_use_id: "tu_1", content: "duplicate" },
      ] },
    ]
  };
  const out = salvageOrphanedToolResults(body);
  const userMsg = out.messages.find(m => m.role === "user");
  const toolResults = userMsg.content.filter(b => b.type === "tool_result");
  assert.equal(toolResults.length, 1, "only first tool_result block kept");
  assert.equal(toolResults[0].content, "first", "first tool_result preserved");
  assert.ok(userMsg.content.some(b => b.type === "text" && b.text.includes("duplicate")), "duplicate salvaged to text block");
});

// 22. Duplicate Gemini functionResponse (same id twice) → second salvaged
run("Gemini duplicate functionResponse salvaged", () => {
  const body = {
    contents: [
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ functionCall: { id: "fc_1", name: "f1", args: {} } }] },
      { role: "user", parts: [
        { functionResponse: { id: "fc_1", name: "f1", response: { result: "first" } } },
        { functionResponse: { id: "fc_1", name: "f1", response: { result: "dup" } } },
      ] },
    ]
  };
  const out = salvageOrphanedToolResults(body);
  const userTurn = out.contents.find(c => c.role === "user" && c.parts.some(p => p.functionResponse));
  const fnResponses = userTurn.parts.filter(p => p.functionResponse);
  assert.equal(fnResponses.length, 1, "only first functionResponse kept");
  assert.ok(userTurn.parts.some(p => p.text && p.text.includes("dup")), "duplicate salvaged to text part");
});

// Summary
const passed = results.filter(r => r.ok).length;
const total = results.length;
for (const r of results) {
  console.log(`${r.ok ? "ok" : "FAIL"} - ${r.name}${r.ok ? "" : ` :: ${r.err}`}`);
}
console.log(`\n${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
