import { describe, it, expect } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM } from "../../open-sse/translator/schema/blocks.js";
import { ROLE } from "../../open-sse/translator/schema/roles.js";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";
import { PONYTAIL_PROMPTS } from "../../open-sse/rtk/ponytailPrompt.js";

const SEP = "\n\n";
const P1 = "CAVEMAN_TEST_PROMPT_AAA";
const P2 = "PONYTAIL_TEST_PROMPT_BBB";

describe("system-inject chat messages", () => {
  it("appends TEXT block to existing system string with SEP", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hello" }, { role: ROLE.USER, content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`hello${SEP}${P1}`);
  });

  it("appends TEXT block to existing system array with OPENAI_BLOCK.TEXT never input_text", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: [{ type: OPENAI_BLOCK.TEXT, text: "hello" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    const arr = body.messages[0].content;
    expect(arr[arr.length - 1]).toEqual({ type: OPENAI_BLOCK.TEXT, text: P1 });
    expect(arr.some(c => c.type === "input_text")).toBe(false);
  });

  it("unshifts system message when no system/developer present", () => {
    const body = { messages: [{ role: ROLE.USER, content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0]).toEqual({ role: ROLE.SYSTEM, content: P1 });
    expect(body.messages[1].role).toBe(ROLE.USER);
  });

  it("handles developer role as system", () => {
    const body = { messages: [{ role: ROLE.DEVELOPER, content: "dev" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`dev${SEP}${P1}`);
  });

  it("exact full-prompt idempotency for chat string", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hello" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`hello${SEP}${P1}`);
    // different prompt both apply
    injectSystemPrompt(body, FORMATS.OPENAI, P2);
    expect(body.messages[0].content).toBe(`hello${SEP}${P1}${SEP}${P2}`);
  });

  it("exact full-prompt idempotency for chat array", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: [{ type: OPENAI_BLOCK.TEXT, text: "hello" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    const texts = body.messages[0].content.filter(c => c.text === P1);
    expect(texts.length).toBe(1);
    injectSystemPrompt(body, FORMATS.OPENAI, P2);
    expect(body.messages[0].content.filter(c => c.text === P2).length).toBe(1);
  });

  it("never uses first-100 fingerprint: long prompt exact idempotency", () => {
    const longA = "X".repeat(150) + "_A";
    const longB = "X".repeat(150) + "_B";
    const body = { messages: [{ role: ROLE.SYSTEM, content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, longA);
    injectSystemPrompt(body, FORMATS.OPENAI, longB);
    expect(body.messages[0].content).toContain(longA);
    expect(body.messages[0].content).toContain(longB);
    // retry same longA is idempotent
    injectSystemPrompt(body, FORMATS.OPENAI, longA);
    const countA = body.messages[0].content.split(longA).length - 1;
    expect(countA).toBe(1);
  });
});

describe("system-inject responses input[]", () => {
  it("modifies only type: message system/developer and preserves non-message order", () => {
    const body = {
      input: [
        { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "c1", name: "fn" },
        { type: RESPONSES_ITEM.MESSAGE, role: ROLE.SYSTEM, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "sys" }] },
        { type: RESPONSES_ITEM.REASONING, summary: "x" },
        { type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "c1", output: "ok" },
      ],
    };
    const before = JSON.parse(JSON.stringify(body.input));
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    // length unchanged except injection inside message
    expect(body.input.length).toBe(before.length);
    expect(body.input[0]).toEqual(before[0]);
    expect(body.input[2]).toEqual(before[2]);
    expect(body.input[3]).toEqual(before[3]);
    // system message got INPUT_TEXT appended
    const sys = body.input[1];
    expect(sys.content[sys.content.length - 1]).toEqual({ type: RESPONSES_ITEM.INPUT_TEXT, text: P1 });
  });

  it("appends INPUT_TEXT to array content", () => {
    const body = { input: [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "hi" }] }, { type: RESPONSES_ITEM.MESSAGE, role: ROLE.SYSTEM, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    const sys = body.input.find(m => m.role === ROLE.SYSTEM);
    expect(sys.content[sys.content.length - 1].type).toBe(RESPONSES_ITEM.INPUT_TEXT);
    expect(sys.content[sys.content.length - 1].text).toBe(P1);
  });

  it("creates typed message at index 0 if absent preserving order", () => {
    const body = { input: [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "hi" }] }, { type: RESPONSES_ITEM.FUNCTION_CALL, call_id: "1", name: "a" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.input[0]).toEqual({ type: RESPONSES_ITEM.MESSAGE, role: ROLE.SYSTEM, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: P1 }] });
    expect(body.input[1].role).toBe(ROLE.USER);
  });

  it("instructions string takes precedence over input[]", () => {
    const body = { instructions: "instr", input: [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.instructions).toBe(`instr${SEP}${P1}`);
    expect(body.input.length).toBe(1);
    expect(body.input[0].content[0].text).toBe("hi");
  });

  it("does not coerce string input", () => {
    const body = { input: "hello string" };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.input).toBe("hello string");
    expect(body.instructions).toBeUndefined();
  });

  it("exact idempotency for responses input", () => {
    const body = { input: [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.SYSTEM, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    const sys = body.input[0];
    expect(sys.content.filter(c => c.text === P1).length).toBe(1);
    injectSystemPrompt(body, FORMATS.OPENAI, P2);
    expect(sys.content.filter(c => c.text === P2).length).toBe(1);
  });
});

describe("system-inject instructions", () => {
  it("appends to instructions string with idempotency", () => {
    const body = { instructions: "base" };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.instructions).toBe(`base${SEP}${P1}`);
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.instructions).toBe(`base${SEP}${P1}`);
    injectSystemPrompt(body, FORMATS.OPENAI, P2);
    expect(body.instructions).toBe(`base${SEP}${P1}${SEP}${P2}`);
  });

  it("creates instructions when empty", () => {
    const body = { instructions: "" };
    // empty string still taken as string field, should become prompt
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.instructions).toBe(P1);
  });
});

describe("system-inject dispatch by wire shape", () => {
  it("messages[] means Chat even when format is openai-responses label", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    // should still treat as Chat because messages present
    expect(body.messages[0].content).toBe(`hi${SEP}${P1}`);
  });
  it("input[] means Responses even when format is openai", () => {
    const body = { input: [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.input[0].role).toBe(ROLE.SYSTEM);
    expect(body.input[0].content[0].type).toBe(RESPONSES_ITEM.INPUT_TEXT);
  });
});

describe("system-inject claude", () => {
  it("string system appends with SEP and idempotent", () => {
    const body = { system: "base" };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(`base${SEP}${P1}`);
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(`base${SEP}${P1}`);
    injectSystemPrompt(body, FORMATS.CLAUDE, P2);
    expect(body.system).toBe(`base${SEP}${P1}${SEP}${P2}`);
  });

  it("array system uses CLAUDE_BLOCK.TEXT and inserts before last cache_control", () => {
    const body = { system: [{ type: CLAUDE_BLOCK.TEXT, text: "a" }, { type: CLAUDE_BLOCK.TEXT, text: "b", cache_control: { type: "ephemeral" } }, { type: CLAUDE_BLOCK.TEXT, text: "c", cache_control: { type: "ephemeral" } }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    // should be inserted before last cache_control (index 2)
    expect(body.system[2]).toEqual({ type: CLAUDE_BLOCK.TEXT, text: P1 });
    expect(body.system[3].text).toBe("c");
    expect(body.system[3].cache_control).toBeDefined();
  });

  it("array without cache_control appends", () => {
    const body = { system: [{ type: CLAUDE_BLOCK.TEXT, text: "a" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system[body.system.length - 1]).toEqual({ type: CLAUDE_BLOCK.TEXT, text: P1 });
  });

  it("exact idempotency for claude array", () => {
    const body = { system: [{ type: CLAUDE_BLOCK.TEXT, text: "a" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system.filter(b => b.text === P1).length).toBe(1);
  });

  it("creates system when absent", () => {
    const body = {};
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(P1);
  });

  it("real body with messages[] injects into system, never a system role turn", () => {
    const body = { system: "base", messages: [{ role: ROLE.USER, content: "hi" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(`base${SEP}${P1}`);
    expect(body.messages).toEqual([{ role: ROLE.USER, content: "hi" }]);
  });

  it("absent system with messages[] creates system field, not a system message", () => {
    const body = { messages: [{ role: ROLE.USER, content: "hi" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(P1);
    expect(body.messages.some(m => m.role === ROLE.SYSTEM)).toBe(false);
  });
});

describe("system-inject gemini", () => {
  it("preserves snake_case key", () => {
    const body = { system_instruction: { parts: [{ text: "base" }] } };
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    expect(body.system_instruction.parts.length).toBe(2);
    expect(body.system_instruction.parts[1].text).toBe(P1);
    expect(body.systemInstruction).toBeUndefined();
  });
  it("preserves camelCase key", () => {
    const body = { systemInstruction: { parts: [{ text: "base" }] } };
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    expect(body.systemInstruction.parts[1].text).toBe(P1);
    expect(body.system_instruction).toBeUndefined();
  });
  it("handles Antigravity wrapper request.systemInstruction", () => {
    const body = { request: { systemInstruction: { parts: [{ text: "base" }] } } };
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, P1);
    expect(body.request.systemInstruction.parts[1].text).toBe(P1);
  });
  it("exact idempotency for gemini", () => {
    const body = { systemInstruction: { parts: [{ text: "base" }] } };
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    expect(body.systemInstruction.parts.filter(p => p.text === P1).length).toBe(1);
    injectSystemPrompt(body, FORMATS.GEMINI, P2);
    expect(body.systemInstruction.parts.filter(p => p.text === P2).length).toBe(1);
  });
  it("creates when absent", () => {
    const body = {};
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    expect(body.systemInstruction.parts[0].text).toBe(P1);
  });
});

describe("system-inject kiro", () => {
  it("updates systemPrompt and mirrored prefix of first history user preserving tail", () => {
    const oldPrompt = "OLD_SYS";
    const timeCtx = "[Context: Current time is 2026-01-01T00:00:00.000Z]";
    const tail = "user tail content";
    const historyUserContent = `${oldPrompt}${SEP}${timeCtx}${SEP}${tail}`;
    const body = {
      systemPrompt: oldPrompt,
      conversationState: {
        history: [{ userInputMessage: { content: historyUserContent, modelId: "m" } }, { assistantResponseMessage: { content: "..." } }],
        currentMessage: { userInputMessage: { content: "current " + tail, modelId: "m" } },
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    const next = `${oldPrompt}${SEP}${P1}`;
    expect(body.systemPrompt).toBe(next);
    expect(body.conversationState.history[0].userInputMessage.content).toBe(`${next}${SEP}${timeCtx}${SEP}${tail}`);
    // currentMessage must stay untouched
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe("current " + tail);
  });

  it("when no history user, updates currentMessage instead", () => {
    const oldPrompt = "OLD";
    const body = {
      systemPrompt: oldPrompt,
      conversationState: {
        history: [],
        currentMessage: { userInputMessage: { content: `${oldPrompt}${SEP}tail`, modelId: "m" } },
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.systemPrompt).toBe(`${oldPrompt}${SEP}${P1}`);
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe(`${oldPrompt}${SEP}${P1}${SEP}tail`);
  });

  it("empty old prompt prepends to chosen user content", () => {
    const body = {
      systemPrompt: "",
      conversationState: {
        history: [{ userInputMessage: { content: "tail hello", modelId: "m" } }],
        currentMessage: { userInputMessage: { content: "cur", modelId: "m" } },
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.systemPrompt).toBe(P1);
    expect(body.conversationState.history[0].userInputMessage.content).toBe(`${P1}${SEP}tail hello`);
  });

  it("if old prompt not mirrored at head, do not alter user content", () => {
    const body = {
      systemPrompt: "OLD",
      conversationState: {
        history: [{ userInputMessage: { content: "different head content", modelId: "m" } }],
        currentMessage: { userInputMessage: { content: "cur", modelId: "m" } },
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.systemPrompt).toBe(`OLD${SEP}${P1}`);
    expect(body.conversationState.history[0].userInputMessage.content).toBe("different head content");
  });

  it("exact retry idempotency for kiro", () => {
    const oldPrompt = "OLD";
    const body = {
      systemPrompt: oldPrompt,
      conversationState: {
        history: [{ userInputMessage: { content: `${oldPrompt}${SEP}tail`, modelId: "m" } }],
        currentMessage: { userInputMessage: { content: "cur", modelId: "m" } },
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    const after1 = JSON.parse(JSON.stringify(body));
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.systemPrompt).toBe(after1.systemPrompt);
    expect(body.conversationState.history[0].userInputMessage.content).toBe(after1.conversationState.history[0].userInputMessage.content);
    // different prompt both apply
    injectSystemPrompt(body, FORMATS.KIRO, P2);
    expect(body.systemPrompt).toBe(`${oldPrompt}${SEP}${P1}${SEP}${P2}`);
  });

  it("preserves non-enumerable _kiroUpstreamModel", () => {
    const body = {
      systemPrompt: "OLD",
      conversationState: { history: [{ userInputMessage: { content: "OLD" + SEP + "tail", modelId: "m" } }], currentMessage: { userInputMessage: { content: "OLD" + SEP + "tail2", modelId: "m" } } },
    };
    Object.defineProperty(body, "_kiroUpstreamModel", { value: "m", enumerable: false });
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body._kiroUpstreamModel).toBe("m");
    expect(Object.getOwnPropertyDescriptor(body, "_kiroUpstreamModel").enumerable).toBe(false);
  });
});

describe("system-inject regression fixes", () => {
  it("kiro partial mutation converges on retry after transient content write failure", () => {
    const oldPrompt = "OLD";
    let failNextWrite = true;
    const um = { content: `${oldPrompt}${SEP}tail`, modelId: "m" };
    const proxiedUm = new Proxy(um, {
      set(t, p, v) {
        if (p === "content" && failNextWrite) { failNextWrite = false; throw new Error("transient"); }
        t[p] = v; return true;
      },
    });
    const body = {
      systemPrompt: oldPrompt,
      conversationState: {
        history: [{ userInputMessage: proxiedUm }],
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    // first pass rolled back atomically — nothing half-applied
    expect(body.systemPrompt).toBe(oldPrompt);
    expect(um.content).toBe(`${oldPrompt}${SEP}tail`);
    // retry converges
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.systemPrompt).toBe(`${oldPrompt}${SEP}${P1}`);
    expect(um.content).toBe(`${oldPrompt}${SEP}${P1}${SEP}tail`);
  });

  it("kiro rolls back systemPrompt when user content write fails (atomicity)", () => {
    const oldPrompt = "OLD";
    const body = {
      systemPrompt: oldPrompt,
      conversationState: {
        history: [{ userInputMessage: Object.freeze({ content: `${oldPrompt}${SEP}tail`, modelId: "m" }) }],
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.systemPrompt).toBe(oldPrompt);
  });

  it("kiro shape gate: stray conversationState without history/currentMessage does not hijack chat body", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hello" }], systemPrompt: "", conversationState: {} };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`hello${SEP}${P1}`);
  });

  it("substring occurrence does not suppress injection (exact SEP-delimited idempotency)", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "You are RULE follower" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, "RULE");
    expect(body.messages[0].content).toBe(`You are RULE follower${SEP}RULE`);
  });

  it("instructions substring occurrence does not suppress injection", () => {
    const body = { instructions: "You are RULE follower" };
    injectSystemPrompt(body, FORMATS.OPENAI, "RULE");
    expect(body.instructions).toBe(`You are RULE follower${SEP}RULE`);
  });

  it("kiro empty-old prepend fires when prompt appears mid-tail only", () => {
    const body = {
      systemPrompt: "",
      conversationState: {
        history: [{ userInputMessage: { content: `some ${P1} here`, modelId: "m" } }],
      },
    };
    injectSystemPrompt(body, FORMATS.KIRO, P1);
    expect(body.conversationState.history[0].userInputMessage.content).toBe(`${P1}${SEP}some ${P1} here`);
  });
});

describe("system-inject fail-open", () => {
  it("null/undefined bodies never throw", () => {
    expect(() => injectSystemPrompt(null, FORMATS.OPENAI, P1)).not.toThrow();
    expect(() => injectSystemPrompt(undefined, FORMATS.OPENAI, P1)).not.toThrow();
    expect(() => injectSystemPrompt({}, FORMATS.OPENAI, null)).not.toThrow();
  });

  it("malformed messages array never throws", () => {
    expect(() => injectSystemPrompt({ messages: null }, FORMATS.OPENAI, P1)).not.toThrow();
    expect(() => injectSystemPrompt({ messages: "bad" }, FORMATS.OPENAI, P1)).not.toThrow();
    expect(() => injectSystemPrompt({ messages: [{ role: null, content: null }] }, FORMATS.OPENAI, P1)).not.toThrow();
  });

  it("frozen body never throws and does not partially mutate", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hello" }] };
    Object.freeze(body);
    Object.freeze(body.messages);
    Object.freeze(body.messages[0]);
    expect(() => injectSystemPrompt(body, FORMATS.OPENAI, P1)).not.toThrow();
    expect(body.messages[0].content).toBe("hello");
  });

  it("Proxy throwing setter never throws", () => {
    const throwingMsg = new Proxy({ role: ROLE.SYSTEM, content: "hello" }, {
      set() { throw new Error("msg setter fail"); },
    });
    const arrProxy = new Proxy([throwingMsg], {
      get(t, p, r) { return Reflect.get(t, p, r); },
      set() { throw new Error("arr setter fail"); },
    });
    const proxy = new Proxy({}, {
      set(t, p, v) { if (p === "messages") throw new Error("setter fail"); return Reflect.set(t, p, v); },
      get(t, p) { if (p === "messages") return arrProxy; return t[p]; },
    });
    expect(() => injectSystemPrompt(proxy, FORMATS.OPENAI, P1)).not.toThrow();
    expect(() => injectSystemPrompt(proxy, FORMATS.OPENAI_RESPONSES, P1)).not.toThrow();
  });

  it("frozen claude never throws", () => {
    const body = { system: [{ type: CLAUDE_BLOCK.TEXT, text: "a" }] };
    Object.freeze(body.system);
    expect(() => injectSystemPrompt(body, FORMATS.CLAUDE, P1)).not.toThrow();
  });

  it("frozen gemini never throws", () => {
    const body = { systemInstruction: { parts: [{ text: "a" }] } };
    Object.freeze(body.systemInstruction.parts);
    expect(() => injectSystemPrompt(body, FORMATS.GEMINI, P1)).not.toThrow();
  });

  it("injectCaveman and injectPonytail fail open on frozen", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "hi" }] };
    Object.freeze(body);
    Object.freeze(body.messages);
    expect(() => injectCaveman(body, FORMATS.OPENAI, "full")).not.toThrow();
    expect(() => injectPonytail(body, FORMATS.OPENAI, "full")).not.toThrow();
  });

  it("different caveman and ponytail prompts both apply", () => {
    const body = { messages: [{ role: ROLE.SYSTEM, content: "base" }] };
    injectCaveman(body, FORMATS.OPENAI, "full");
    const afterCaveman = body.messages[0].content;
    expect(afterCaveman).toContain(CAVEMAN_PROMPTS.full.slice(0, 30));
    injectPonytail(body, FORMATS.OPENAI, "full");
    expect(body.messages[0].content).toContain(PONYTAIL_PROMPTS.full.slice(0, 30));
    expect(body.messages[0].content).toContain(afterCaveman);
  });
});
