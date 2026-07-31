import { describe, it, expect } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { injectCustomPrompt } from "../../open-sse/rtk/customPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const SEP = "\n\n";
const PROMPT = "Output must be in English.";

// ─── Guards (fail-open) ──────────────────────────────────────────────

describe("injectSystemPrompt – guards", () => {
  it("does nothing when body is null", () => {
    const body = null;
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body).toBeNull();
  });

  it("does nothing when body is undefined", () => {
    const body = undefined;
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body).toBeUndefined();
  });

  it("does nothing when prompt is empty string", () => {
    const body = { messages: [{ role: "system", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, "");
    expect(body.messages[0].content).toBe("hi");
  });

  it("does nothing when prompt is undefined", () => {
    const body = { messages: [{ role: "system", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, undefined);
    expect(body.messages[0].content).toBe("hi");
  });
});

// ─── OpenAI / OpenAI-shaped formats (messages[]) ─────────────────────

describe("injectSystemPrompt – OpenAI messages[]", () => {
  it("appends to existing system message (string content)", () => {
    const body = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(
      `You are a helpful assistant.${SEP}${PROMPT}`
    );
    expect(body.messages).toHaveLength(2);
  });

  it("creates a new system message when none exists", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.messages).toHaveLength(2);
  });

  it("appends to existing system message with array content (Responses-style)", () => {
    const body = {
      messages: [
        {
          role: "system",
          content: [{ type: "text", text: "Base instructions" }],
        },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[1]).toEqual({
      type: "input_text",
      text: PROMPT,
    });
  });

  it("handles developer role as system message", () => {
    const body = {
      messages: [{ role: "developer", content: "Dev instructions" }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body.messages[0].content).toBe(
      `Dev instructions${SEP}${PROMPT}`
    );
  });

  it("works with other OpenAI-shaped formats (cursor, kiro, ollama, codex)", () => {
    for (const fmt of [
      FORMATS.CURSOR,
      FORMATS.KIRO,
      FORMATS.OLLAMA,
      FORMATS.CODEX,
    ]) {
      const body = { messages: [{ role: "user", content: "hi" }] };
      injectSystemPrompt(body, fmt, PROMPT);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toBe(PROMPT);
    }
  });
});

// ─── OpenAI Responses API (instructions / input[]) ───────────────────

describe("injectSystemPrompt – OpenAI Responses", () => {
  it("appends to top-level instructions string", () => {
    const body = { instructions: "Be concise.", input: [] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);
    expect(body.instructions).toBe(`Be concise.${SEP}${PROMPT}`);
  });

  it("sets instructions when empty string", () => {
    const body = { instructions: "", input: [] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);
    expect(body.instructions).toBe(PROMPT);
  });

  it("falls through to input[] when no instructions field", () => {
    const body = {
      input: [
        { role: "user", content: "Hello" },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);
    expect(body.input[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.input).toHaveLength(2);
  });
});

// ─── Claude format (body.system) ─────────────────────────────────────

describe("injectSystemPrompt – Claude", () => {
  it("appends to string system prompt", () => {
    const body = { system: "You are Claude." };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(body.system).toBe(`You are Claude.${SEP}${PROMPT}`);
  });

  it("creates string system when none exists", () => {
    const body = { messages: [] };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(body.system).toBe(PROMPT);
  });

  it("pushes block to array system", () => {
    const body = {
      system: [{ type: "text", text: "Base system" }],
    };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(body.system).toHaveLength(2);
    expect(body.system[1]).toEqual({ type: "text", text: PROMPT });
  });

  it("inserts before the last cache_control block", () => {
    const body = {
      system: [
        { type: "text", text: "Cached prefix", cache_control: { type: "ephemeral" } },
      ],
    };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(body.system).toHaveLength(2);
    // Injected block should come before the cache_control block
    expect(body.system[0]).toEqual({ type: "text", text: PROMPT });
    expect(body.system[1]).toEqual({
      type: "text",
      text: "Cached prefix",
      cache_control: { type: "ephemeral" },
    });
  });

  it("handles empty string system", () => {
    const body = { system: "" };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(body.system).toBe(PROMPT);
  });
});

// ─── Gemini formats ──────────────────────────────────────────────────

describe("injectSystemPrompt – Gemini", () => {
  it("appends to system_instruction parts (snake_case)", () => {
    const body = {
      system_instruction: { parts: [{ text: "Base instruction" }] },
    };
    injectSystemPrompt(body, FORMATS.GEMINI, PROMPT);
    expect(body.system_instruction.parts).toHaveLength(2);
    expect(body.system_instruction.parts[1]).toEqual({ text: PROMPT });
  });

  it("appends to systemInstruction parts (camelCase)", () => {
    const body = {
      systemInstruction: { parts: [{ text: "Base instruction" }] },
    };
    injectSystemPrompt(body, FORMATS.GEMINI, PROMPT);
    expect(body.systemInstruction.parts).toHaveLength(2);
    expect(body.systemInstruction.parts[1]).toEqual({ text: PROMPT });
  });

  it("creates systemInstruction (camelCase default) when none exists", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.GEMINI, PROMPT);
    // Default is camelCase when neither snake nor camel key is present
    expect(body.systemInstruction).toEqual({ parts: [{ text: PROMPT }] });
  });

  it("works with GEMINI_CLI format", () => {
    const body = {};
    injectSystemPrompt(body, FORMATS.GEMINI_CLI, PROMPT);
    expect(body.systemInstruction).toEqual({ parts: [{ text: PROMPT }] });
  });

  it("works with VERTEX format", () => {
    const body = {};
    injectSystemPrompt(body, FORMATS.VERTEX, PROMPT);
    expect(body.systemInstruction).toEqual({ parts: [{ text: PROMPT }] });
  });
});

// ─── Antigravity (wraps Gemini shape in body.request) ────────────────

describe("injectSystemPrompt – Antigravity", () => {
  it("injects into body.request.systemInstruction", () => {
    const body = {
      request: {
        systemInstruction: { parts: [{ text: "Base" }] },
      },
    };
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, PROMPT);
    expect(body.request.systemInstruction.parts).toHaveLength(2);
    expect(body.request.systemInstruction.parts[1]).toEqual({
      text: PROMPT,
    });
  });

  it("creates body.request.systemInstruction when missing", () => {
    const body = { request: {} };
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, PROMPT);
    expect(body.request.systemInstruction).toEqual({
      parts: [{ text: PROMPT }],
    });
  });
});

// ─── injectCustomPrompt wrapper ──────────────────────────────────────

describe("injectCustomPrompt – pass-through wrapper", () => {
  it("produces identical result to injectSystemPrompt for OpenAI", () => {
    const bodyA = { messages: [{ role: "user", content: "hi" }] };
    const bodyB = { messages: [{ role: "user", content: "hi" }] };

    injectSystemPrompt(bodyA, FORMATS.OPENAI, PROMPT);
    injectCustomPrompt(bodyB, FORMATS.OPENAI, PROMPT);

    expect(bodyB).toEqual(bodyA);
  });

  it("produces identical result to injectSystemPrompt for Claude", () => {
    const bodyA = { system: "Base" };
    const bodyB = { system: "Base" };

    injectSystemPrompt(bodyA, FORMATS.CLAUDE, PROMPT);
    injectCustomPrompt(bodyB, FORMATS.CLAUDE, PROMPT);

    expect(bodyB).toEqual(bodyA);
  });

  it("produces identical result to injectSystemPrompt for Gemini", () => {
    const bodyA = { system_instruction: { parts: [{ text: "Base" }] } };
    const bodyB = { system_instruction: { parts: [{ text: "Base" }] } };

    injectSystemPrompt(bodyA, FORMATS.GEMINI, PROMPT);
    injectCustomPrompt(bodyB, FORMATS.GEMINI, PROMPT);

    expect(bodyB).toEqual(bodyA);
  });

  it("respects guard: no mutation when prompt is empty", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectCustomPrompt(body, FORMATS.OPENAI, "");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe("hi");
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────

describe("injectSystemPrompt – edge cases", () => {
  it("does not mutate unrelated body fields", () => {
    const body = {
      model: "gpt-4",
      temperature: 0.7,
      messages: [{ role: "user", content: "hello" }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(body.model).toBe("gpt-4");
    expect(body.temperature).toBe(0.7);
    // New system message is prepended at index 0, user shifts to index 1
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(PROMPT);
    expect(body.messages[1].content).toBe("hello");
  });

  it("handles multi-line prompt correctly", () => {
    const multiLine = "Line 1\nLine 2\nLine 3";
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, multiLine);
    expect(body.messages[0].content).toBe(multiLine);
  });

  it("OpenAI: system content as object gets replaced", () => {
    const body = {
      messages: [{ role: "system", content: { unexpected: true } }],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    // content was not string or array → replaced with prompt string
    expect(body.messages[0].content).toBe(PROMPT);
  });
});
