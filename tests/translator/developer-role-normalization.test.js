// A `developer` message is OpenAI's spelling of a system turn. Only the OpenAI
// target normalized it (formats/openai.js filterToOpenAIFormat); every other
// target silently dropped the turn. Normalization now runs once in
// translateRequest, before the per-target translators, for every non-OpenAI
// target — chat `messages` and Responses-API `input` items alike.
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";

const DEV_TEXT = "Always answer in French.";

const devBody = () => ({
  messages: [
    { role: ROLE.DEVELOPER, content: DEV_TEXT },
    { role: ROLE.USER, content: "hi" },
  ],
});

const sysBody = () => ({
  messages: [
    { role: ROLE.SYSTEM, content: DEV_TEXT },
    { role: ROLE.USER, content: "hi" },
  ],
});

// anthropic-compatible provider so prepareClaudeRequest does not inject the
// Claude Code persona ahead of the client's own system text.
const T = (target, body) =>
  translateRequest(FORMATS.OPENAI, target, "m", body, true, null, "anthropic-compatible-x");

describe("developer role is normalized to system for non-OpenAI targets", () => {
  it("openai → claude keeps the developer text as the system prompt", () => {
    const out = T(FORMATS.CLAUDE, devBody());
    expect(out.system).toBeDefined();
    expect(JSON.stringify(out.system)).toContain(DEV_TEXT);
    expect(out.messages.every((m) => m.role !== ROLE.DEVELOPER)).toBe(true);
  });

  it("openai → gemini keeps the developer text in systemInstruction", () => {
    const out = T(FORMATS.GEMINI, devBody());
    expect(JSON.stringify(out.systemInstruction)).toContain(DEV_TEXT);
  });

  it("openai → kiro keeps the developer text in the translated request", () => {
    const out = T(FORMATS.KIRO, devBody());
    expect(JSON.stringify(out)).toContain(DEV_TEXT);
  });

  it("openai → cursor: developer takes the system path (mapped to a user turn)", () => {
    const dev = devBody();
    const out = T(FORMATS.CURSOR, dev);
    // openai-to-cursor maps a system turn to a user turn prefixed with
    // "[System Instructions]"; a developer turn must take that same path.
    expect(out).toEqual(T(FORMATS.CURSOR, sysBody()));
    expect(JSON.stringify(out)).toContain(DEV_TEXT);
    expect(dev.messages[0].role).toBe(ROLE.SYSTEM);
  });

  it("openai-responses input items with role developer reach claude as system", () => {
    const body = {
      input: [
        { role: ROLE.DEVELOPER, content: [{ type: "input_text", text: DEV_TEXT }] },
        { role: ROLE.USER, content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.CLAUDE,
      "m",
      body,
      true,
      null,
      "anthropic-compatible-x"
    );
    expect(JSON.stringify(out.system)).toContain(DEV_TEXT);
  });

  it("does not rename Responses additional_tools items that carry role developer", () => {
    const body = {
      input: [
        { type: "additional_tools", role: ROLE.DEVELOPER, tools: [] },
        { type: "message", role: ROLE.DEVELOPER, content: [{ type: "input_text", text: DEV_TEXT }] },
        { type: "message", role: ROLE.USER, content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.CLAUDE,
      "m",
      body,
      true,
      null,
      "anthropic-compatible-x"
    );
    expect(body.input[0].role, "additional_tools prefix must keep its shape").toBe(ROLE.DEVELOPER);
    expect(body.input[1].role).toBe(ROLE.SYSTEM);
  });

  // `developer` is the NATIVE role of the Responses API: Codex CLI sends its
  // sandbox/permissions message that way, and it must reach the upstream as-is.
  it.each([
    [FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES],
    [FORMATS.OPENAI_RESPONSES, FORMATS.CODEX],
    [FORMATS.CODEX, FORMATS.CODEX],
  ])("%s → %s leaves developer input items untouched", (source, target) => {
    const body = {
      input: [
        { type: "message", role: ROLE.DEVELOPER, content: [{ type: "input_text", text: DEV_TEXT }] },
        { type: "message", role: ROLE.USER, content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    const out = translateRequest(source, target, "gpt-5", body, true, null, "codex");
    // Without a body.model the codex pivot stops at chat `messages`; either shape
    // must still carry the developer turn unchanged.
    expect((out.input || out.messages).map((item) => item.role)).toEqual([ROLE.DEVELOPER, ROLE.USER]);
  });

  it("target OpenAI keeps its existing developer handling", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", devBody(), true, null, null);
    expect(out.messages[0].role).toBe(ROLE.SYSTEM);
  });
});
