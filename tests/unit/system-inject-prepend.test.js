import { describe, it, expect } from "vitest";
import { injectSystemPrompt } from "open-sse/rtk/systemInject.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { CLAUDE_SYSTEM_PROMPT } from "open-sse/config/appConstants.js";

const SEP = "\n\n";
const PROMPT = "You are my-combo. Identity rules go here.";

describe("injectSystemPrompt — prepend position", () => {
  it("prepends into a Claude string system", () => {
    const body = { model: "m", system: "client instructions", messages: [] };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT, { position: "prepend" });
    expect(body.system).toBe(`${PROMPT}${SEP}client instructions`);
  });

  it("appends into a Claude string system by default (unchanged behavior)", () => {
    const body = { model: "m", system: "client instructions", messages: [] };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(body.system).toBe(`client instructions${SEP}${PROMPT}`);
  });

  it("inserts after the router Claude Code spoof block and before the client's cached block", () => {
    const body = {
      model: "m",
      system: [
        { type: "text", text: CLAUDE_SYSTEM_PROMPT },
        { type: "text", text: "client instructions", cache_control: { type: "ephemeral" } },
      ],
      messages: [],
    };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT, { position: "prepend" });
    expect(body.system).toHaveLength(3);
    expect(body.system[0].text).toBe(CLAUDE_SYSTEM_PROMPT);
    expect(body.system[1].text).toBe(PROMPT);
    expect(body.system[1].cache_control).toBeUndefined();
    expect(body.system[2].text).toBe("client instructions");
    expect(body.system[2].cache_control).toEqual({ type: "ephemeral" });
  });

  it("inserts at index 0 for a Claude array without the spoof block", () => {
    const body = {
      model: "m",
      system: [{ type: "text", text: "client instructions" }],
      messages: [],
    };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT, { position: "prepend" });
    expect(body.system[0].text).toBe(PROMPT);
    expect(body.system[1].text).toBe("client instructions");
  });

  it("sets a missing Claude system to the prompt", () => {
    const body = { model: "m", messages: [] };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT, { position: "prepend" });
    expect(body.system).toBe(PROMPT);
  });

  it("is idempotent when called twice with prepend (Claude array)", () => {
    const body = {
      model: "m",
      system: [
        { type: "text", text: CLAUDE_SYSTEM_PROMPT },
        { type: "text", text: "client instructions", cache_control: { type: "ephemeral" } },
      ],
      messages: [],
    };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT, { position: "prepend" });
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT, { position: "prepend" });
    expect(body.system).toHaveLength(3);
    expect(body.system.filter((b) => b.text === PROMPT)).toHaveLength(1);
  });

  it("prepends into the first system message content (OpenAI chat, string content)", () => {
    const body = { model: "m", messages: [{ role: "system", content: "client rules" }, { role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT, { position: "prepend" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(`${PROMPT}${SEP}client rules`);
    expect(body.messages[1].content).toBe("hi");
  });

  it("prepends a text block into block-array system content (OpenAI chat)", () => {
    const body = {
      model: "m",
      messages: [{ role: "system", content: [{ type: "text", text: "client rules" }] }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT, { position: "prepend" });
    expect(body.messages[0].content[0].text).toBe(PROMPT);
    expect(body.messages[0].content[1].text).toBe("client rules");
  });

  it("unshifts a new system message when none exists (OpenAI chat)", () => {
    const body = { model: "m", messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT, { position: "prepend" });
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.messages[1].content).toBe("hi");
  });

  it("prepends into the Responses instructions string", () => {
    const body = { model: "m", instructions: "client rules", input: [] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT, { position: "prepend" });
    expect(body.instructions).toBe(`${PROMPT}${SEP}client rules`);
  });

  it("prepends a block into the first system item of Responses input[]", () => {
    const body = {
      model: "m",
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "client rules" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT, { position: "prepend" });
    expect(body.input[0].content[0].text).toBe(PROMPT);
    expect(body.input[0].content[1].text).toBe("client rules");
  });

  it("prepends into Gemini systemInstruction parts", () => {
    const body = { model: "m", systemInstruction: { parts: [{ text: "client rules" }] }, contents: [] };
    injectSystemPrompt(body, FORMATS.GEMINI, PROMPT, { position: "prepend" });
    expect(body.systemInstruction.parts[0].text).toBe(PROMPT);
    expect(body.systemInstruction.parts[1].text).toBe("client rules");
  });

  it("prepends into snake_case system_instruction (Vertex shape)", () => {
    const body = { model: "m", system_instruction: { parts: [{ text: "client rules" }] }, contents: [] };
    injectSystemPrompt(body, FORMATS.VERTEX, PROMPT, { position: "prepend" });
    expect(body.system_instruction.parts[0].text).toBe(PROMPT);
  });

  it("prepends inside the antigravity body.request envelope", () => {
    const body = { request: { contents: [], systemInstruction: { parts: [{ text: "client rules" }] } } };
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, PROMPT, { position: "prepend" });
    expect(body.request.systemInstruction.parts[0].text).toBe(PROMPT);
  });

  it("prepends before the first Kiro user turn's content", () => {
    const body = {
      conversationState: {
        history: [{ userInputMessage: { content: "client rules folded here" } }],
        currentMessage: { userInputMessage: { content: "hi" } },
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, PROMPT, { position: "prepend" });
    expect(body.conversationState.history[0].userInputMessage.content)
      .toBe(`${PROMPT}${SEP}client rules folded here`);
  });

  it("prepends into commandcode params.system", () => {
    const body = { threadId: "t", config: {}, params: { model: "m", messages: [{ role: "user", content: "hi" }], system: "client rules" } };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT, { position: "prepend" });
    expect(body.params.system).toBe(`${PROMPT}${SEP}client rules`);
  });

  it("sets commandcode params.system when absent", () => {
    const body = { threadId: "t", config: {}, params: { model: "m", messages: [{ role: "user", content: "hi" }] } };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT, { position: "prepend" });
    expect(body.params.system).toBe(PROMPT);
  });

  it("never throws on a frozen body (fail-open)", () => {
    const body = Object.freeze({ model: "m", messages: Object.freeze([{ role: "system", content: "x" }]) });
    expect(() => injectSystemPrompt(body, FORMATS.OPENAI, PROMPT, { position: "prepend" })).not.toThrow();
  });

  it("no-ops on null/undefined body or prompt", () => {
    expect(() => injectSystemPrompt(null, FORMATS.OPENAI, PROMPT, { position: "prepend" })).not.toThrow();
    expect(() => injectSystemPrompt({ messages: [] }, FORMATS.OPENAI, "", { position: "prepend" })).not.toThrow();
  });
});
