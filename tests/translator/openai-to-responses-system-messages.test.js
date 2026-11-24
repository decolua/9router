// Chat Completions → Responses: every system/developer message reaches `instructions`.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2R = (body) => translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", body, true, null, null);

describe("OpenAI Chat Completions → Responses instructions", () => {
  it("joins several system messages in order instead of keeping only the first", () => {
    const out = O2R({
      messages: [
        { role: "system", content: "# Tools\nAnswer briefly." },
        { role: "system", content: "The current date is 2026-10-14." },
        { role: "user", content: "What is today's date?" },
      ],
    });
    expect(out.instructions).toBe("# Tools\nAnswer briefly.\n\nThe current date is 2026-10-14.");
    expect(out.input.some((item) => item.role === "system" || item.role === "developer")).toBe(false);
  });

  it("joins system and developer messages and array content", () => {
    const out = O2R({
      messages: [
        { role: "developer", content: [{ type: "text", text: "Be precise." }] },
        { role: "user", content: "Hi" },
        { role: "system", content: "Reply in Vietnamese." },
      ],
    });
    expect(out.instructions).toBe("Be precise.\n\nReply in Vietnamese.");
  });

  it("keeps a single system message unchanged and leaves instructions empty without one", () => {
    expect(O2R({ messages: [{ role: "system", content: "Only one." }, { role: "user", content: "Hi" }] }).instructions)
      .toBe("Only one.");
    expect(O2R({ messages: [{ role: "user", content: "Hi" }] }).instructions).toBe("");
  });
});
