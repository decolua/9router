import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const usageMocks = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));
vi.mock("@/lib/usageDb.js", () => usageMocks);

const { GithubExecutor } = await import("../../open-sse/executors/github.js");
const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { resolveCopilotModels } = await import("../../open-sse/services/copilotModels.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHub Copilot Auto mode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    usageMocks.saveRequestDetail.mockClear();
    usageMocks.saveRequestUsage.mockClear();
  });

  it("uses GitHub's single-call Auto decision and caches the session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      session_token: "auto-session-token",
      selected_model: {
        id: "claude-sonnet-4.6",
        capabilities: { supports: { vision: true } },
      },
    }));

    const executor = new GithubExecutor();
    const resolved = await executor.resolveAutoModel({
      body: { messages: [{ role: "user", content: "Refactor this module" }] },
      credentials: { copilotToken: "copilot-token", connectionId: "github-free" },
      providerSessionId: "conversation-1",
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(resolved).toMatchObject({
      model: "claude-sonnet-4.6",
      sessionToken: "auto-session-token",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.githubcopilot.com/auto");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      prompt: "Refactor this module",
    });
    expect(fetchMock.mock.calls[0][1].headers["x-github-api-version"]).toBe("2026-08-01");

    const cached = await executor.resolveAutoModel({
      body: { messages: [{ role: "user", content: "Continue the refactor" }] },
      credentials: { copilotToken: "copilot-token", connectionId: "github-free" },
      providerSessionId: "conversation-1",
      signal: undefined,
      log: null,
      proxyOptions: null,
    });
    expect(cached.model).toBe("claude-sonnet-4.6");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells Auto when the request contains an image", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      session_token: "vision-auto-session-token",
      selected_model: {
        id: "gpt-5.4-mini",
        capabilities: { supports: { vision: true } },
      },
    }));

    const executor = new GithubExecutor();
    const resolved = await executor.resolveAutoModel({
      body: {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Explain this screenshot" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        }],
      },
      credentials: { copilotToken: "copilot-token", connectionId: "github-free" },
      providerSessionId: "conversation-2",
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(resolved.model).toBe("gpt-5.4-mini");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      prompt: "Explain this screenshot",
      has_image: true,
    });
  });

  it("executes the resolved model with the Copilot session token", async () => {
    const executor = new GithubExecutor();
    vi.spyOn(executor, "resolveAutoModel").mockResolvedValue({
      model: "gpt-5.4-mini",
      sessionToken: "auto-session-token",
    });
    const baseExecute = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response("", { status: 200 }),
      url: "https://api.githubcopilot.com/chat/completions",
      headers: {},
      transformedBody: {},
    });

    const result = await executor.execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "Hello" }] },
      stream: true,
      credentials: { copilotToken: "copilot-token" },
      providerSessionId: "conversation-3",
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(baseExecute).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.4-mini",
      body: expect.objectContaining({ model: "gpt-5.4-mini" }),
      credentials: expect.objectContaining({
        copilotSessionToken: "auto-session-token",
      }),
    }));
    expect(executor.buildHeaders({
      copilotToken: "copilot-token",
      copilotSessionToken: "auto-session-token",
    })["Copilot-Session-Token"]).toBe("auto-session-token");
    expect(executor.buildHeaders({
      copilotToken: "copilot-token",
      copilotSessionToken: "auto-session-token",
    })["x-github-api-version"]).toBe("2026-08-01");
    expect(executor.transformRequest("gpt-5.4-mini", { model: "auto" }).model).toBe("gpt-5.4-mini");
    expect(result).toMatchObject({
      requestedModel: "auto",
      resolvedModel: "gpt-5.4-mini",
    });
  });

  it("persists the resolved model while retaining Auto in request metadata", async () => {
    const result = await handleNonStreamingResponse({
      providerResponse: jsonResponse({
        model: "gpt-5.4-mini",
        choices: [{ message: { content: "Done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
      provider: "github",
      model: "auto",
      statisticsModel: "gpt-5.4-mini",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: { model: "auto", messages: [{ role: "user", content: "Hello" }] },
      stream: false,
      translatedBody: { model: "auto" },
      finalBody: { model: "gpt-5.4-mini" },
      requestStartTime: Date.now(),
      connectionId: "github-free",
      apiKey: null,
      clientRawRequest: null,
      onRequestSuccess: null,
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
      toolNameMap: null,
      customToolNames: null,
      trackDone() {},
      appendLog() {},
      pxpipe: null,
      reqTag: "test",
      log: null,
    });

    expect(result.success).toBe(true);
    expect(usageMocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github",
      model: "gpt-5.4-mini",
    }));
    expect(usageMocks.saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.4-mini",
      request: expect.objectContaining({ model: "auto" }),
      providerRequest: expect.objectContaining({ model: "gpt-5.4-mini" }),
    }));
  });

  it("attributes streaming usage to the resolved model", () => {
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "github",
      model: "auto",
      statisticsModel: "claude-sonnet-4.6",
      connectionId: "github-free",
      apiKey: null,
      requestStartTime: Date.now(),
      body: { model: "auto", messages: [{ role: "user", content: "Hello" }] },
      stream: true,
      finalBody: { model: "claude-sonnet-4.6" },
      translatedBody: { model: "auto" },
      clientRawRequest: null,
      pxpipe: null,
      reqTag: "test",
      log: null,
    });

    onStreamComplete({ content: "Done" }, { prompt_tokens: 8, completion_tokens: 2 }, Date.now());

    expect(usageMocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github",
      model: "claude-sonnet-4.6",
    }));
    expect(usageMocks.saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-sonnet-4.6",
      request: expect.objectContaining({ model: "auto" }),
    }));
  });

  it("always exposes Auto in the live model catalog", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        capabilities: { type: "chat" },
        policy: { state: "enabled" },
      }],
    }));

    const result = await resolveCopilotModels({
      accessToken: "github-access-token",
      providerSpecificData: { copilotToken: "catalog-token" },
    }, { forceRefresh: true });

    expect(result.models).toEqual([
      { id: "auto", name: "Auto" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    ]);
  });
});
