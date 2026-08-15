import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("injectSystemPrompt", () => {
  it("uses top-level instructions for openai-responses when instructions is absent (#2497)", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.instructions).toBe("respond tersely");
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
    ]);
  });

  it("appends top-level instructions for openai-responses", () => {
    const body = {
      instructions: "be helpful",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.instructions).toBe("be helpful\n\nrespond tersely");
  });

  it("keeps chat completions system injection in messages", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };

    injectSystemPrompt(body, FORMATS.OPENAI, "respond tersely");

    expect(body.messages[0]).toEqual({ role: "system", content: "respond tersely" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });
});
