// #4316: a user message whose only content block is `container_upload`
// (Anthropic Files API) was dropped whole, so the provider received
// `messages: []` and the request still returned 200 with no indication that
// the user turn had vanished.
//
// hasValidContent() enumerated the block types that count as content, and any
// type outside that list made the message look empty — prepareClaudeRequest
// then filtered it out. container_upload is valid Anthropic input on its own,
// and on the Claude→Claude route no translation runs at all, so the block
// should reach the provider untouched.
import { describe, expect, it } from "vitest";

import { hasValidContent, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const uploadBlock = { type: "container_upload", file_id: "file_abc123" };

describe("container_upload keeps the user turn alive (#4316)", () => {
  it("counts a lone container_upload block as content", () => {
    expect(hasValidContent({ role: "user", content: [uploadBlock] })).toBe(true);
  });

  it("counts a bare container_upload object as content", () => {
    expect(hasValidContent({ role: "user", content: uploadBlock })).toBe(true);
  });

  it("does not forward messages: [] for a container_upload-only request", () => {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: [uploadBlock] }],
    };
    const prepared = prepareClaudeRequest(body);
    expect(prepared.messages).toHaveLength(1);
    expect(prepared.messages[0].role).toBe("user");
    expect(prepared.messages[0].content).toContainEqual(expect.objectContaining({
      type: "container_upload",
      file_id: "file_abc123",
    }));
  });

  it("still drops a genuinely empty message", () => {
    expect(hasValidContent({ role: "user", content: [] })).toBe(false);
    expect(hasValidContent({ role: "user", content: [{ type: "text", text: "   " }] })).toBe(false);
  });

  it("keeps a container_upload alongside text", () => {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: [uploadBlock, { type: "text", text: "summarise this" }] }],
    };
    const prepared = prepareClaudeRequest(body);
    expect(prepared.messages).toHaveLength(1);
  });
});
