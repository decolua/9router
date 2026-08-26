import { describe, it, expect } from "vitest";

import { findDegeneracy, extractVisibleText, hasAssistantPrefill, GATE_WINDOW_CHARS } from "../../open-sse/utils/degeneracy.js";

describe("degeneracy gate: detects a continuation posing as a reply", () => {
  it("catches both observed incidents verbatim", () => {
    // Session 17b4c03c and ed0d25ad, the last thing each model produced.
    expect(findDegeneracy(" you seems like hallucinating again")).toBeTruthy();
    expect(findDegeneracy(". JUST WHAT YOU HAVE DONE IN THIS CURRENT SESSION")).toBeTruthy();
  });

  it("judges only the opening window", () => {
    const good = "Here is the answer you asked for. " + "x".repeat(GATE_WINDOW_CHARS * 2) + " . and then";
    expect(findDegeneracy(good)).toBeNull();
  });
});

describe("degeneracy gate: does not fire on ordinary replies", () => {
  it.each([
    ["    const result = compute();", "indented code line"],
    ["\tconst x = 1;", "tab-indented line"],
    ["  nested bullet", "indented bullet"],
    ["Refactor the authentication", "opening that restates the task"],
    ["Here is how it works.", "plain sentence"],
    ["The router picks a model by band.", "starts with an article"],
    ["**Bold** opening.", "markdown emphasis"],
    ["1. First it reads the combo.", "numbered list"],
    ["- a bullet point", "bullet"],
    ["```js\nconst a = 1;\n```", "code fence"],
    ["`inline code` first", "inline code"],
    ["#include <stdio.h>", "preprocessor line"],
    ["...actually, let me reconsider", "leading ellipsis"],
    [" Capitalised after a leading space", "leading space then capital"],
    ["(parenthetical opening)", "open paren"],
    ["> quoted line", "blockquote"],
  ])("allows %j (%s)", (text) => {
    expect(findDegeneracy(text)).toBeNull();
  });

  it("allows an empty or whitespace-only opening", () => {
    expect(findDegeneracy("")).toBeNull();
    expect(findDegeneracy("   ")).toBeNull();
  });

  it("exempts a prefill, where resuming mid-sentence is the correct behaviour", () => {
    expect(hasAssistantPrefill({ messages: [{ role: "user", content: "q" }, { role: "assistant", content: "The answer is" }] })).toBe(true);
    expect(hasAssistantPrefill({ messages: [{ role: "user", content: "q" }] })).toBe(false);
    expect(hasAssistantPrefill({})).toBe(false);
    // The text itself still reads as a continuation — the exemption is the
    // caller's job, which is why the gate is skipped rather than softened.
    expect(findDegeneracy(" the answer is 42 because")).toBeTruthy();
  });
});

describe("degeneracy gate: visible-text extraction", () => {
  it("reads OpenAI, Claude and Gemini frames", () => {
    expect(extractVisibleText({ choices: [{ delta: { content: "hi" } }] })).toBe("hi");
    expect(extractVisibleText({ type: "content_block_delta", delta: { text: "hi" } })).toBe("hi");
    expect(extractVisibleText({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })).toBe("hi");
    expect(extractVisibleText({ response: { candidates: [{ content: { parts: [{ text: "hi" }] } }] } })).toBe("hi");
  });

  it("ignores Gemini thought parts, which legitimately open mid-thought", () => {
    const frame = { candidates: [{ content: { parts: [{ thought: true, text: ". continuing a thought" }, { text: "Answer." }] } }] };
    expect(extractVisibleText(frame)).toBe("Answer.");
  });

  it("returns empty for frames carrying no visible text", () => {
    expect(extractVisibleText(null)).toBe("");
    expect(extractVisibleText({ type: "message_start" })).toBe("");
    expect(extractVisibleText({ choices: [{ delta: { tool_calls: [] } }] })).toBe("");
  });
});
