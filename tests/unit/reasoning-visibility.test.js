import { describe, it, expect, afterEach } from "vitest";
import {
  shouldStripReasoningContent,
  applyReasoningVisibility
} from "open-sse/utils/reasoningVisibility.js";
import { REASONING_HEADER } from "open-sse/config/runtimeConfig.js";

const req = (headers) => ({ headers });

const response = () => ({
  choices: [{
    index: 0,
    message: { role: "assistant", content: "42", reasoning_content: "let me count" },
    finish_reason: "stop"
  }]
});

afterEach(() => {
  delete process.env.STRIP_REASONING_CONTENT;
});

describe("shouldStripReasoningContent", () => {
  it("keeps reasoning by default", () => {
    expect(shouldStripReasoningContent(undefined)).toBe(false);
    expect(shouldStripReasoningContent(req({}))).toBe(false);
  });

  it("strips when the client opts out via header", () => {
    expect(shouldStripReasoningContent(req({ [REASONING_HEADER]: "off" }))).toBe(true);
    expect(shouldStripReasoningContent(req({ [REASONING_HEADER]: "OFF" }))).toBe(true);
  });

  it("ignores any other header value", () => {
    expect(shouldStripReasoningContent(req({ [REASONING_HEADER]: "on" }))).toBe(false);
    expect(shouldStripReasoningContent(req({ [REASONING_HEADER]: "" }))).toBe(false);
    expect(shouldStripReasoningContent(req({ [REASONING_HEADER]: "offf" }))).toBe(false);
  });

  it("honours the env default flip", () => {
    for (const value of ["1", "true", "on", "YES", " true "]) {
      process.env.STRIP_REASONING_CONTENT = value;
      expect(shouldStripReasoningContent(undefined)).toBe(true);
    }
    for (const value of ["0", "false", "off", ""]) {
      process.env.STRIP_REASONING_CONTENT = value;
      expect(shouldStripReasoningContent(undefined)).toBe(false);
    }
  });
});

describe("applyReasoningVisibility", () => {
  it("leaves reasoning_content in place by default", () => {
    const res = applyReasoningVisibility(response(), req({}));
    expect(res.choices[0].message.reasoning_content).toBe("let me count");
  });

  it("drops reasoning_content when the client opts out", () => {
    const res = applyReasoningVisibility(response(), req({ [REASONING_HEADER]: "off" }));
    expect(res.choices[0].message).not.toHaveProperty("reasoning_content");
    expect(res.choices[0].message.content).toBe("42");
  });

  it("never drops reasoning_content when content is empty", () => {
    // A model that spent its whole budget reasoning has no other output to return.
    const res = {
      choices: [{ message: { role: "assistant", content: "", reasoning_content: "thinking..." } }]
    };
    applyReasoningVisibility(res, req({ [REASONING_HEADER]: "off" }));
    expect(res.choices[0].message.reasoning_content).toBe("thinking...");
  });

  it("applies to every choice", () => {
    const res = {
      choices: [
        { message: { content: "a", reasoning_content: "ra" } },
        { message: { content: "b", reasoning_content: "rb" } }
      ]
    };
    applyReasoningVisibility(res, req({ [REASONING_HEADER]: "off" }));
    expect(res.choices[0].message).not.toHaveProperty("reasoning_content");
    expect(res.choices[1].message).not.toHaveProperty("reasoning_content");
  });

  it("is a no-op on non-choices payloads (Claude message shape)", () => {
    const claude = { type: "message", content: [{ type: "thinking", thinking: "hi" }] };
    expect(applyReasoningVisibility(claude, req({ [REASONING_HEADER]: "off" }))).toBe(claude);
    expect(claude.content[0].thinking).toBe("hi");
    expect(applyReasoningVisibility(null, req({}))).toBe(null);
  });
});
