import { describe, expect, it } from "vitest";

import { openaiToGeminiRequest, openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// #3972: an OpenAI-compatible request may legally carry several `role:"system"`
// messages (agents stack a base prompt with per-session / per-tool rules).
// Gemini takes a single systemInstruction, and the translator assigned over it
// on every system message, so only the LAST one survived and the rest were
// silently dropped.

const conv = (messages) => openaiToGeminiRequest("gemini-2.0-flash", { model: "gemini-2.0-flash", messages }, false);
const sysText = (out) => (out.systemInstruction?.parts || []).map((p) => p.text);

describe("multiple system messages survive (#3972)", () => {
  it("keeps all three, in order", () => {
    const out = conv([
      { role: "system", content: "System A" },
      { role: "system", content: "System B" },
      { role: "system", content: "System C" },
      { role: "user", content: "Hello" },
    ]);
    expect(sysText(out)).toEqual(["System A", "System B", "System C"]);
  });

  it("keeps a single system message exactly as before", () => {
    const out = conv([
      { role: "system", content: "Only one" },
      { role: "user", content: "Hi" },
    ]);
    expect(sysText(out)).toEqual(["Only one"]);
    expect(out.systemInstruction.role).toBe("user");
  });

  it("handles system messages interleaved with the conversation", () => {
    const out = conv([
      { role: "system", content: "Base" },
      { role: "user", content: "q1" },
      { role: "system", content: "Extra" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
    expect(sysText(out)).toEqual(["Base", "Extra"]);
  });

  it("does not let a system message leak into contents", () => {
    const out = conv([
      { role: "system", content: "A" },
      { role: "system", content: "B" },
      { role: "user", content: "Hello" },
    ]);
    const flat = out.contents.flatMap((c) => c.parts.map((p) => p.text)).filter(Boolean);
    expect(flat).toEqual(["Hello"]);
  });

  it("preserves non-string system content as its text", () => {
    const out = conv([
      { role: "system", content: [{ type: "text", text: "Structured A" }] },
      { role: "system", content: "Plain B" },
      { role: "user", content: "Hello" },
    ]);
    expect(sysText(out)).toEqual(["Structured A", "Plain B"]);
  });

  it("still routes a lone system message into contents when it is the only message", () => {
    // Pre-existing behaviour: with body.messages.length === 1 the system message
    // is treated as the user turn, because Gemini requires contents to start
    // with a user turn. That path is untouched.
    const out = conv([{ role: "system", content: "Solo" }]);
    expect(out.systemInstruction).toBeUndefined();
    expect(out.contents[0].role).toBe("user");
  });

  it("works through the Antigravity entry point too", () => {
    const out = openaiToAntigravityRequest("gemini-2.0-flash", {
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "System A" },
        { role: "system", content: "System B" },
        { role: "user", content: "Hello" },
      ],
    }, false);
    const parts = out.request?.systemInstruction?.parts ?? out.systemInstruction?.parts ?? [];
    expect(parts.map((p) => p.text)).toEqual(["System A", "System B"]);
  });
});
