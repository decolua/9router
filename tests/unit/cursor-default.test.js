import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";
import {
  normalizeCursorModelId,
  resolveCursorUpstreamModel,
  shouldPromoteThinkingToContent,
} from "../../open-sse/utils/cursorModel.js";

const LEN = 2;

function cursorResponseFrame({ text = "", thinking = "" }) {
  const responseFields = [];

  if (text) {
    responseFields.push(encodeField(1, LEN, text));
  }

  if (thinking) {
    const thinkingMessage = encodeField(1, LEN, thinking);
    responseFields.push(encodeField(25, LEN, thinkingMessage));
  }

  const response = Buffer.concat(responseFields.map((field) => Buffer.from(field)));
  const envelope = encodeField(2, LEN, response);
  return Buffer.from(wrapConnectRPCFrame(envelope));
}

describe("cursorModel helpers", () => {
  it("normalizes legacy Claude model ids", () => {
    expect(normalizeCursorModelId("cu/claude-3-5-sonnet-20240620")).toBe("claude-4.5-sonnet");
  });

  it("resolves default/auto to upstream fallback", () => {
    expect(resolveCursorUpstreamModel("cu/default")).toBe("claude-4.5-sonnet");
    expect(resolveCursorUpstreamModel("auto")).toBe("claude-4.5-sonnet");
  });

  it("promotes thinking for default and -thinking models", () => {
    expect(shouldPromoteThinkingToContent("cu/default")).toBe(true);
    expect(shouldPromoteThinkingToContent("claude-4.5-sonnet-thinking")).toBe(true);
    expect(shouldPromoteThinkingToContent("gpt-5.3-codex")).toBe(false);
  });
});

describe("CursorExecutor default model responses", () => {
  it("uses visible content after </think> for default model", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "internal plan</think>Hello!",
    });

    const response = executor.transformProtobufToJSON(buffer, "cu/default", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.choices[0].message.content).toBe("Hello!");
    expect(payload.usage.completion_tokens).toBeGreaterThan(0);
  });

  it("uses visible thinking for -thinking variant models", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "reasoning</think>Visible",
    });

    const response = executor.transformProtobufToJSON(buffer, "claude-4.5-sonnet-thinking", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBe("Visible");
  });

  it("returns error for empty completion with no tool calls", async () => {
    const executor = new CursorExecutor();
    const response = executor.transformProtobufToJSON(Buffer.alloc(0), "cu/default", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error?.code).toBe("empty_completion");
  });

  it("returns error for thinking-only on non-promoted models", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private</think>hidden",
    });

    const response = executor.transformProtobufToJSON(buffer, "gpt-5.3-codex", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error?.code).toBe("empty_completion");
  });
});
