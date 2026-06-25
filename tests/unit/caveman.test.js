import { describe, expect, it } from "vitest";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function countInString(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) { count++; pos += needle.length; }
  return count;
}

function countPrompt(value, prompt) {
  const str = JSON.stringify(value).replace(/\\\"/g, '"');
  const normPrompt = prompt.replace(/\\\"/g, '"');
  return countInString(str, normPrompt);
}

describe("Caveman token saver", () => {
  it("injects OpenAI chat system prompt", () => {
    const body = { messages: [{ role: "system", content: "Base policy" }, { role: "user", content: "hi" }] };
    injectCaveman(body, FORMATS.OPENAI, "full");
    injectCaveman(body, FORMATS.OPENAI, "full");
    expect(body.messages[0].content).toContain("Base policy");
    expect(countPrompt(body, CAVEMAN_PROMPTS.full)).toBeGreaterThan(0);
  });

  it("uses input_text parts for OpenAI chat content arrays", () => {
    const body = { messages: [{ role: "developer", content: [{ type: "text", text: "Base policy" }] }] };
    injectCaveman(body, FORMATS.OPENAI, "ultra");
    expect(body.messages[0].content.at(-1)).toEqual({ type: "input_text", text: CAVEMAN_PROMPTS.ultra });
  });

  it("routes OpenAI Responses caveman to body.instructions", () => {
    const body = { input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectCaveman(body, FORMATS.OPENAI_RESPONSES, "lite");
    expect(body.instructions).toBe(CAVEMAN_PROMPTS.lite);
    expect(body.input[0]).toEqual({ role: "user", content: [{ type: "input_text", text: "hi" }] });
  });

  it("switches levels without accumulating old prompts", () => {
    const body = { messages: [{ role: "system", content: "Base policy" }] };
    injectCaveman(body, FORMATS.OPENAI, "lite");
    injectCaveman(body, FORMATS.OPENAI, "wenyan-ultra");
    expect(body.messages[0].content).toContain("Base policy");
    expect(body.messages[0].content).toContain(CAVEMAN_PROMPTS.lite);
    expect(body.messages[0].content).toContain(CAVEMAN_PROMPTS["wenyan-ultra"]);
  });

  it("keeps Claude system prompt and inserts before cache breakpoint", () => {
    const body = {
      system: [
        { type: "text", text: "Base policy" },
        { type: "text", text: "cache here", cache_control: { type: "ephemeral" } },
      ],
    };
    injectCaveman(body, FORMATS.CLAUDE, "full");
    expect(body.system[0]).toEqual({ type: "text", text: "Base policy" });
    expect(body.system[1]).toEqual({ type: "text", text: CAVEMAN_PROMPTS.full });
    expect(body.system[2]).toEqual({ type: "text", text: "cache here", cache_control: { type: "ephemeral" } });
  });

  it("supports Gemini and Antigravity wrapper", () => {
    const body = { request: { contents: [], systemInstruction: { parts: [{ text: "Base policy" }] } } };
    injectCaveman(body, FORMATS.ANTIGRAVITY, "wenyan-lite");
    expect(body.request.systemInstruction.parts.at(-1)).toEqual({ text: CAVEMAN_PROMPTS["wenyan-lite"] });
  });
});
