import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");

const credentials = {
  accessToken: "test-token",
  connectionId: "same-account",
  providerSpecificData: { chatgptAccountId: "workspace-1" },
};

function encryptedError(
  message = "The encrypted content foreign-secret could not be verified.",
  code = "invalid_encrypted_content",
  status = 400,
) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: "invalid_request_error",
      code,
    },
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody() {
  return {
    model: "gpt-5.5",
    input: [
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "keep this summary" }],
        encrypted_content: "foreign-secret",
      },
      {
        type: "reasoning",
        summary: [],
        encrypted_content: "ciphertext-only-secret",
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "continue" }],
      },
    ],
  };
}

beforeEach(() => fetchMock.mockReset());

describe("Codex invalid encrypted-content recovery", () => {
  it("does not rotate accounts when sanitized history still fails deterministically", () => {
    expect(checkFallbackError(400, JSON.stringify({
      error: { code: "invalid_encrypted_content" },
    }))).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(checkFallbackError(400,
      "The encrypted content could not be decrypted or parsed.",
    )).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(checkFallbackError(500,
      "The encrypted content could not be decrypted or parsed.",
    ).shouldFallback).toBe(true);
  });

  it("retries once on the same account after removing only unusable reasoning ciphertext", async () => {
    fetchMock
      .mockResolvedValueOnce(encryptedError())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const log = { warn: vi.fn() };
    const executor = new CodexExecutor();
    const body = requestBody();

    const result = await executor.execute({
      model: "gpt-5.5",
      body,
      stream: true,
      credentials,
      log,
    });

    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers["ChatGPT-Account-ID"]).toBe("workspace-1");
    expect(fetchMock.mock.calls[1][1].headers["ChatGPT-Account-ID"]).toBe("workspace-1");

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.input.filter((item) => item.encrypted_content)).toHaveLength(2);
    expect(retryBody.input).toContainEqual({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "keep this summary" }],
    });
    expect(retryBody.input).not.toContainEqual(expect.objectContaining({ encrypted_content: expect.anything() }));
    expect(retryBody.input).not.toContainEqual({ type: "reasoning", summary: [] });
    expect(body.input.filter((item) => item.encrypted_content)).toHaveLength(2);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("foreign-secret");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("ciphertext-only-secret");
  });

  it("recognizes the observed verification message without an error code", async () => {
    fetchMock
      .mockResolvedValueOnce(encryptedError(undefined, null))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const executor = new CodexExecutor();

    const result = await executor.execute({
      model: "gpt-5.5",
      body: requestBody(),
      stream: true,
      credentials,
    });

    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after one sanitized retry when upstream repeats the rejection", async () => {
    fetchMock.mockResolvedValue(encryptedError());
    const log = { warn: vi.fn() };
    const executor = new CodexExecutor();

    const result = await executor.execute({
      model: "gpt-5.5",
      body: requestBody(),
      stream: true,
      credentials,
      log,
    });

    expect(result.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("preserves encrypted reasoning when upstream accepts it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const executor = new CodexExecutor();

    await executor.execute({
      model: "gpt-5.5",
      body: requestBody(),
      stream: true,
      credentials,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toContain("foreign-secret");
  });

  it("does not retry unrelated bad requests", async () => {
    fetchMock.mockResolvedValueOnce(encryptedError(
      "Unknown parameter: input[0].content",
      "unknown_parameter",
    ));
    const executor = new CodexExecutor();

    const result = await executor.execute({
      model: "gpt-5.5",
      body: requestBody(),
      stream: true,
      credentials,
    });

    expect(result.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry the same message at a non-400 status", async () => {
    fetchMock.mockResolvedValueOnce(encryptedError(undefined, null, 422));
    const executor = new CodexExecutor();

    const result = await executor.execute({
      model: "gpt-5.5",
      body: requestBody(),
      stream: true,
      credentials,
    });

    expect(result.response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when rejected history contains no encrypted reasoning", async () => {
    fetchMock.mockResolvedValueOnce(encryptedError());
    const executor = new CodexExecutor();

    const result = await executor.execute({
      model: "gpt-5.5",
      body: {
        model: "gpt-5.5",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] }],
      },
      stream: true,
      credentials,
    });

    expect(result.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
