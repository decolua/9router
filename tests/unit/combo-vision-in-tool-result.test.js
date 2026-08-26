// The path every chat front end actually uses.
//
// A Discord attachment is saved to disk and the model is asked to Read it, so the
// image reaches the router as a tool_result, not as a user image block. Measured
// 2026-08-23: a WhatsApp "Incorrect code" screenshot sent this way was answered with
// a confident description of a "Linked Devices screen showing a linked device" —
// the model had been given no image at all, because the request was never
// classified as needing vision and the combo never reordered.
import { describe, it, expect } from "vitest";
import { detectRequiredCapabilities } from "open-sse/services/combo.js";

/** Exactly what Claude Code sends after its Read tool opens a PNG. */
const readToolImage = (mediaType = "image/png") => ({
  messages: [
    { role: "user", content: "what does this screenshot say? /tmp/x/IMG_9841.png" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/x/IMG_9841.png" } }] },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: "iVBORw0KGgo=" } }],
        },
      ],
    },
  ],
});

describe("an image inside a tool result still needs vision", () => {
  it("requires vision when the Read tool returned an image", () => {
    expect(detectRequiredCapabilities(readToolImage()).has("vision")).toBe(true);
  });

  it("still sees it when the tool result is one of several blocks", () => {
    const body = readToolImage();
    body.messages[2].content.unshift({ type: "text", text: "Here is the file." });
    expect(detectRequiredCapabilities(body).has("vision")).toBe(true);
  });

  it("reads the modality from the block, not from the tool", () => {
    // A PDF read the same way must ask for pdf, not vision.
    const body = readToolImage();
    body.messages[2].content[0].content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBER" } },
    ];
    const required = detectRequiredCapabilities(body);
    expect(required.has("pdf")).toBe(true);
    expect(required.has("vision")).toBe(false);
  });

  it("catches a data URI returned as tool text", () => {
    const body = readToolImage();
    body.messages[2].content[0].content = "data:image/png;base64,iVBORw0KGgo=";
    expect(detectRequiredCapabilities(body).has("vision")).toBe(true);
  });

  it("asks for nothing when the tool returned ordinary text", () => {
    const body = readToolImage();
    body.messages[2].content[0].content = [{ type: "text", text: "export const x = 1;" }];
    expect(detectRequiredCapabilities(body).size).toBe(0);
  });

  it("does not recurse forever on a self-referential result", () => {
    const block = { type: "tool_result", tool_use_id: "t1", content: [] };
    block.content.push(block);
    expect(() => detectRequiredCapabilities({ messages: [{ role: "user", content: [block] }] })).not.toThrow();
  });

  it("still ignores an image from a turn the model has already answered", () => {
    // Modalities are scanned on the current turn only; re-routing every later
    // question to a vision model because an image appeared once is not the job.
    const body = readToolImage();
    body.messages.push({ role: "assistant", content: [{ type: "text", text: "It says Incorrect code." }] });
    body.messages.push({ role: "user", content: "thanks, now redeploy the ingester" });
    expect(detectRequiredCapabilities(body).has("vision")).toBe(false);
  });
});
