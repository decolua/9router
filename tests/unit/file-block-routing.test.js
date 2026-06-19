import { describe, it, expect } from "vitest";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { VALID_OPENAI_CONTENT_TYPES, OPENAI_BLOCK, CLAUDE_BLOCK } from "../../open-sse/translator/schema/index.js";

const PDF_DATA = "data:application/pdf;base64,JVBERi0xLjE=";
const PNG_DATA = "data:image/png;base64,iVBORw0KGgo=";

describe("file/document block support", () => {
  it("schema: file is a valid openai content type", () => {
    expect(VALID_OPENAI_CONTENT_TYPES).toContain(OPENAI_BLOCK.FILE);
    expect(OPENAI_BLOCK.FILE).toBe("file");
    expect(CLAUDE_BLOCK.DOCUMENT).toBe("document");
  });

  it("gemini: openai file block -> inlineData", () => {
    const parts = convertOpenAIContentToParts([
      { type: "text", text: "read this" },
      { type: "file", file: { filename: "d.pdf", file_data: PDF_DATA } },
    ]);
    const inline = parts.find((p) => p.inlineData);
    expect(inline).toBeTruthy();
    expect(inline.inlineData.mime_type).toBe("application/pdf");
    expect(inline.inlineData.data).toBe("JVBERi0xLjE=");
  });

  it("gemini: ignores non-data-uri file", () => {
    const parts = convertOpenAIContentToParts([
      { type: "file", file: { filename: "d.pdf", file_data: "https://x/d.pdf" } },
    ]);
    expect(parts.some((p) => p.inlineData)).toBe(false);
  });

  it("claude: openai file (pdf) -> document block", () => {
    const out = openaiToClaudeRequest("claude-x", {
      messages: [{ role: "user", content: [
        { type: "text", text: "read" },
        { type: "file", file: { filename: "d.pdf", file_data: PDF_DATA } },
      ] }],
    }, false);
    const blocks = out.messages[0].content;
    const doc = blocks.find((b) => b.type === "document");
    expect(doc).toBeTruthy();
    expect(doc.source.media_type).toBe("application/pdf");
  });

  it("claude: non-pdf file is dropped (not a document)", () => {
    const out = openaiToClaudeRequest("claude-x", {
      messages: [{ role: "user", content: [
        { type: "text", text: "read" },
        { type: "file", file: { filename: "i.png", file_data: PNG_DATA } },
      ] }],
    }, false);
    const blocks = out.messages[0].content;
    expect(blocks.some((b) => b.type === "document")).toBe(false);
  });
});
