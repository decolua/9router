import { describe, it, expect, beforeEach } from "vitest";
import {
  GrokCliExecutor,
  countGrokCliUserTurns,
  resolveGrokCliTurnIdx,
  _resetGrokCliTurnStore,
  _getGrokCliTurnStoreSize,
  normalizeGrokCliEffort,
  supportsGrokCliReasoningEffort,
} from "../../open-sse/executors/grok-cli.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore, resolveProviderAlias } from "../../open-sse/services/model.js";
import { OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("grok-cli registry", () => {
  it("registers transport + oauth + models", () => {
    const cfg = PROVIDERS["grok-cli"];
    expect(cfg).toBeTruthy();
    expect(cfg.baseUrl).toBe("https://cli-chat-proxy.grok.com/v1/responses");
    expect(cfg.format).toBe("openai-responses");
    expect(cfg.forceStream).toBe(true);
    expect(cfg.tokenAuth).toBe("xai-grok-cli");

    const oauth = PROVIDER_OAUTH["grok-cli"];
    expect(oauth.clientId).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(oauth.deviceCodeUrl).toContain("auth.x.ai");
    expect(oauth.scope).toContain("grok-cli:access");
    expect(oauth.scope).toContain("conversations:write");
    expect(oauth.referrer).toBe("grok-build");

    expect(PROVIDER_MODELS.gcli?.some((m) => m.id === "grok-build")).toBe(true);
  });

  it("is listed as oauth provider for dashboard", () => {
    expect(OAUTH_PROVIDERS["grok-cli"]).toBeTruthy();
    expect(OAUTH_PROVIDERS["grok-cli"].name).toMatch(/Grok CLI/i);
  });

  it("resolves aliases to provider id", () => {
    expect(resolveProviderAlias("gcli")).toBe("grok-cli");
    expect(resolveProviderAlias("gb")).toBe("grok-cli");
    expect(resolveProviderAlias("grok-build")).toBe("grok-cli");
    expect(resolveProviderAlias("grok-cli")).toBe("grok-cli");
  });

  it("routes bare grok-build to the subscription provider", async () => {
    await expect(getModelInfoCore("grok-build", {})).resolves.toEqual({
      provider: "grok-cli",
      model: "grok-build",
    });
  });

  it("maps effort virtual models to upstream grok-4.5", () => {
    expect(getModelUpstreamId("gcli", "grok-4.5-high")).toBe("grok-4.5");
    expect(getModelUpstreamId("gcli", "grok-4.5-medium")).toBe("grok-4.5");
    expect(getModelUpstreamId("gcli", "grok-4.5-low")).toBe("grok-4.5");
    expect(getModelUpstreamId("gcli", "grok-4.5")).toBe("grok-4.5");
  });
});

describe("GrokCliExecutor", () => {
  let executor;

  beforeEach(() => {
    _resetGrokCliTurnStore();
    executor = new GrokCliExecutor();
  });

  it("is registered on executor map (id + aliases)", () => {
    expect(hasSpecializedExecutor("grok-cli")).toBe(true);
    expect(getExecutor("grok-cli")).toBeInstanceOf(GrokCliExecutor);
    expect(getExecutor("gcli")).toBeInstanceOf(GrokCliExecutor);
    expect(getExecutor("gb")).toBeInstanceOf(GrokCliExecutor);
  });

  it("buildUrl points at cli-chat-proxy responses", () => {
    expect(executor.buildUrl()).toBe("https://cli-chat-proxy.grok.com/v1/responses");
  });

  it("buildHeaders sets CLI fingerprint + session headers", () => {
    executor._currentSessionId = "sess-abc";
    executor._currentReqId = "req-xyz";
    executor._agentId = "agent-1";
    executor._currentModel = "grok-4.5";
    executor._currentTurnIdx = 3;

    const headers = executor.buildHeaders(
      {
        accessToken: "tok_test",
        providerSpecificData: { email: "u@example.com", userId: "uid-1" },
      },
      true
    );

    expect(headers.Authorization).toBe("Bearer tok_test");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["x-xai-token-auth"]).toBeUndefined();
    expect(headers["x-grok-client-identifier"]).toBe("grok-shell");
    expect(headers["x-grok-client-version"]).toBe("0.2.99");
    expect(headers["x-grok-session-id"]).toBe("sess-abc");
    expect(headers["x-grok-conv-id"]).toBe("sess-abc");
    expect(headers["x-grok-req-id"]).toBe("req-xyz");
    expect(headers["x-grok-turn-idx"]).toBe("3");
    expect(headers["x-grok-agent-id"]).toBe("agent-1");
    expect(headers["x-grok-model-override"]).toBe("grok-4.5");
    expect(headers["x-compaction-at"]).toBeUndefined();
    expect(headers["x-email"]).toBe("u@example.com");
    expect(headers["x-userid"]).toBe("uid-1");
    expect(headers["x-authenticateresponse"]).toBeUndefined();
  });

  it("buildHeaders falls back to top-level email/userId (OAuth mapTokens shape)", () => {
    executor._currentSessionId = "sess-top";
    executor._currentReqId = "req-top";

    const headers = executor.buildHeaders(
      {
        accessToken: "tok_test",
        email: "top@example.com",
        // userId only top-level; psd has neither email nor userId
        providerSpecificData: { authMethod: "device_code" },
      },
      true
    );

    expect(headers["x-email"]).toBe("top@example.com");
    expect(headers["x-userid"]).toBeUndefined();
  });

  it("transformRequest normalizes Responses body like official CLI", () => {
    const body = {
      model: "grok-4.5-high",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      tools: [
        {
          type: "function",
          function: {
            name: "run_terminal_command",
            description: "Run bash",
            parameters: { type: "object", properties: { command: { type: "string" } } },
          },
        },
        { type: "web_search" },
        { type: "x_search" },
      ],
      temperature: 0.7,
      max_tokens: 100,
      user: "cursor-user",
    };

    // Simulate translator already converting messages→input; also test messages fallback
    const out = executor.transformRequest("grok-4.5-high", { ...body }, true, {
      connectionId: "conn-1",
    });

    expect(out.model).toBe("grok-4.5");
    expect(out.stream).toBe(true);
    expect(out.store).toBe(false);
    expect(out.include).toContain("reasoning.encrypted_content");
    expect(out.reasoning).toEqual({ effort: "high", summary: "concise" });
    expect(out.messages).toBeUndefined();
    expect(out.max_tokens).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(Array.isArray(out.input)).toBe(true);
    expect(out.input.length).toBeGreaterThan(0);
    expect(executor._currentTurnIdx).toBe(1);

    // tools flattened + hosted tools kept
    expect(out.tools).toHaveLength(3);
    expect(out.tools[0]).toMatchObject({
      type: "function",
      name: "run_terminal_command",
    });
    expect(out.tools[0].parameters).toBeTruthy();
    expect(out.tools[0].function).toBeUndefined();
    expect(out.tools[1]).toEqual({ type: "web_search" });
    expect(out.tools[2]).toEqual({ type: "x_search" });
  });

  it("transformRequest keeps role:system (HAR parity) and strips server ids", () => {
    const body = {
      model: "grok-4.5",
      input: [
        { type: "message", role: "system", content: "You are Grok" },
        { type: "message", role: "user", content: "hi", id: "msg_server_id" },
        { type: "item_reference", id: "rs_abc" },
        "rs_should_drop",
      ],
      reasoning_effort: "medium",
    };

    const out = executor.transformRequest("grok-4.5", body, true, { connectionId: "c1" });
    expect(out.input).toHaveLength(2);
    // Official CLI sends system, not developer (Codex converts; Grok does not)
    expect(out.input[0].role).toBe("system");
    expect(out.input[1].id).toBeUndefined();
    expect(out.reasoning.effort).toBe("medium");
  });

  it("normalizes Codex cross-provider tool and reasoning history", () => {
    const out = executor.transformRequest("grok-4.5", {
      model: "grok-4.5",
      input: [
        { type: "message", role: "user", content: "continue" },
        {
          type: "reasoning",
          id: "rs_07fe505b3114f180016a5698411c448191bdcdcba678464461",
          encrypted_content: "openai-ciphertext",
          summary: [],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
        },
        {
          type: "custom_tool_call",
          id: "ctc_openai",
          call_id: "call-custom",
          name: "exec",
          input: "run this",
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
        },
        {
          type: "custom_tool_call_output",
          call_id: "call-custom",
          output: [{ type: "input_text", text: "first" }, { type: "input_text", text: "second" }],
        },
        {
          type: "function_call_output",
          call_id: "call-function",
          output: [{ type: "input_text", text: "function result" }],
        },
      ],
      tools: [{ type: "custom", name: "exec", description: "Run command" }],
    }, true, { connectionId: "cross-provider" });

    expect(out.input.some((item) => item.type === "reasoning")).toBe(false);
    expect(out.input[1]).toEqual({
      type: "function_call",
      call_id: "call-custom",
      name: "exec",
      arguments: JSON.stringify({ input: "run this" }),
    });
    expect(out.input[2]).toEqual({
      type: "function_call_output",
      call_id: "call-custom",
      output: JSON.stringify([{ type: "input_text", text: "first" }, { type: "input_text", text: "second" }]),
    });
    expect(out.input.some((item) => item.call_id === "call-function")).toBe(false);
    expect(out.tools[0].parameters).toEqual({
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
    });
  });

  it("stringifies structured outputs and removes orphaned output items", () => {
    const out = executor.transformRequest("grok-4.5", {
      model: "grok-4.5",
      input: [
        { type: "function_call", call_id: "call-array", name: "array_tool", arguments: "{}" },
        { type: "function_call_output", call_id: "call-array", output: [1, 2] },
        { type: "function_call", call_id: "call-null", name: "null_tool", arguments: "{}" },
        { type: "function_call_output", call_id: "call-null", output: null },
        { type: "custom_tool_call", call_id: "call-invalid", input: "missing name" },
        { type: "custom_tool_call_output", call_id: "call-invalid", output: "orphan" },
      ],
    }, true, { connectionId: "structured-output" });

    const outputs = out.input.filter((item) => item.type === "function_call_output");
    expect(outputs).toEqual([
      { type: "function_call_output", call_id: "call-array", output: "[1,2]" },
      { type: "function_call_output", call_id: "call-null", output: "null" },
    ]);
    expect(out.input.some((item) => item.call_id === "call-invalid")).toBe(false);
  });

  it("preserves native Grok encrypted reasoning and item ids", () => {
    const reasoningId = "rs_3e3f6187-892a-96db-893b-904eff019e19";
    const messageId = "msg_3e3f6187-892a-96db-893b-904eff019e19";
    const functionId = "fc_3e3f6187-892a-96db-893b-904eff019e19";
    const out = executor.transformRequest("grok-4.5", {
      model: "grok-4.5",
      input: [
        {
          type: "reasoning",
          id: reasoningId,
          status: "completed",
          encrypted_content: "grok-ciphertext",
          summary: [],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-2" },
        },
        { type: "message", id: messageId, role: "assistant", content: "done" },
        { type: "function_call", id: functionId, call_id: "native-call", name: "wait", arguments: "{}" },
        { type: "function_call_output", call_id: "native-call", output: "done" },
        { type: "message", role: "user", content: "next" },
      ],
    }, true, { connectionId: "native-grok" });

    expect(out.input[0]).toMatchObject({
      type: "reasoning",
      id: reasoningId,
      encrypted_content: "grok-ciphertext",
    });
    expect(out.input[0].internal_chat_message_metadata_passthrough).toBeUndefined();
    expect(out.input[1].id).toBe(messageId);
    expect(out.input[2].id).toBe(functionId);
  });

  it("normalizes official effort aliases", () => {
    expect(normalizeGrokCliEffort("none")).toBe("high");
    expect(normalizeGrokCliEffort("minimal")).toBe("high");
    expect(normalizeGrokCliEffort("max")).toBe("xhigh");
    expect(normalizeGrokCliEffort("xhigh")).toBe("xhigh");
    expect(normalizeGrokCliEffort("ultra")).toBe("high");

    const out = executor.transformRequest("grok-4.5", {
      model: "grok-4.5",
      input: "hi",
      reasoning: { effort: "max", summary: "detailed" },
    }, true, { connectionId: "effort-conn" });
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "detailed" });
  });

  it("omits reasoning effort for models that reject it", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.5")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-build")).toBe(false);
    expect(supportsGrokCliReasoningEffort("grok-composer-2.5-fast")).toBe(false);

    for (const model of ["grok-build", "grok-composer-2.5-fast"]) {
      const out = executor.transformRequest(model, {
        model,
        input: "hi",
        reasoning: { effort: "max" },
      }, true, { connectionId: `effort-${model}` });
      expect(out.reasoning).toEqual({ summary: "concise" });
      expect(out.include).toContain("reasoning.encrypted_content");
    }
  });

  it("drops stale tool_choice and normalizes converted custom choices", () => {
    const noTools = executor.transformRequest("grok-build", {
      model: "grok-build",
      input: "hi",
      tool_choice: "auto",
    }, true, { connectionId: "tools-none" });
    expect(noTools.tool_choice).toBeUndefined();

    const custom = executor.transformRequest("grok-build", {
      model: "grok-build",
      input: "hi",
      tools: [{ type: "custom", name: "apply_patch", description: "Patch files" }],
      tool_choice: { type: "custom", name: "apply_patch" },
    }, true, { connectionId: "tools-custom" });
    expect(custom.tools).toEqual([
      expect.objectContaining({ type: "function", name: "apply_patch" }),
    ]);
    expect(custom.tool_choice).toEqual({ type: "function", name: "apply_patch" });
  });

  it("increments x-grok-turn-idx from user-message count and stays monotonic", () => {
    const creds = {
      connectionId: "turn-conn",
      rawHeaders: { "x-session-id": "stable-session-xyz" },
    };

    // Turn 1: one user message
    executor.transformRequest(
      "grok-4.5",
      {
        model: "grok-4.5",
        input: [
          { type: "message", role: "system", content: "sys" },
          { type: "message", role: "user", content: "hi" },
        ],
      },
      true,
      creds
    );
    expect(executor._currentSessionId).toBeTruthy();
    expect(executor._currentTurnIdx).toBe(1);
    let headers = executor.buildHeaders({ accessToken: "t" }, true);
    expect(headers["x-grok-turn-idx"]).toBe("1");
    expect(headers["x-grok-session-id"]).toBe(executor._currentSessionId);
    expect(headers["x-grok-conv-id"]).toBe(executor._currentSessionId);

    const sessionId = executor._currentSessionId;

    // Turn 2: full history with two user messages
    executor.transformRequest(
      "grok-4.5",
      {
        model: "grok-4.5",
        input: [
          { type: "message", role: "system", content: "sys" },
          { type: "message", role: "user", content: "hi" },
          { type: "message", role: "assistant", content: "hello" },
          { type: "message", role: "user", content: "next" },
        ],
      },
      true,
      creds
    );
    expect(executor._currentSessionId).toBe(sessionId);
    expect(executor._currentTurnIdx).toBe(2);
    headers = executor.buildHeaders({ accessToken: "t" }, true);
    expect(headers["x-grok-turn-idx"]).toBe("2");

    // Same session, a new delta-style request advances without relying on full history.
    executor.transformRequest(
      "grok-4.5",
      {
        model: "grok-4.5",
        input: [{ type: "message", role: "user", content: "only latest" }],
      },
      true,
      creds
    );
    expect(executor._currentTurnIdx).toBe(3);
  });

  it("countGrokCliUserTurns / resolveGrokCliTurnIdx helpers", () => {
    expect(countGrokCliUserTurns(null)).toBe(1);
    expect(
      countGrokCliUserTurns([
        { type: "message", role: "system", content: "s" },
        { type: "message", role: "user", content: "a" },
        { type: "message", role: "assistant", content: "b" },
        { type: "message", role: "user", content: "c" },
      ])
    ).toBe(2);

    expect(resolveGrokCliTurnIdx("s1", [{ role: "user", type: "message", content: "a" }])).toBe(1);
    expect(
      resolveGrokCliTurnIdx("s1", [
        { role: "user", type: "message", content: "a" },
        { role: "user", type: "message", content: "b" },
      ])
    ).toBe(2);
    // monotonic
    expect(resolveGrokCliTurnIdx("s1", [{ role: "user", type: "message", content: "a" }])).toBe(2);
  });

  it("keeps fallback session stable when assistant history appears", () => {
    const creds = { connectionId: "fallback-conn", rawHeaders: {} };
    executor.transformRequest("grok-build", {
      model: "grok-build",
      input: [{ type: "message", role: "user", content: "first" }],
    }, true, creds);
    const firstSession = executor._currentSessionId;

    executor.transformRequest("grok-build", {
      model: "grok-build",
      input: [
        { type: "message", role: "user", content: "first" },
        { type: "message", role: "assistant", content: "x".repeat(100) },
        { type: "message", role: "user", content: "second" },
      ],
    }, true, creds);
    expect(executor._currentSessionId).toBe(firstSession);
    expect(executor._currentTurnIdx).toBe(2);
  });

  it("does not advance turn index when retrying the same request body", () => {
    const body = {
      model: "grok-build",
      input: [{ type: "message", role: "user", content: "retry me" }],
    };
    const creds = { connectionId: "retry-conn" };
    executor.transformRequest("grok-build", body, true, creds);
    const firstTurn = executor._currentTurnIdx;
    executor.transformRequest("grok-build", body, true, creds);
    expect(executor._currentTurnIdx).toBe(firstTurn);
  });

  it("bounds per-session turn state", () => {
    for (let i = 0; i < 5100; i += 1) {
      resolveGrokCliTurnIdx(`session-${i}`, [{ role: "user", content: "hi" }]);
    }
    expect(_getGrokCliTurnStoreSize()).toBe(5000);
  });

  it("parseError surfaces 402 spending-limit", () => {
    const err = executor.parseError(
      { status: 402 },
      JSON.stringify({
        code: "personal-team-blocked:spending-limit",
        error: "You have run out of credits",
      })
    );
    expect(err.status).toBe(402);
    expect(err.code).toBe("personal-team-blocked:spending-limit");
    expect(err.message).toMatch(/credits/i);
  });
});
