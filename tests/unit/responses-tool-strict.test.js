import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import {
  readToolStrict,
  chatStrictForResponses,
  chatStrictFrom,
  restoreToolStrict,
} from "../../open-sse/translator/concerns/toolStrict.js";

// Measured against the Codex Responses backend (gpt-6-sol) with a schema whose
// `id` property is optional:
//   strict omitted -> schema strict-normalized, model sends {"id":"", ...}
//   strict false   -> optional honored
//   strict null    -> optional honored (LangChain sends null)
//   strict true    -> 400 "required ... Missing 'id'"
// So an omitted Chat `strict` must reach Responses as `false`, and every
// declared value (including null) must survive executor tool rebuilds.

// Shape of OpenWiki's submit_page tool: new claims must be sent without `id`.
const SUBMIT_PAGE_PARAMS = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, statement: { type: "string" } },
        required: ["statement"],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const DECLARED = [
  ["false", false],
  ["null", null],
  ["true", true],
];

const chatTool = (strictProps = {}) => ({
  type: "function",
  function: { name: "submit_page", description: "submit", parameters: SUBMIT_PAGE_PARAMS, ...strictProps },
});

const flatTool = (strictProps = {}) => ({
  type: "function",
  name: "submit_page",
  description: "submit",
  parameters: SUBMIT_PAGE_PARAMS,
  ...strictProps,
});

const responsesInput = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];

// Each Responses executor rebuilds tool declarations; the strict flag must survive.
const EXECUTORS = [
  ["codex", () => new CodexExecutor(), "gpt-5.5", { connectionId: "t-codex", providerSpecificData: {} }],
  ["codex (Responses Lite)", () => new CodexExecutor(), "gpt-6-sol", { connectionId: "t-codex-lite", providerSpecificData: {} }],
  ["opencode-go", () => new OpenCodeGoExecutor(), "muse-spark-1.3-contributor", {}],
  ["opencode-zen", () => new OpenCodeZenExecutor(), "muse-spark-1.3", {}],
  ["grok-cli", () => new GrokCliExecutor(), "grok-4.5-high", { connectionId: "t-grok" }],
];

function runExecutor([, make, model, credentials], tools) {
  const body = { model, input: structuredClone(responsesInput), tools: structuredClone(tools), stream: true };
  const out = make().transformRequest(model, body, true, credentials) || body;
  // GPT-6 Codex models use Responses Lite, which moves tools into an input prefix item.
  const liteTools = out.input?.find((item) => item?.type === "additional_tools")?.tools;
  return (out.tools || liteTools).find((t) => t.name === "submit_page");
}

describe("toolStrict helpers", () => {
  it("reads strict from flat and nested tools, ignoring undeclared or invalid values", () => {
    expect(readToolStrict(flatTool())).toBeUndefined();
    expect(readToolStrict(chatTool())).toBeUndefined();
    expect(readToolStrict(flatTool({ strict: "yes" }))).toBeUndefined();
    for (const [, value] of DECLARED) {
      expect(readToolStrict(flatTool({ strict: value }))).toBe(value);
      expect(readToolStrict(chatTool({ strict: value }))).toBe(value);
    }
  });

  it("maps Chat strict to Responses: omitted/null -> false, booleans kept", () => {
    expect(chatStrictForResponses({})).toBe(false);
    expect(chatStrictForResponses({ strict: null })).toBe(false);
    expect(chatStrictForResponses({ strict: false })).toBe(false);
    expect(chatStrictForResponses({ strict: true })).toBe(true);
  });

  it("carries only boolean strict into Chat", () => {
    expect(chatStrictFrom({})).toEqual({});
    expect(chatStrictFrom({ strict: null })).toEqual({});
    expect(chatStrictFrom({ strict: false })).toEqual({ strict: false });
    expect(chatStrictFrom({ strict: true })).toEqual({ strict: true });
  });

  it("restores only declared values", () => {
    expect(restoreToolStrict({}, undefined)).not.toHaveProperty("strict");
    expect(restoreToolStrict({}, null)).toEqual({ strict: null });
  });
});

describe("Chat Completions -> Responses keeps optional tool fields optional", () => {
  it("sends strict:false when the Chat client omitted strict (OpenWiki submit_page)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-6-sol",
      { model: "gpt-6-sol", messages: [{ role: "user", content: "hi" }], tools: [chatTool()] });
    expect(out.tools[0]).toMatchObject({ name: "submit_page", strict: false });
  });

  it.each([["null", null, false], ["false", false, false], ["true", true, true]])(
    "maps Chat strict=%s to Responses strict=%s",
    (_, value, expected) => {
      const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-6-sol",
        { model: "gpt-6-sol", messages: [{ role: "user", content: "hi" }], tools: [chatTool({ strict: value })] });
      expect(out.tools[0].strict).toBe(expected);
    },
  );

  it.each(EXECUTORS)("%s: Chat client end to end reaches upstream with strict:false", (...exec) => {
    const translated = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, exec[2],
      { model: exec[2], messages: [{ role: "user", content: "hi" }], tools: [chatTool()] });
    expect(runExecutor(exec, translated.tools)).toMatchObject({ name: "submit_page", strict: false });
  });
});

describe("Claude -> Responses", () => {
  const claudeBody = (tool) => ({
    model: "gpt-6-sol",
    max_tokens: 100,
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "submit_page", description: "submit", input_schema: SUBMIT_PAGE_PARAMS, ...tool }],
  });

  it("omitted Claude strict reaches Responses as false", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "gpt-6-sol", claudeBody({}));
    expect(out.tools[0].strict).toBe(false);
  });

  it("explicit Claude strict:true is carried through", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "gpt-6-sol", claudeBody({ strict: true }));
    expect(out.tools[0].strict).toBe(true);
  });
});

describe("Responses -> Chat Completions", () => {
  const toChat = (tool) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-x",
    { model: "gpt-x", input: structuredClone(responsesInput), tools: [tool] }).tools[0].function;

  it("does not leak strict:null or an undeclared strict into Chat", () => {
    expect(toChat(flatTool({ strict: null }))).not.toHaveProperty("strict");
    expect(toChat(flatTool())).not.toHaveProperty("strict");
  });

  it.each([[false], [true]])("keeps boolean strict=%s", (value) => {
    expect(toChat(flatTool({ strict: value })).strict).toBe(value);
  });
});

describe.each(EXECUTORS)("%s executor tool rebuild", (...exec) => {
  it("leaves strict absent for native Responses clients that omitted it", () => {
    expect(runExecutor(exec, [flatTool()])).not.toHaveProperty("strict");
  });

  it.each(DECLARED)("preserves declared strict=%s on flat Responses tools", (_, value) => {
    expect(runExecutor(exec, [flatTool({ strict: value })]).strict).toBe(value);
  });

  it.each(DECLARED)("preserves declared strict=%s on nested Chat-shaped tools", (_, value) => {
    const tool = runExecutor(exec, [chatTool({ strict: value })]);
    expect(tool.strict).toBe(value);
    expect(tool.function).toBeUndefined();
  });
});
