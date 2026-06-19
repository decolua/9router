import { describe, it, expect } from "vitest";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("injectPonytail (OpenAI chat)", () => {
  it("appends system message at level=lite", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, "lite");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[0].content).toContain("Tail-focus");
  });

  it("appends to existing system at level=full", () => {
    const body = {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
      ],
    };
    injectPonytail(body, FORMATS.OPENAI, "full");
    expect(body.messages[0].content).toMatch(/^You are helpful\.\n\n.*Output only/i);
  });
});

describe("injectPonytail (Claude)", () => {
  it("appends to body.system string", () => {
    const body = { system: "Base prompt", messages: [] };
    injectPonytail(body, FORMATS.CLAUDE, "lite");
    expect(body.system).toMatch(/Base prompt\s\sTail-focus/s);
  });

  it("appends to body.system array", () => {
    const body = { system: [{ type: "text", text: "Base prompt" }], messages: [] };
    injectPonytail(body, FORMATS.CLAUDE, "full");
    expect(body.system).toHaveLength(2);
    expect(body.system[1].text).toContain("Output only");
  });
});

describe("injectPonytail (Gemini)", () => {
  it("appends to body.system_instruction.parts", () => {
    const body = { system_instruction: { parts: [{ text: "Base" }] }, contents: [] };
    injectPonytail(body, FORMATS.GEMINI, "lite");
    expect(body.system_instruction.parts).toHaveLength(2);
    expect(body.system_instruction.parts[1].text).toContain("Tail-focus");
  });
});

describe("injectPonytail no-op guards", () => {
  it("no body → noop", () => {
    expect(() => injectPonytail(null, FORMATS.OPENAI, "lite")).not.toThrow();
  });

  it("unknown level → noop (no matching prompt)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, "ultra");
    expect(body.messages).toHaveLength(1);
  });
});

describe("caveman + ponytail compose", () => {
  it("both inject into the same system message", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, FORMATS.OPENAI, "lite");
    injectPonytail(body, FORMATS.OPENAI, "lite");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Tail-focus"); // ponytail
    expect(body.messages[0].content).toContain("Respond tersely"); // caveman lite
  });
});
