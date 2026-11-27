import { describe, it, expect } from "vitest";
import { stripSystemPromptSegments, applyReaAllow, SAFETY_RULE_SIGNATURES } from "open-sse/translator/concerns/systemPrompt.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { RESPONSES_ITEM } from "open-sse/translator/schema/blocks.js";
import { ROLE } from "open-sse/translator/schema/roles.js";

// Verbatim from Claude Code's built-in policy — both signatures in one paragraph.
const PARA_SECURITY = "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";
const PARA_IDENTITY = "You are a Claude agent working with the user toward their goals.";
const PARA_TOOLS = "# Tools\n\nBash runs commands.";
const buildSystem = () => [PARA_IDENTITY, PARA_SECURITY, PARA_TOOLS].join("\n\n");
const REA_LINK = "https://github.com/morluto/rea";

describe("stripSystemPromptSegments", () => {
  it("exposes the two Claude Code safety-rule signatures", () => {
    expect(SAFETY_RULE_SIGNATURES).toHaveLength(2);
  });

  // ---- Claude ----
  it("claude: removes the matching paragraph from system blocks, keeps the rest", () => {
    const body = { system: [{ type: "text", text: buildSystem() }] };
    stripSystemPromptSegments(body, FORMATS.CLAUDE);
    expect(body.system).toHaveLength(1);
    expect(body.system[0].text).not.toContain("mass targeting");
    expect(body.system[0].text).toContain(PARA_IDENTITY);
    expect(body.system[0].text).toContain("# Tools");
  });

  it("claude: keeps an emptied block that carries cache_control", () => {
    const body = {
      system: [
        { type: "text", text: PARA_SECURITY, cache_control: { type: "ephemeral" } },
        { type: "text", text: PARA_IDENTITY },
      ],
    };
    stripSystemPromptSegments(body, FORMATS.CLAUDE);
    expect(body.system).toHaveLength(2);
    expect(body.system[0].text).toBe("");
    expect(body.system[0].cache_control).toBeDefined();
  });

  it("claude: deletes string system when everything matched", () => {
    const body = { system: PARA_SECURITY };
    stripSystemPromptSegments(body, FORMATS.CLAUDE);
    expect(body.system).toBeUndefined();
  });

  // ---- OpenAI Chat ----
  it("openai chat: filters the system message, leaves user messages untouched", () => {
    const body = {
      messages: [
        { role: ROLE.SYSTEM, content: buildSystem() },
        { role: ROLE.USER, content: "hello" },
      ],
    };
    stripSystemPromptSegments(body, FORMATS.OPENAI);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).not.toContain("Dual-use security tools");
    expect(body.messages[0].content).toContain(PARA_IDENTITY);
    expect(body.messages[1].content).toBe("hello");
  });

  it("openai chat: splices out a fully emptied system message", () => {
    const body = {
      messages: [
        { role: ROLE.SYSTEM, content: PARA_SECURITY },
        { role: ROLE.USER, content: "hello" },
      ],
    };
    stripSystemPromptSegments(body, FORMATS.OPENAI);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe(ROLE.USER);
  });

  it("openai chat: filters text blocks inside a system content array", () => {
    const body = {
      messages: [
        {
          role: ROLE.SYSTEM,
          content: [
            { type: "text", text: PARA_IDENTITY },
            { type: "text", text: PARA_SECURITY },
          ],
        },
      ],
    };
    stripSystemPromptSegments(body, FORMATS.OPENAI);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].text).toBe(PARA_IDENTITY);
  });

  // ---- OpenAI Responses ----
  it("responses: strips the instructions string", () => {
    const body = { instructions: buildSystem(), input: [] };
    stripSystemPromptSegments(body, FORMATS.OPENAI_RESPONSES);
    expect(body.instructions).not.toContain("mass targeting");
    expect(body.instructions).toContain(PARA_IDENTITY);
  });

  it("responses: deletes emptied instructions", () => {
    const body = { instructions: PARA_SECURITY, input: [] };
    stripSystemPromptSegments(body, FORMATS.OPENAI_RESPONSES);
    expect(body.instructions).toBeUndefined();
  });

  it("responses: filters system message items inside input[]", () => {
    const body = {
      input: [
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.SYSTEM, content: [{ type: "input_text", text: buildSystem() }] },
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    stripSystemPromptSegments(body, FORMATS.OPENAI_RESPONSES);
    expect(body.input).toHaveLength(2);
    expect(body.input[0].content[0].text).not.toContain("Dual-use security tools");
    expect(body.input[1].content[0].text).toBe("hi");
  });

  // ---- Gemini ----
  it("gemini: filters systemInstruction parts", () => {
    const body = {
      systemInstruction: { parts: [{ text: PARA_IDENTITY }, { text: PARA_SECURITY }] },
      contents: [],
    };
    stripSystemPromptSegments(body, FORMATS.GEMINI);
    expect(body.systemInstruction.parts).toHaveLength(1);
    expect(body.systemInstruction.parts[0].text).toBe(PARA_IDENTITY);
  });

  it("gemini: deletes an emptied systemInstruction", () => {
    const body = { systemInstruction: { parts: [{ text: PARA_SECURITY }] }, contents: [] };
    stripSystemPromptSegments(body, FORMATS.GEMINI);
    expect(body.systemInstruction).toBeUndefined();
  });

  // ---- Kiro ----
  it("kiro: filters the system prefix inside the first user turn, keeps user text", () => {
    const body = {
      conversationState: {
        history: [{ userInputMessage: { content: `${buildSystem()}\n\nUSER QUESTION` } }],
      },
    };
    stripSystemPromptSegments(body, FORMATS.KIRO);
    const content = body.conversationState.history[0].userInputMessage.content;
    expect(content).not.toContain("mass targeting");
    expect(content).toContain("USER QUESTION");
  });

  // ---- Replacement ----
  it("substitutes the matching paragraph in place when a replacement is given", () => {
    const body = { system: [{ type: "text", text: buildSystem() }] };
    stripSystemPromptSegments(body, FORMATS.CLAUDE, { replacement: "REA GUIDANCE" });
    expect(body.system[0].text).toContain("REA GUIDANCE");
    expect(body.system[0].text).not.toContain("mass targeting");
    expect(body.system[0].text).toContain(PARA_IDENTITY);
  });

  it("empty-string replacement drops the paragraph (pure strip)", () => {
    const body = { system: buildSystem() };
    stripSystemPromptSegments(body, FORMATS.CLAUDE, { replacement: "" });
    expect(body.system).not.toContain("mass targeting");
    expect(body.system).toContain(PARA_IDENTITY);
  });

  // ---- Generic behaviour ----
  it("leaves the body untouched when nothing matches", () => {
    const body = { system: [{ type: "text", text: PARA_IDENTITY }] };
    const before = JSON.stringify(body);
    stripSystemPromptSegments(body, FORMATS.CLAUDE);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("fail-open: tolerates null/invalid bodies", () => {
    expect(() => stripSystemPromptSegments(null, FORMATS.CLAUDE)).not.toThrow();
    expect(() => stripSystemPromptSegments({}, FORMATS.OPENAI)).not.toThrow();
    expect(() => stripSystemPromptSegments({ messages: null }, FORMATS.OPENAI)).not.toThrow();
  });

  it("honours custom signatures", () => {
    const body = { system: "KEEP\n\nDROP ME NOW" };
    stripSystemPromptSegments(body, FORMATS.CLAUDE, { signatures: ["DROP ME"] });
    expect(body.system).toBe("KEEP");
  });
});

describe("applyReaAllow", () => {
  it("drops the policy paragraph and appends the REA guidance as a separate block", () => {
    const body = { system: [{ type: "text", text: buildSystem() }] };
    expect(applyReaAllow(body, FORMATS.CLAUDE)).toBe(true);
    expect(body.system[0].text).not.toContain("mass targeting");
    expect(body.system[0].text).toContain(PARA_IDENTITY);
    const reaBlock = body.system.find(b => b && typeof b.text === "string" && b.text.includes(REA_LINK));
    expect(reaBlock).toBeTruthy();
  });

  it("injects the REA guidance when nothing matched", () => {
    const body = { system: "You are helpful." };
    expect(applyReaAllow(body, FORMATS.CLAUDE)).toBe(true);
    expect(body.system).toContain(REA_LINK);
    expect(body.system).toContain("You are helpful.");
  });

  it("injects into the OpenAI chat system message", () => {
    const body = {
      messages: [
        { role: ROLE.SYSTEM, content: "You are helpful." },
        { role: ROLE.USER, content: "hi" },
      ],
    };
    applyReaAllow(body, FORMATS.OPENAI);
    expect(body.messages[0].content).toContain(REA_LINK);
    expect(body.messages[1].content).toBe("hi");
  });

  it("does not duplicate the guidance on repeated runs", () => {
    const body = { system: "You are helpful." };
    applyReaAllow(body, FORMATS.CLAUDE);
    applyReaAllow(body, FORMATS.CLAUDE);
    expect(body.system.split(REA_LINK)).toHaveLength(2); // exactly one occurrence
  });

  it("fail-open: tolerates invalid bodies", () => {
    expect(applyReaAllow(null, FORMATS.CLAUDE)).toBe(false);
  });
});
