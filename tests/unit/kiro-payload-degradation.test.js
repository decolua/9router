import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { shrinkKiroImage } from "../../open-sse/utils/kiroImage.js";
import { shrinkKiroPayload } from "../../open-sse/utils/kiroPayloadShrink.js";
import {
  KIRO_IMAGE_DROP_NOTICE,
  KIRO_MAX_PAYLOAD_BYTES,
  KIRO_TRUNCATION_NOTICE,
} from "../../open-sse/config/kiroConstants.js";

function buildPayload({ content = "", history = [], images = null, toolResults = null, tools = null } = {}) {
  const userInputMessage = { content, modelId: "claude-sonnet-4.6" };
  if (images) userInputMessage.images = images;
  const context = {};
  if (toolResults) context.toolResults = toolResults;
  if (tools) context.tools = tools;
  if (Object.keys(context).length > 0) userInputMessage.userInputMessageContext = context;
  const payload = {
    systemPrompt: "sys",
    conversationState: {
      chatTriggerType: "MANUAL",
      currentMessage: { userInputMessage },
    },
  };
  if (history.length > 0) payload.conversationState.history = history;
  return payload;
}

function encodedSize(payload) {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

describe("shrinkKiroImage", () => {
  it("resizes an oversized PNG to a 2000px longest edge", () => {
    const png = new PNG({ width: 2100, height: 16 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 200;
      png.data[i + 1] = 30;
      png.data[i + 2] = 40;
      png.data[i + 3] = 255;
    }
    const base64 = PNG.sync.write(png).toString("base64");
    const image = { format: "png", source: { bytes: base64 } };

    const out = shrinkKiroImage(image);
    expect(out).not.toBe(image);
    expect(out.format).toBe("png");
    const decoded = PNG.sync.read(Buffer.from(out.source.bytes, "base64"));
    expect(decoded.width).toBe(2000);
    expect(decoded.height).toBeGreaterThan(0);
  });

  it("re-encodes a large JPEG smaller and passes through undecodable formats", () => {
    const raw = jpeg.encode({ data: Buffer.alloc(2400 * 1200 * 4, 128), width: 2400, height: 1200 }, 95).data;
    const image = { format: "jpeg", source: { bytes: raw.toString("base64") } };
    const out = shrinkKiroImage(image);
    expect(out.source.bytes.length).toBeLessThan(image.source.bytes.length);
    expect(out.format).toBe("jpeg");

    const gif = { format: "gif", source: { bytes: Buffer.from("R0lGOD").toString("base64") } };
    expect(shrinkKiroImage(gif)).toBe(gif);
  });

  it("leaves images above the 5MiB base64 guard untouched (drop candidates)", () => {
    const huge = { format: "jpeg", source: { bytes: "A".repeat(6 * 1024 * 1024) } };
    expect(shrinkKiroImage(huge)).toBe(huge);
  });
});

describe("shrinkKiroPayload", () => {
  it("returns the identical reference for payloads within budget", () => {
    const payload = buildPayload({ content: "hello" });
    expect(shrinkKiroPayload(payload)).toBe(payload);
  });

  it("trims history pairs first and keeps the current message", () => {
    const history = [];
    for (let i = 0; i < 8; i++) {
      history.push({ userInputMessage: { content: `u${i}-${"x".repeat(120_000)}`, modelId: "m" } });
      history.push({ assistantResponseMessage: { content: `a${i}-${"y".repeat(20_000)}` } });
    }
    const payload = buildPayload({ content: "current", history });
    expect(encodedSize(payload)).toBeGreaterThan(KIRO_MAX_PAYLOAD_BYTES);

    const out = shrinkKiroPayload(payload);
    expect(encodedSize(out)).toBeLessThanOrEqual(KIRO_MAX_PAYLOAD_BYTES);
    expect(out.conversationState.currentMessage.userInputMessage.content).toBe("current");
    expect(out.systemPrompt).toBe("sys");
    // History was only trimmed from the front.
    expect(out.conversationState.history[0].userInputMessage.content.startsWith("u")).toBe(true);
    // The original payload object was not mutated.
    expect(encodedSize(payload)).toBeGreaterThan(KIRO_MAX_PAYLOAD_BYTES);
  });

  it("drops the largest images and appends a notice when images cannot save the payload", () => {
    const images = [
      { format: "jpeg", source: { bytes: "A".repeat(600_000) } },
      { format: "jpeg", source: { bytes: "B".repeat(1_200_000) } },
    ];
    const payload = buildPayload({ content: "look at this", images, history: [
      { userInputMessage: { content: "h".repeat(950_000), modelId: "m" } },
    ] });

    const out = shrinkKiroPayload(payload);
    expect(encodedSize(out)).toBeLessThanOrEqual(KIRO_MAX_PAYLOAD_BYTES);
    // Only the largest image was dropped; the smaller one survives.
    const keptImages = out.conversationState.currentMessage.userInputMessage.images;
    expect(keptImages).toHaveLength(1);
    expect(keptImages[0].source.bytes.length).toBe(600_000);
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(KIRO_IMAGE_DROP_NOTICE);
  });

  it("truncates the largest tool result and appends a truncation notice", () => {
    const toolResults = [
      { toolUseId: "t1", status: "success", content: [{ text: "z".repeat(950_000) }] },
      { toolUseId: "t2", status: "success", content: [{ text: "small" }] },
    ];
    const payload = buildPayload({ content: "run done", toolResults });

    const out = shrinkKiroPayload(payload);
    expect(encodedSize(out)).toBeLessThanOrEqual(KIRO_MAX_PAYLOAD_BYTES);
    const text = out.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text;
    expect(text).toContain(KIRO_TRUNCATION_NOTICE);
    expect(text.length).toBeLessThan(950_000);
    // The smaller result is untouched.
    expect(out.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[1].content[0].text).toBe("small");
  });

  it("truncates the current content as the last degradation step", () => {
    const payload = buildPayload({ content: "c".repeat(950_000) });
    const out = shrinkKiroPayload(payload);
    expect(encodedSize(out)).toBeLessThanOrEqual(KIRO_MAX_PAYLOAD_BYTES);
    const content = out.conversationState.currentMessage.userInputMessage.content;
    expect(content).toContain(KIRO_TRUNCATION_NOTICE);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThan(950_000);
  });

  it("is idempotent: shrinking an already-shrunk payload changes nothing", () => {
    const payload = buildPayload({ content: "c".repeat(950_000) });
    const once = shrinkKiroPayload(payload);
    const twice = shrinkKiroPayload(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("throws when the payload cannot be degraded any further", () => {
    const tools = [{
      toolSpecification: {
        name: "huge",
        description: "d".repeat(980_000),
        inputSchema: { json: { type: "object", properties: {} } },
      },
    }];
    const payload = buildPayload({ content: ".", tools });
    try {
      shrinkKiroPayload(payload);
      expect.unreachable("expected KIRO_PAYLOAD_LIMIT");
    } catch (error) {
      expect(error.code).toBe("KIRO_PAYLOAD_LIMIT");
    }
  });
});
