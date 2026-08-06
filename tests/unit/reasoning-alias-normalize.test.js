import { describe, expect, it, vi } from "vitest";

// nonStreamingHandler pulls in requestDetail → src/lib/usageDb via @/ alias.
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
}));

import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("reasoning alias normalization (#2936)", () => {
  it("non-streaming: renames message.reasoning to reasoning_content (OpenAI target)", () => {
    const body = {
      choices: [{
        message: { role: "assistant", reasoning: "think step by step", content: "42" },
        finish_reason: "stop",
      }],
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.choices[0].message.reasoning_content).toBe("think step by step");
    expect(out.choices[0].message.reasoning).toBeUndefined();
    expect(out.choices[0].message.content).toBe("42");
  });

  it("non-streaming: leaves existing reasoning_content untouched", () => {
    const body = {
      choices: [{
        message: { role: "assistant", reasoning: "ignored", reasoning_content: "kept", content: "x" },
        finish_reason: "stop",
      }],
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.choices[0].message.reasoning_content).toBe("kept");
    expect(out.choices[0].message.reasoning).toBe("ignored");
  });
});
