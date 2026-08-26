import { describe, expect, it } from "vitest";
import { extractLastUserText, isUserEcho } from "../../open-sse/utils/userEcho.js";

const LONG = "Please review the deployment pipeline and tell me precisely which stage is failing, because the logs are contradictory and I need the real cause.";

describe("extractLastUserText", () => {
  it("reads the last user turn from openai-style messages", () => {
    expect(extractLastUserText({ messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ] })).toBe("second");
  });

  it("flattens claude-style content blocks", () => {
    expect(extractLastUserText({ messages: [
      { role: "user", content: [{ type: "text", text: "alpha" }, { type: "text", text: "beta" }] },
    ] })).toBe("alpha\nbeta");
  });

  it("falls back to responses input and gemini contents", () => {
    expect(extractLastUserText({ input: [{ role: "user", content: "from input" }] })).toBe("from input");
    expect(extractLastUserText({ contents: [{ role: "user", parts: [{ text: "from parts" }] }] })).toBe("from parts");
  });

  it("returns empty for junk", () => {
    expect(extractLastUserText(null)).toBe("");
    expect(extractLastUserText({})).toBe("");
    expect(extractLastUserText({ messages: [{ role: "assistant", content: "only assistant" }] })).toBe("");
  });
});

describe("isUserEcho", () => {
  it("flags a long verbatim regurgitation", () => {
    expect(isUserEcho(LONG, LONG)).toBe(true);
  });

  it("flags it despite whitespace reflow", () => {
    expect(isUserEcho(LONG.replace(/ /g, "\n"), LONG)).toBe(true);
  });

  it("does NOT flag a short quote of the user", () => {
    expect(isUserEcho("You asked: the logs are contradictory", LONG)).toBe(false);
  });

  it("does NOT flag a genuine answer", () => {
    expect(isUserEcho("Stage three fails because the image tag is stale; here is the evidence and the fix you should apply now.", LONG)).toBe(false);
  });

  it("does NOT flag when there is no user text", () => {
    expect(isUserEcho(LONG, "")).toBe(false);
  });

  it("ignores anything under the minimum length", () => {
    expect(isUserEcho("short", "short")).toBe(false);
  });
});
