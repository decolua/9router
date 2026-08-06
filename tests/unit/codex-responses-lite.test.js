import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { CODEX_RESPONSES_LITE_HEADER } from "../../open-sse/config/codexConstants.js";

function credentials(rawHeaders = {}) {
  return {
    accessToken: "upstream-token",
    connectionId: "codex-test",
    providerSpecificData: {},
    rawHeaders,
  };
}

describe("Codex Responses Lite compatibility", () => {
  it("forwards only an explicitly enabled Responses Lite header", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders(credentials({
      [CODEX_RESPONSES_LITE_HEADER]: "true",
      authorization: "Bearer client-token",
      cookie: "session=private",
      "x-api-key": "private",
    }));

    expect(headers[CODEX_RESPONSES_LITE_HEADER]).toBe("true");
    expect(headers.Authorization).toBe("Bearer upstream-token");
    expect(headers.cookie).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("does not infer Responses Lite from the model name", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders(credentials());

    expect(headers[CODEX_RESPONSES_LITE_HEADER]).toBeUndefined();
  });

  it("preserves Responses Lite input, namespace calls, and parallel tool settings", () => {
    const executor = new CodexExecutor();
    const additionalTools = {
      type: "additional_tools",
      role: "developer",
      tools: [{
        type: "namespace",
        name: "collaboration",
        description: "agent tools",
        tools: [{
          type: "function",
          name: "spawn_agent",
          description: "spawn",
          strict: false,
          parameters: { type: "object", properties: {} },
        }],
      }],
    };
    const developerMessage = {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Codex instructions" }],
    };
    const namespacedCall = {
      type: "function_call",
      name: "spawn_agent",
      namespace: "collaboration",
      arguments: "{}",
      call_id: "call-1",
    };
    const output = {
      type: "function_call_output",
      call_id: "call-1",
      output: "done",
    };
    const body = {
      model: "gpt-5.6-sol",
      input: [additionalTools, developerMessage, namespacedCall, output],
      parallel_tool_calls: false,
      stream: true,
      reasoning: { effort: "high", summary: "auto" },
    };

    executor.transformRequest("gpt-5.6-sol", body, true, credentials({
      [CODEX_RESPONSES_LITE_HEADER]: "true",
    }));

    expect(body.instructions).toBeUndefined();
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.input).toEqual([additionalTools, developerMessage, namespacedCall, output]);
  });

  it("normalizes legacy message content without changing non-message items", () => {
    const executor = new CodexExecutor();
    const functionCall = {
      type: "function_call",
      name: "run",
      arguments: "{}",
      call_id: "call-2",
    };
    const body = {
      model: "gpt-5.5",
      input: [{ role: "user", content: "hello" }, functionCall],
      stream: true,
    };

    executor.transformRequest("gpt-5.5", body, true, credentials());

    expect(body.input[0]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    });
    expect(body.input[1]).toEqual(functionCall);
    expect(body.instructions).toBeTypeOf("string");
  });

  it("keeps max on the Responses Lite wire contract", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.6-sol-max",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      stream: true,
    };

    executor.transformRequest("gpt-5.6-sol-max", body, true, credentials({
      [CODEX_RESPONSES_LITE_HEADER]: "true",
    }));

    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning).toEqual({ effort: "max", summary: "auto", context: "all_turns" });
  });
  it("detects namespace payloads without a client Lite header", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.6-sol",
      input: [{ type: "function_call", name: "run", namespace: "tools", arguments: "{}", call_id: "call-3" }],
      tools: [{ type: "namespace", name: "tools", tools: [] }],
      stream: true,
    };

    executor.transformRequest("gpt-5.6-sol", body, true, credentials());
    const headers = executor.buildHeaders(credentials());

    expect(headers[CODEX_RESPONSES_LITE_HEADER]).toBe("true");
    expect(body.reasoning.context).toBe("all_turns");
    expect(body.input.find((item) => item.namespace === "tools")).toBeDefined();
  });
});
