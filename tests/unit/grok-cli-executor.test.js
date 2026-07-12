import { describe, it, expect, beforeEach } from "vitest";
import {
  GrokCliExecutor,
  countGrokCliUserTurns,
  resolveGrokCliTurnIdx,
  _resetGrokCliTurnStore,
} from "../../open-sse/executors/grok-cli.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
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

    expect(PROVIDER_MODELS.gcli?.some((m) => m.id === "grok-4.5")).toBe(true);
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
    expect(headers["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(headers["x-grok-client-identifier"]).toBe("grok-pager");
    expect(headers["x-grok-client-version"]).toBe("0.2.93");
    expect(headers["x-grok-session-id"]).toBe("sess-abc");
    expect(headers["x-grok-conv-id"]).toBe("sess-abc");
    expect(headers["x-grok-req-id"]).toBe("req-xyz");
    expect(headers["x-grok-turn-idx"]).toBe("3");
    expect(headers["x-grok-agent-id"]).toBe("agent-1");
    expect(headers["x-grok-model-override"]).toBe("grok-4.5");
    expect(headers["x-compaction-at"]).toBe("400000");
    expect(headers["x-email"]).toBe("u@example.com");
    expect(headers["x-userid"]).toBe("uid-1");
    expect(headers["x-authenticateresponse"]).toBe("authenticate-response");
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

    // Same session, payload that only has 1 user msg (delta-style client) must not go backwards
    executor.transformRequest(
      "grok-4.5",
      {
        model: "grok-4.5",
        input: [{ type: "message", role: "user", content: "only latest" }],
      },
      true,
      creds
    );
    expect(executor._currentTurnIdx).toBe(2);
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
