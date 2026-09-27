/**
 * Regression test for #4316
 *
 * A user message whose only content block is container_upload was silently
 * removed in two places:
 *
 * Case 1 (Claude→Claude): hasValidContent() in claude.js returned false for
 *   unknown block types, so prepareClaudeRequest filtered the whole message out.
 *   The provider received messages:[].
 *
 * Case 2 (Claude→OpenAI): convertClaudeMessage() in claude-to-openai.js had no
 *   default case in its block switch, so container_upload added nothing to
 *   parts/toolResults/toolCalls. With parts.length===0 and no special case the
 *   function returned null, and the message was silently skipped.
 *
 * Fix:
 *  - hasValidContent: treat any block.type that is not CLAUDE_BLOCK.TEXT as
 *    non-empty content (unknown = valid, keep the message).
 *  - convertClaudeMessage: add a default branch that emits a text-notice part
 *    for unrecognised block types instead of returning null.
 */

import { describe, it, expect } from "vitest";
import { hasValidContent } from "../../open-sse/translator/formats/claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

// ── hasValidContent ──────────────────────────────────────────────────────────

describe("hasValidContent — unknown block types (#4316)", () => {
  it("returns true when the only block is container_upload", () => {
    const msg = {
      role: "user",
      content: [{ type: "container_upload", file_id: "file-abc123" }]
    };
    expect(hasValidContent(msg)).toBe(true);
  });

  it("returns true when the only block is an unknown custom type", () => {
    const msg = {
      role: "user",
      content: [{ type: "file_reference", id: "x" }]
    };
    expect(hasValidContent(msg)).toBe(true);
  });

  it("still returns false for an empty content array", () => {
    expect(hasValidContent({ role: "user", content: [] })).toBe(false);
  });

  it("still returns false for a text block with only whitespace", () => {
    expect(hasValidContent({ role: "user", content: [{ type: "text", text: "   " }] })).toBe(false);
  });

  it("returns true for a mix of text and container_upload", () => {
    const msg = {
      role: "user",
      content: [
        { type: "container_upload", file_id: "f1" },
        { type: "text", text: "here is the file" }
      ]
    };
    expect(hasValidContent(msg)).toBe(true);
  });
});

// ── claudeToOpenAIRequest ────────────────────────────────────────────────────

describe("claudeToOpenAIRequest — container_upload not dropped (#4316 case 2)", () => {
  const makeBody = (blocks) => ({
    model: "claude-opus-5-5",
    max_tokens: 64,
    messages: [{ role: "user", content: blocks }]
  });

  it("does not produce messages:[] for a sole container_upload block", () => {
    const result = claudeToOpenAIRequest("any-model", makeBody([
      { type: "container_upload", file_id: "file-xyz" }
    ]), false);
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("preserves the user turn with a notice text for container_upload on Claude→OpenAI", () => {
    const result = claudeToOpenAIRequest("any-model", makeBody([
      { type: "container_upload", file_id: "file-xyz" }
    ]), false);
    const userMsg = result.messages.find(m => m.role === "user");
    expect(userMsg).toBeDefined();
    // Content should contain a notice string mentioning the block type
    const content = typeof userMsg.content === "string"
      ? userMsg.content
      : JSON.stringify(userMsg.content);
    expect(content).toMatch(/container_upload/);
  });

  it("preserves surrounding text content alongside a container_upload block", () => {
    const result = claudeToOpenAIRequest("any-model", makeBody([
      { type: "container_upload", file_id: "file-xyz" },
      { type: "text", text: "Please analyse this file." }
    ]), false);
    const userMsg = result.messages.find(m => m.role === "user");
    expect(userMsg).toBeDefined();
    const content = typeof userMsg.content === "string"
      ? userMsg.content
      : JSON.stringify(userMsg.content);
    expect(content).toContain("Please analyse this file.");
  });
});