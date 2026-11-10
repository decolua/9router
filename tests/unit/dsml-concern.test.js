import { describe, it, expect } from "vitest";
import { normalizeDsmlChunks, isDeepSeekFamilyModel } from "../../open-sse/translator/concerns/dsml.js";

const DSML =
  `< | DSML | calls>< | DSML | invoke name="pwsh">` +
  `< | DSML | parameter name="command" string="true">git --version< / | DSML | parameter>` +
  `< / | DSML | invoke>< / | DSML | calls>`;

const chunk = (content, extra = {}) => ({
  id: "c1",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta: { content, ...extra }, finish_reason: null }],
});

describe("isDeepSeekFamilyModel", () => {
  it("matches every provider spelling of the family", () => {
    for (const m of ["deepseek/deepseek-v4.1-flash", "deepseek-v4.1-flash", "dfmodel", "dmodel", "qoder/dfmodel"]) {
      expect(isDeepSeekFamilyModel(m)).toBe(true);
    }
  });

  it("does not match unrelated models", () => {
    for (const m of ["claude-opus-5-5", "gpt-6.1-sol", "glm-5.3", "kimi-k3", null, undefined]) {
      expect(isDeepSeekFamilyModel(m)).toBe(false);
    }
  });
});

describe("normalizeDsmlChunks", () => {
  it("converts a DSML text chunk into a native tool_call", () => {
    const state = { model: "deepseek/deepseek-v4.1-flash", chunkIndex: 1 };
    const out = normalizeDsmlChunks([chunk(DSML)], state);
    const calls = out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("pwsh");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ command: "git --version" });
    expect(calls[0].id).toBeTruthy();
    expect(calls[0].type).toBe("function");
  });

  it("leaves DSML-free text from non-DeepSeek models untouched", () => {
    const state = { model: "claude-opus-5-5" };
    const input = [chunk("plain answer")];
    expect(normalizeDsmlChunks(input, state)).toBe(input);
    expect(state.dsmlStream).toBeUndefined();
  });

  it("parses DSML even when the model id is a combo alias", () => {
    const state = { model: "opus55-sol61", chunkIndex: 1 };
    const out = normalizeDsmlChunks([chunk(DSML)], state);
    const calls = out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("pwsh");
  });

  it("rewrites finish_reason stop to tool_calls after extracting a call", () => {
    const state = { model: "opus55-sol61", chunkIndex: 1 };
    const out = [
      ...normalizeDsmlChunks([chunk(DSML)], state),
      ...normalizeDsmlChunks([{ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }], state),
    ];
    expect(out.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("parses a combo-alias stream whose opener is split before DSML", () => {
    const state = { model: "opus55-sol61", chunkIndex: 1 };
    const cut = DSML.indexOf("|");
    const out = [
      ...normalizeDsmlChunks([chunk("Run: " + DSML.slice(0, cut))], state),
      ...normalizeDsmlChunks([chunk(DSML.slice(cut))], state),
    ];
    const calls = out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(1);
    const text = out.map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(text).not.toContain("DSML");
    expect(text).not.toContain("<");
  });

  it("accepts single full-width pipe delimiters", () => {
    const state = { model: "combo-x", chunkIndex: 1 };
    const fw = `<｜DSML｜invoke name="pwsh"><｜DSML｜parameter name="command" string="true">ls</｜DSML｜parameter></｜DSML｜invoke>`;
    const calls = normalizeDsmlChunks([chunk(fw)], state).flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(1);
  });

  it("passes ordinary DeepSeek text through unchanged", () => {
    const state = { model: "deepseek-v4.1-flash" };
    const out = normalizeDsmlChunks([chunk("plain answer")], state);
    expect(out.map((c) => c.choices[0].delta.content).join("")).toBe("plain answer");
    expect(out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || [])).toEqual([]);
  });

  it("reassembles a block split across chunks", () => {
    const state = { model: "dfmodel", chunkIndex: 1 };
    const pieces = DSML.match(/[\s\S]{1,7}/g);
    const out = [];
    for (const p of pieces) out.push(...normalizeDsmlChunks([chunk(p)], state));
    const calls = out.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("pwsh");
    const leaked = out.map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(leaked).not.toContain("DSML");
  });

  it("keeps prose that precedes the tool block", () => {
    const state = { model: "deepseek-v4.1-flash", chunkIndex: 1 };
    const out = normalizeDsmlChunks([chunk("Running it now. " + DSML)], state);
    const text = out.map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(text).toContain("Running it now.");
    expect(text).not.toContain("DSML");
  });

  it("passes through chunks carrying native tool_calls", () => {
    const state = { model: "deepseek-v4.1-flash" };
    const native = {
      id: "c1",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "x", type: "function", function: { name: "a", arguments: "{}" } }] } }],
    };
    const out = normalizeDsmlChunks([native], state);
    expect(out).toEqual([native]);
  });

  it("tolerates missing state and empty input", () => {
    expect(normalizeDsmlChunks([chunk(DSML)], null)).toEqual([chunk(DSML)]);
    expect(normalizeDsmlChunks([], { model: "dfmodel" })).toEqual([]);
  });

  it("releases a held tail when a terminal chunk arrives", () => {
    const state = { model: "dfmodel", chunkIndex: 1 };
    const first = normalizeDsmlChunks([chunk("answer with a trailing <")], state);
    const terminal = { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    const second = normalizeDsmlChunks([terminal], state);
    const text = [...first, ...second].map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(text).toBe("answer with a trailing <");
    expect(second[second.length - 1].choices[0].finish_reason).toBe("stop");
  });

  it("flushes when content and finish_reason share one chunk", () => {
    const state = { model: "dfmodel", chunkIndex: 1 };
    const combined = { id: "c1", choices: [{ index: 0, delta: { content: "done <" }, finish_reason: "stop" }] };
    const out = normalizeDsmlChunks([combined], state);
    const text = out.map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(text).toBe("done <");
    expect(out[out.length - 1].choices[0].finish_reason).toBe("stop");
  });

  it("emits a tool call held open until the terminal chunk", () => {
    const state = { model: "dfmodel", chunkIndex: 1 };
    const open = `< | DSML | calls>< | DSML | invoke name="pwsh">< | DSML | parameter name="command" string="true">ls< / | DSML | parameter>`;
    normalizeDsmlChunks([chunk(open)], state);
    const terminal = { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    const out = normalizeDsmlChunks([terminal], state);
    const text = out.map((c) => c.choices?.[0]?.delta?.content || "").join("");
    expect(text).not.toContain("DSML");
  });
});
