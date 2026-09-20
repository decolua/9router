/**
 * Provider-injected prefix translation:
 * providers return tool-call names with prefixes (e.g. \`functions.exec\`, bare \`functions\`)
 * that were never declared in the request. The response translator must reverse-translate
 * by matching the suffix against the declared tool names, never by hardcoded alias.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const REQUEST_BODY = {
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "test" }] }],
  tools: [
    {
      type: "namespace",
      name: "collaboration",
      description: "collaboration tools",
      tools: [
        { type: "function", name: "spawn_agent", description: "spawn agent", parameters: { type: "object" } },
        { type: "function", name: "wait_agent", description: "wait agent", parameters: { type: "object" } },
      ],
    },
    { type: "function", name: "exec", description: "run bash", parameters: { type: "object" } },
  ],
};

describe("Provider prefix translation", () => {
  beforeEach(() => {
    globalThis.__CB_TOOL_MAP__ = null;
    globalThis.__CB_NS_TOOLS__ = null;
  });

  it("translates \`functions.exec\` (provider-injected prefix) -> declared \`exec\`", () => {
    const translated = openaiResponsesToOpenAIRequest("m", REQUEST_BODY, true, null);
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.body = REQUEST_BODY;
    const chunks = [
      { id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "functions.exec", arguments: "" } }] } }] },
      { id: "c1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"cmd":"ls"}' } }] } }] },
      { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");

    expect(added).toBeTruthy();
    expect(added.data.item.name).toBe("exec");
    expect(added.data.item.namespace).toBeNull();
  });

  it("translates \`collaboration\` (bare namespace name) -> warn + forward unchanged", () => {
    const warnSpy = [];
    const orig = console.warn;
    console.warn = (...args) => warnSpy.push(args);
    try {
      const translated = openaiResponsesToOpenAIRequest("m", REQUEST_BODY, true, null);
      const state = initState(FORMATS.OPENAI_RESPONSES);
      state.body = REQUEST_BODY;
      const chunks = [
        { id: "c2", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "collaboration", arguments: "{}" } }] } }] },
        { id: "c2", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ];
      const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
      const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");

      expect(added).toBeTruthy();
      expect(added.data.item.name).toBe("collaboration");
      expect(warnSpy.length).toBeGreaterThan(0);
      expect(warnSpy[0][0]).toContain("emitted bare namespace name");
    } finally {
      console.warn = orig;
    }
  });

  it("translates namespace-expanded tool call (collaboration.spawn_agent) -> split namespace", () => {
    const translated = openaiResponsesToOpenAIRequest("m", REQUEST_BODY, true, null);
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.body = REQUEST_BODY;
    const chunks = [
      { id: "c3", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_3", type: "function", function: { name: "collaboration__spawn_agent", arguments: "" } }] } }] },
      { id: "c3", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");

    expect(added).toBeTruthy();
    expect(added.data.item.name).toBe("spawn_agent");
    expect(added.data.item.namespace).toBe("collaboration");
  });

  it("passes through undeclared tool names with a warn", () => {
    const warnSpy = [];
    const orig = console.warn;
    console.warn = (...args) => warnSpy.push(args);
    try {
      const translated = openaiResponsesToOpenAIRequest("m", REQUEST_BODY, true, null);
      const state = initState(FORMATS.OPENAI_RESPONSES);
      state.body = REQUEST_BODY;
      const chunks = [
        { id: "c4", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_4", type: "function", function: { name: "unknown_tool", arguments: "{}" } }] } }] },
        { id: "c4", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ];
      const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
      const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");

      expect(added).toBeTruthy();
      expect(added.data.item.name).toBe("unknown_tool");
      expect(warnSpy.length).toBeGreaterThan(0);
      expect(warnSpy[0][0]).toContain("no declared tool name matches");
    } finally {
      console.warn = orig;
    }
  });

  it("exact-match passthrough still works", () => {
    const translated = openaiResponsesToOpenAIRequest("m", REQUEST_BODY, true, null);
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.body = REQUEST_BODY;
    const chunks = [
      { id: "c5", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_5", type: "function", function: { name: "exec", arguments: "" } }] } }] },
      { id: "c5", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");

    expect(added).toBeTruthy();
    expect(added.data.item.name).toBe("exec");
    expect(added.data.item.namespace).toBeNull();
  });

  it("no cross-request contamination", () => {
    const req1 = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "r1" }] }], tools: [{ type: "function", name: "exec", description: "", parameters: { type: "object" } }] };
    openaiResponsesToOpenAIRequest("m", req1, true, null);
    const s1 = initState(FORMATS.OPENAI_RESPONSES);
    s1.body = req1;
    const ch1 = [{ id: "r1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "r1c", type: "function", function: { name: "exec", arguments: "{}" } }] } }] }, { id: "r1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }];
    const ev1 = ch1.flatMap((c) => openaiToOpenAIResponsesResponse(c, s1));
    const a1 = ev1.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");
    expect(a1.data.item.name).toBe("exec");

    const req2 = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "r2" }] }], tools: [{ type: "function", name: "other", description: "", parameters: { type: "object" } }] };
    openaiResponsesToOpenAIRequest("m", req2, true, null);
    const s2 = initState(FORMATS.OPENAI_RESPONSES);
    s2.body = req2;

    const warnSpy = [];
    const orig = console.warn;
    console.warn = (...args) => warnSpy.push(args);
    try {
      const ch2 = [{ id: "r2", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "r2c", type: "function", function: { name: "exec", arguments: "{}" } }] } }] }, { id: "r2", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }];
      const ev2 = ch2.flatMap((c) => openaiToOpenAIResponsesResponse(c, s2));
      const a2 = ev2.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");
      expect(a2.data.item.name).toBe("exec");
      expect(warnSpy.length).toBeGreaterThan(0);
      expect(warnSpy[0][0]).toContain("no declared tool name matches");
    } finally {
      console.warn = orig;
    }
  });
});
