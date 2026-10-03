// Non-messages[] sources (Gemini contents[], Responses input[]) carry the client's
// terminal role in their own shape. An explicit trailing model/assistant turn is real
// prefill and must survive translation to Claude; an emptied trailing user turn must
// still get the "Continue." restoration.
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";

const roles = (body) => body.messages.map((m) => m.role);

describe("trailing user turn: non-messages[] source formats", () => {
  it("keeps a Gemini trailing model turn (real prefill)", () => {
    const out = translateRequest("gemini", "claude", "claude-sonnet-4-5", {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "The answer is" }] },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant"]);
  });

  it("keeps a Responses trailing assistant message (real prefill)", () => {
    const out = translateRequest("openai-responses", "claude", "claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      input: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "The answer is" },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant"]);
  });

  it("still restores a user turn when a Gemini trailing user turn is emptied", () => {
    const out = translateRequest("gemini", "claude", "claude-sonnet-4-5", {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
        { role: "user", parts: [] },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
  });
});
