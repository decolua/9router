import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalizeKiroConversation,
  normalizeKiroToolSpecs,
  validateKiroConversation,
} from "../../open-sse/translator/concerns/kiroConversation.js";
import { clearKiroSessionReplayStore } from "../../open-sse/utils/kiroSessionReplay.js";
import { clearSessionStore } from "../../open-sse/utils/sessionManager.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const modelId = "claude-opus-5";

function tool(name, schema = { type: "object", properties: {} }) {
  return { name, description: `Tool ${name}`, input_schema: schema };
}

function specState(names = ["first", "second"]) {
  const source = names.map((name) => tool(name));
  return normalizeKiroToolSpecs(source);
}

function user(content, toolResults = []) {
  return {
    userInputMessage: {
      content,
      modelId,
      ...(toolResults.length > 0 && { userInputMessageContext: { toolResults } }),
    },
  };
}

function assistant(content, toolUses = []) {
  return {
    assistantResponseMessage: {
      content,
      ...(toolUses.length > 0 && { toolUses }),
    },
  };
}

function result(toolUseId, value, status = "success") {
  return { toolUseId, status, content: [{ text: value }] };
}

describe("Kiro conversation canonicalizer", () => {
  beforeEach(() => {
    clearKiroSessionReplayStore();
    clearSessionStore();
  });

  it("keeps complete parallel tool pairs structured", () => {
    const { specs, nameMap } = specState();
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [
          { toolUseId: "t1", name: "first", input: { n: 1 } },
          { toolUseId: "t2", name: "second", input: { n: 2 } },
        ]),
      ],
      currentMessage: user("continue", [result("t1", "one"), result("t2", "two")]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    const calls = canonical.history[1].assistantResponseMessage.toolUses;
    const results = canonical.currentMessage.userInputMessage.userInputMessageContext.toolResults;
    expect(calls.map((call) => call.toolUseId)).toEqual(["t1", "t2"]);
    expect(results.map((item) => item.toolUseId)).toEqual(["t1", "t2"]);
    expect(canonical.valid).toBe(true);
  });

  it("keeps the answered parallel call and flattens only the missing one", () => {
    const { specs, nameMap } = specState();
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [
          { toolUseId: "t1", name: "first", input: {} },
          { toolUseId: "t2", name: "second", input: {} },
        ]),
      ],
      currentMessage: user("continue", [result("t1", "one")]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    const assistantMessage = canonical.history[1].assistantResponseMessage;
    expect(assistantMessage.toolUses).toHaveLength(1);
    expect(assistantMessage.toolUses[0].toolUseId).toBe("t1");
    expect(assistantMessage.content).toContain("[Tool call: second(");
    expect(canonical.repairs.missingResults).toBe(1);
    expect(canonical.valid).toBe(true);
  });

  it("flattens non-adjacent and orphaned tool results", () => {
    const { specs, nameMap } = specState(["first"]);
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [{ toolUseId: "t1", name: "first", input: {} }]),
        user("result missing here"),
        assistant("later"),
      ],
      currentMessage: user("late result", [result("t1", "too late")]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    expect(JSON.stringify(canonical)).not.toContain('"toolUseId":"t1"');
    expect(canonical.history[1].assistantResponseMessage.content).toContain("[Tool call:");
    expect(canonical.currentMessage.userInputMessage.content).toContain("too late");
    expect(canonical.valid).toBe(true);
  });

  it("remaps duplicate tool IDs together with their adjacent results", () => {
    const { specs, nameMap } = specState();
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [
          { toolUseId: "duplicate", name: "first", input: {} },
          { toolUseId: "duplicate", name: "second", input: {} },
        ]),
      ],
      currentMessage: user("continue", [
        result("duplicate", "one"),
        result("duplicate", "two"),
      ]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    const calls = canonical.history[1].assistantResponseMessage.toolUses;
    const results = canonical.currentMessage.userInputMessage.userInputMessageContext.toolResults;
    expect(new Set(calls.map((call) => call.toolUseId)).size).toBe(2);
    expect(results.map((item) => item.toolUseId)).toEqual(calls.map((call) => call.toolUseId));
    expect(canonical.valid).toBe(true);
  });

  it("deduplicates extra results without losing their text", () => {
    const { specs, nameMap } = specState(["first"]);
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [{ toolUseId: "t1", name: "first", input: {} }]),
      ],
      currentMessage: user("continue", [result("t1", "one"), result("t1", "duplicate")]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    const current = canonical.currentMessage.userInputMessage;
    expect(current.userInputMessageContext.toolResults).toHaveLength(1);
    expect(current.content).toContain("duplicate");
    expect(canonical.valid).toBe(true);
  });

  it("flattens a trailing unanswered assistant tool call and creates a current user turn", () => {
    const { specs, nameMap } = specState(["first"]);
    const canonical = canonicalizeKiroConversation({
      history: [user("start")],
      currentMessage: assistant("run", [{ toolUseId: "t1", name: "first", input: {} }]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    expect(canonical.currentMessage.userInputMessage.content).toBe("continue");
    expect(canonical.history[1].assistantResponseMessage.toolUses).toBeUndefined();
    expect(canonical.history[1].assistantResponseMessage.content).toContain("[Tool call:");
    expect(canonical.valid).toBe(true);
  });

  it("flattens malformed input and tool uses missing from the current specs", () => {
    const { specs, nameMap } = specState(["first"]);
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [
          { toolUseId: "t1", name: "first", input: "{bad json" },
          { toolUseId: "t2", name: "removed_tool", input: {} },
        ]),
      ],
      currentMessage: user("continue", [result("t1", "one"), result("t2", "two")]),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    expect(canonical.history[1].assistantResponseMessage.toolUses).toBeUndefined();
    expect(canonical.currentMessage.userInputMessage.userInputMessageContext.toolResults).toBeUndefined();
    expect(canonical.currentMessage.userInputMessage.content).toContain("one");
    expect(canonical.currentMessage.userInputMessage.content).toContain("two");
    expect(canonical.valid).toBe(true);
  });

  it("repairs a 30-call parallel turn with one missing result", () => {
    const names = Array.from({ length: 30 }, (_, index) => `tool_${index}`);
    const { specs, nameMap } = specState(names);
    const calls = names.map((name, index) => ({
      toolUseId: `t${index}`,
      name,
      input: { index },
    }));
    const results = names.slice(0, -1).map((_, index) => result(`t${index}`, `r${index}`));
    const canonical = canonicalizeKiroConversation({
      history: [user("start"), assistant("run", calls)],
      currentMessage: user("continue", results),
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    expect(canonical.history[1].assistantResponseMessage.toolUses).toHaveLength(29);
    expect(canonical.currentMessage.userInputMessage.userInputMessageContext.toolResults).toHaveLength(29);
    expect(canonical.repairs.missingResults).toBe(1);
    expect(canonical.valid).toBe(true);
  });

  it("flattens structured history when the client sent no tool specs", () => {
    const canonical = canonicalizeKiroConversation({
      history: [
        user("start"),
        assistant("run", [{ toolUseId: "t1", name: "first", input: {} }]),
      ],
      currentMessage: user("continue", [result("t1", "one")]),
      modelId,
    });

    expect(JSON.stringify(canonical)).not.toContain("toolUses");
    expect(JSON.stringify(canonical)).not.toContain("toolResults");
    expect(canonical.history[1].assistantResponseMessage.content).toContain("[Tool call:");
    expect(canonical.currentMessage.userInputMessage.content).toContain("[Tool result:");
  });

  it("normalizes names and recursively removes unsupported schema fields", () => {
    const longDescription = "x".repeat(11000);
    const { specs, nameMap } = normalizeKiroToolSpecs([{
      name: "bad tool/name",
      description: longDescription,
      input_schema: {
        additionalProperties: false,
        properties: {
          nested: {
            type: "object",
            additionalProperties: true,
            properties: {},
            required: [],
          },
        },
        required: [],
      },
    }]);

    const specification = specs[0].toolSpecification;
    expect(nameMap.get("bad tool/name")).toBe("bad_tool_name");
    expect(specification.name.length).toBeLessThanOrEqual(64);
    expect(specification.description.length).toBe(10237);
    expect(JSON.stringify(specification.inputSchema.json)).not.toContain("additionalProperties");
    expect(JSON.stringify(specification.inputSchema.json)).not.toContain('"required":[]');
  });

  it("flattens top-level schema combinators rejected by Kiro", () => {
    const { specs } = normalizeKiroToolSpecs([tool("dynamic_tool", {
      oneOf: [
        {
          type: "object",
          properties: {
            path: { type: "string" },
            patch: { type: "string" },
          },
          required: ["path"],
        },
        {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "integer" },
          },
          required: ["path", "line"],
        },
      ],
    })]);

    expect(specs[0].toolSpecification.inputSchema.json).toEqual({
      type: "object",
      properties: {
        path: { type: "string" },
        patch: { type: "string" },
        line: { type: "integer" },
      },
      required: ["path"],
    });
  });

  it("removes unsupported schema keywords at every nesting level", () => {
    const { specs } = normalizeKiroToolSpecs([tool("dynamic_tool", {
      type: "object",
      $defs: { Filter: { type: "string" } },
      properties: {
        filter: {
          description: "kept",
          anyOf: [{ type: "string" }, { type: "null" }],
          $ref: "#/$defs/Filter",
        },
        nested: {
          type: "object",
          properties: {
            value: {
              type: "string",
              if: { const: "x" },
              then: { minLength: 1 },
              else: { maxLength: 10 },
            },
          },
        },
      },
    })]);

    const schema = specs[0].toolSpecification.inputSchema.json;
    expect(schema.properties.filter.description).toBe("kept");
    expect(JSON.stringify(schema)).not.toMatch(
      /\"(?:anyOf|oneOf|allOf|not|\$schema|\$id|\$ref|\$defs|definitions|if|then|else|unevaluatedProperties|unevaluatedItems|contentEncoding|contentMediaType)\"/
    );
  });

  it("preserves property names that equal unsupported schema keywords", () => {
    const { specs } = normalizeKiroToolSpecs([tool("conditional_names", {
      type: "object",
      properties: {
        if: { type: "string", description: "condition name" },
        then: {
          type: "object",
          properties: { additionalProperties: { type: "boolean" } },
        },
      },
      required: ["if", "then"],
    })]);

    expect(specs[0].toolSpecification.inputSchema.json).toEqual({
      type: "object",
      properties: {
        if: { type: "string", description: "condition name" },
        then: {
          type: "object",
          properties: { additionalProperties: { type: "boolean" } },
        },
      },
      required: ["if", "then"],
    });
  });

  it("does not mutate the source conversation or tool definitions", () => {
    const sourceTools = [tool("first")];
    const sourceHistory = [
      user("start"),
      assistant("run", [{ toolUseId: "t1", name: "first", input: {} }]),
    ];
    const sourceCurrent = user("continue", [result("t1", "one")]);
    const before = JSON.stringify({ sourceTools, sourceHistory, sourceCurrent });
    const { specs, nameMap } = normalizeKiroToolSpecs(sourceTools);

    canonicalizeKiroConversation({
      history: sourceHistory,
      currentMessage: sourceCurrent,
      modelId,
      toolSpecs: specs,
      nameMap,
    });

    expect(JSON.stringify({ sourceTools, sourceHistory, sourceCurrent })).toBe(before);
  });

  it("preserves Claude tool_result errors", () => {
    const output = claudeToKiroRequest(modelId, {
      tools: [tool("first")],
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "first", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "failed" }] },
      ],
    }, true, {});

    const item = output.conversationState.currentMessage.userInputMessage
      .userInputMessageContext.toolResults[0];
    expect(item.status).toBe("error");
  });

  it("repairs partial parallel results in both direct translators", () => {
    const claude = claudeToKiroRequest(modelId, {
      tools: [tool("first"), tool("second")],
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: [
          { type: "tool_use", id: "t1", name: "first", input: {} },
          { type: "tool_use", id: "t2", name: "second", input: {} },
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "one" }] },
      ],
    }, true, {});
    const openai = openaiToKiroRequest(modelId, {
      tools: [
        { type: "function", function: { name: "first", parameters: { type: "object", properties: {} } } },
        { type: "function", function: { name: "second", parameters: { type: "object", properties: {} } } },
      ],
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: "", tool_calls: [
          { id: "t1", type: "function", function: { name: "first", arguments: "{}" } },
          { id: "t2", type: "function", function: { name: "second", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "t1", content: "one" },
      ],
    }, true, {});

    for (const payload of [claude, openai]) {
      const state = payload.conversationState;
      const validation = validateKiroConversation(
        state.history,
        state.currentMessage,
        state.currentMessage.userInputMessage.userInputMessageContext.tools
      );
      expect(validation.valid).toBe(true);
      expect(state.history[1].assistantResponseMessage.toolUses).toHaveLength(1);
    }
  });

  it("does not let session replay replace a tool-result turn", () => {
    const credentials = {
      rawHeaders: { "x-session-id": "kiro-replay-tool-result-regression" },
      connectionId: "kiro-account",
    };
    claudeToKiroRequest(modelId, {
      messages: [{ role: "user", content: "frozen session start" }],
    }, true, credentials);

    const output = claudeToKiroRequest(modelId, {
      tools: [tool("first")],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "first", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "kept" }] },
      ],
    }, true, credentials);
    const state = output.conversationState;
    const allText = JSON.stringify(state);

    expect(allText).toContain("frozen session start");
    expect(allText).toContain("kept");
    expect(validateKiroConversation(
      state.history,
      state.currentMessage,
      state.currentMessage.userInputMessage.userInputMessageContext.tools
    ).valid).toBe(true);
  });
});
