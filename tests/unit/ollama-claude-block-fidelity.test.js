import { describe, expect, it } from "vitest";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Phase 2 BLK-01/02/03/04 contract: verify same-format claude→claude passthrough
// leaves Claude-native content blocks untouched for ollama. Test bodies omit
// `thinking`/`output_config` so applyThinking is a no-op regardless of whether
// the 02-01 short-circuit exists (parallel Wave 1 independence).

describe("Phase 2: Block fidelity for ollama claude passthrough", () => {
  it("Contract BLK-01: tool_use and tool_result blocks round-trip losslessly", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "SF" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "72F" },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    const assistant = result.messages.find((m) => m.role === "assistant");
    const toolUse = assistant.content.find((b) => b.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse.id).toBe("toolu_1");
    expect(toolUse.name).toBe("get_weather");
    expect(toolUse.input).toEqual({ city: "SF" });

    const user = result.messages.find((m) => m.role === "user");
    const toolResult = user.content.find((b) => b.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult.tool_use_id).toBe("toolu_1");
    expect(toolResult.content).toBe("72F");
  });

  it("Contract BLK-02: text content blocks and system pass through with content preserved", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      system: "You are helpful",
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    expect(result.system).toBe("You are helpful");

    const user = result.messages.find((m) => m.role === "user");
    const textBlock = user.content.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    expect(textBlock.text).toBe("hello");
  });

  it("Contract BLK-03: base64 image content blocks pass through unchanged", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgo=",
              },
            },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    const user = result.messages.find((m) => m.role === "user");
    const image = user.content.find((b) => b.type === "image");
    expect(image).toBeDefined();
    expect(image.source.type).toBe("base64");
    expect(image.source.media_type).toBe("image/png");
    expect(image.source.data).toBe("iVBORw0KGgo=");
  });

  // WR-04: BLK-03 contract covers IMAGE blocks only. The hasValidContent fix in
  // prepareClaudeRequest (claude.js:13-25) also recognizes DOCUMENT blocks —
  // verify a document-bearing user message survives the empty-message filter
  // (would be dropped without the DOCUMENT branch in hasValidContent).
  it("Contract BLK-03b: document content blocks pass through hasValidContent filter", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "JVBERi0=",
              },
            },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    const user = result.messages.find((m) => m.role === "user");
    expect(user).toBeDefined();  // would be filtered out without the DOCUMENT fix
    const doc = user.content.find((b) => b.type === "document");
    expect(doc).toBeDefined();
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.source.data).toBe("JVBERi0=");
  });

  it("Contract BLK-03c: mixed text + document content blocks pass through hasValidContent filter", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "summarize this pdf" },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "JVBERi0xLjQK",
              },
            },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    const user = result.messages.find((m) => m.role === "user");
    expect(user).toBeDefined();
    expect(user.content.some((b) => b.type === "text")).toBe(true);
    expect(user.content.some((b) => b.type === "document")).toBe(true);
  });

  it("Contract BLK-04: same-format response passthrough returns [chunk] unchanged", () => {
    const chunk = { type: "message_start", message: { id: "msg_1" } };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
  });
});
