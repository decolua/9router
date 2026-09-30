/**
 * Unit tests for the xAI video proxy core (open-sse/handlers/videoCore.js)
 *
 * Covers:
 *  - registry wiring (videoConfig, grok-imagine-video kind)
 *  - byte-exact body forwarding (JSON + multipart)
 *  - request_id / polling-status passthrough (pending, processing, done, failed)
 *  - 401 → refresh once → retry once; refresh failure → no retry loop
 *  - no auto-retry of creation POSTs on network error
 *  - upstream error propagation with secret sanitization
 *  - abort/cancellation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("open-sse/services/tokenRefresh.js", () => ({
  refreshTokenByProvider: vi.fn(),
}));

import { handleVideoProxyCore, getVideoConfig, sanitizeSecrets, VIDEO_ACTIONS } from "open-sse/handlers/videoCore.js";
import { refreshTokenByProvider } from "open-sse/services/tokenRefresh.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";

const originalFetch = global.fetch;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("registry wiring", () => {
  it("exposes videoConfig for xai", () => {
    expect(getVideoConfig("xai")).toEqual({ baseUrl: "https://api.x.ai/v1/videos" });
    expect(PROVIDER_MEDIA.xai.serviceKinds).toContain("video");
  });

  it("registers grok-imagine-video with kind video (kept out of LLM lists)", () => {
    const model = PROVIDER_MODELS.xai.find((m) => m.id === "grok-imagine-video");
    expect(model).toBeTruthy();
    expect(model.kind || model.type).toBe("video");
  });

  it("supports exactly the three creation actions", () => {
    expect([...VIDEO_ACTIONS].sort()).toEqual(["edits", "extensions", "generations"]);
  });
});

describe("handleVideoProxyCore", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    refreshTokenByProvider.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects providers without videoConfig", async () => {
    const result = await handleVideoProxyCore({
      provider: "openai",
      action: "generations",
      rawBody: "{}",
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("does not support video generation");
  });

  it("forwards a creation POST byte-for-byte and passes request_id through", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ request_id: "req-123" }));

    const raw = '{"model":"grok-imagine-video","prompt":"neon city","duration":8}';
    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: raw,
      contentType: "application/json",
      idempotencyKey: "idem-1",
      credentials: { accessToken: "tok-A", refreshToken: "ref-A" },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/generations");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(raw); // byte-exact, no reshaping
    expect(init.headers.Authorization).toBe("Bearer tok-A");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Idempotency-Key"]).toBe("idem-1");

    expect(await result.response.json()).toEqual({ request_id: "req-123" });
  });

  it("forwards multipart bodies untouched with the original boundary header", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ request_id: "req-mp" }));

    const boundary = "----vitestBoundary42";
    const multipartBody = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nextend it\r\n--${boundary}--\r\n`
    );
    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "extensions",
      rawBody: multipartBody,
      contentType: `multipart/form-data; boundary=${boundary}`,
      credentials: { apiKey: "xai-key" },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/extensions");
    expect(init.body).toBe(multipartBody); // same Buffer, no re-encode
    expect(init.headers["Content-Type"]).toBe(`multipart/form-data; boundary=${boundary}`);
  });

  it.each([
    ["pending", { status: "pending", progress: 10 }],
    ["processing", { status: "processing", progress: 55 }],
    ["done", { status: "done", video: { url: "https://cdn.x.ai/v.mp4", duration: 8 } }],
  ])("passes %s polling payload through verbatim", async (_label, payload) => {
    global.fetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await handleVideoProxyCore({
      provider: "xai",
      requestId: "req-123",
      credentials: { accessToken: "tok" },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/videos/req-123");
    expect(init.method).toBe("GET");
    expect(await result.response.json()).toEqual(payload);
  });

  it("passes a failed job (HTTP 200, status failed) through without translating", async () => {
    const payload = { status: "failed", error: { code: "internal_error", message: "render crashed" } };
    global.fetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await handleVideoProxyCore({
      provider: "xai",
      requestId: "req-bad",
      credentials: { accessToken: "tok" },
    });

    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual(payload);
  });

  it("url-encodes the request id when polling", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ status: "pending" }));
    await handleVideoProxyCore({
      provider: "xai",
      requestId: "id with/slash",
      credentials: { accessToken: "tok" },
    });
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.x.ai/v1/videos/id%20with%2Fslash");
  });

  it("401 → refreshes once and retries once with the new token", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ request_id: "req-after-refresh" }));
    refreshTokenByProvider.mockResolvedValueOnce({ accessToken: "tok-NEW", refreshToken: "ref-NEW" });

    const credentials = { accessToken: "tok-OLD", refreshToken: "ref-OLD" };
    const onCredentialsRefreshed = vi.fn();

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: '{"prompt":"x"}',
      contentType: "application/json",
      credentials,
      onCredentialsRefreshed,
    });

    expect(result.success).toBe(true);
    expect(refreshTokenByProvider).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer tok-NEW");
    expect(onCredentialsRefreshed).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "tok-NEW" }));
    expect(await result.response.json()).toEqual({ request_id: "req-after-refresh" });
  });

  it("401 twice → still only one refresh and one retry (no loop)", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "still expired" }, 401));
    refreshTokenByProvider.mockResolvedValueOnce({ accessToken: "tok-NEW" });

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      credentials: { accessToken: "tok-OLD", refreshToken: "ref" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(refreshTokenByProvider).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("failed refresh → 401 propagates with a single upstream call (account flagged for re-auth upstream)", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401));
    refreshTokenByProvider.mockResolvedValueOnce(null);

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      credentials: { accessToken: "tok-OLD", refreshToken: "ref" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("API-key accounts (no refreshToken) never attempt refresh on 401", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ error: "bad key" }, 401));

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      credentials: { apiKey: "xai-key" },
    });

    expect(result.success).toBe(false);
    expect(refreshTokenByProvider).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("never re-sends a creation POST after a network error", async () => {
    global.fetch.mockRejectedValueOnce(new Error("socket hang up"));

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      credentials: { accessToken: "tok", refreshToken: "ref" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes bearer tokens and credential values out of upstream errors", async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({ error: "denied for Bearer sk-secret-token-value-123456 (token tok-SECRETSECRET)" }, 403)
    );

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      credentials: { apiKey: "tok-SECRETSECRET" },
    });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain("sk-secret-token-value-123456");
    expect(result.error).not.toContain("tok-SECRETSECRET");
    expect(result.error).toContain("[redacted]");
  });

  it("maps client aborts to 408 without retrying", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    global.fetch.mockRejectedValueOnce(abortError);

    const result = await handleVideoProxyCore({
      provider: "xai",
      action: "generations",
      rawBody: "{}",
      credentials: { accessToken: "tok" },
      signal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(408);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("sanitizeSecrets", () => {
  it("redacts bearer tokens", () => {
    expect(sanitizeSecrets("Authorization: Bearer abc.def-ghi_jkl")).not.toContain("abc.def-ghi_jkl");
  });

  it("redacts explicit credential values", () => {
    const creds = { accessToken: "supersecretaccess", refreshToken: "supersecretrefresh" };
    const out = sanitizeSecrets("leak supersecretaccess and supersecretrefresh", creds);
    expect(out).toBe("leak [redacted] and [redacted]");
  });

  it("leaves normal text untouched", () => {
    expect(sanitizeSecrets("video render failed: invalid_argument")).toBe("video render failed: invalid_argument");
  });
});
