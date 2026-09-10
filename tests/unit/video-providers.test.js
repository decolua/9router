/**
 * Unit tests for the OpenRouter + Vertex (Veo) video adapters.
 *
 * Covers:
 *  - registry wiring (videoConfig, video serviceKind, video-kind models)
 *  - OpenRouter: POST to the collection root, GET poll, verbatim passthrough
 *  - Vertex: predictLongRunning body translation, fetchPredictOperation polling,
 *    operation-name round-trip through the job id, response mapping
 *  - xAI default path is unchanged by the adapter hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshTokenByProvider: vi.fn(), refreshVertexToken: vi.fn() };
});

import { handleVideoProxyCore, getVideoConfig } from "open-sse/handlers/videoCore.js";
import { refreshVertexToken } from "open-sse/services/tokenRefresh.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";

const originalFetch = global.fetch;
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Vertex operation names are resource paths; the adapter base64url-encodes them.
const OPERATION_NAME =
  "projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-generate-preview/operations/op-abc";
const JOB_ID = Buffer.from(OPERATION_NAME, "utf8").toString("base64url");

describe("registry wiring", () => {
  it("exposes videoConfig + video serviceKind for openrouter and vertex", () => {
    expect(getVideoConfig("openrouter").baseUrl).toBe("https://openrouter.ai/api/v1/videos");
    expect(getVideoConfig("vertex").baseUrl).toBe("https://aiplatform.googleapis.com");
    expect(PROVIDER_MEDIA.openrouter.serviceKinds).toContain("video");
    expect(PROVIDER_MEDIA.vertex.serviceKinds).toContain("video");
  });

  it("registers video-kind models on both providers", () => {
    const or = PROVIDER_MODELS.openrouter.find((m) => m.id === "google/veo-3.1");
    const vx = PROVIDER_MODELS.vertex.find((m) => m.id === "veo-3.1-generate-preview");
    expect(or?.kind).toBe("video");
    expect(vx?.kind).toBe("video");
  });
});

describe("openrouter video adapter", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("POSTs creation to the collection root (no /generations suffix)", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "pending" }));

    const raw = '{"model":"google/veo-3.1","prompt":"a paper boat"}';
    const result = await handleVideoProxyCore({
      provider: "openrouter",
      action: "generations",
      rawBody: raw,
      contentType: "application/json",
      credentials: { apiKey: "sk-or-key" },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/videos");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(raw); // verbatim
    expect(init.headers.Authorization).toBe("Bearer sk-or-key");
    expect(init.headers["HTTP-Referer"]).toBe("https://endpoint-proxy.local");
    expect(await result.response.json()).toEqual({ id: "job-1", status: "pending" });
  });

  it("polls GET /videos/{id} and passes the payload through verbatim", async () => {
    const payload = { id: "job-1", status: "completed", unsigned_urls: ["https://cdn/v.mp4"] };
    global.fetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await handleVideoProxyCore({
      provider: "openrouter",
      requestId: "job-1",
      credentials: { apiKey: "sk-or-key" },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/videos/job-1");
    expect(init.method).toBe("GET");
    expect(await result.response.json()).toEqual(payload);
  });

  it("rejects unsupported actions before any upstream call (no billable job)", async () => {
    const result = await handleVideoProxyCore({
      provider: "openrouter",
      action: "extensions",
      rawBody: "{}",
      contentType: "application/json",
      credentials: { apiKey: "sk-or-key" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("vertex (veo) video adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    refreshVertexToken.mockReset();
  });
  afterEach(() => { global.fetch = originalFetch; });

  const saJson = JSON.stringify({
    type: "service_account",
    client_email: "sa@proj-1.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
    project_id: "proj-1",
  });

  it("translates the create body to predictLongRunning and returns a poll-able job id", async () => {
    refreshVertexToken.mockResolvedValueOnce({ accessToken: "vertex-tok" });
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION_NAME }));

    const result = await handleVideoProxyCore({
      provider: "vertex",
      action: "generations",
      rawBody: JSON.stringify({
        model: "veo-3.1-generate-preview",
        prompt: "a neon city",
        duration: 8,
        aspect_ratio: "16:9",
        resolution: "720p",
        n: 1,
      }),
      contentType: "application/json",
      credentials: { apiKey: saJson },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-generate-preview:predictLongRunning"
    );
    expect(init.headers.Authorization).toBe("Bearer vertex-tok");
    expect(JSON.parse(init.body)).toEqual({
      instances: [{ prompt: "a neon city" }],
      parameters: { sampleCount: 1, durationSeconds: 8, aspectRatio: "16:9", resolution: "720p" },
    });

    // Response is mapped onto the async-job shape clients already poll.
    expect(await result.response.json()).toEqual({
      id: JOB_ID,
      request_id: JOB_ID,
      status: "pending",
    });
  });

  it("maps a data-URL image onto the Vertex image instance", async () => {
    refreshVertexToken.mockResolvedValueOnce({ accessToken: "vertex-tok" });
    global.fetch.mockResolvedValueOnce(jsonResponse({ name: OPERATION_NAME }));

    await handleVideoProxyCore({
      provider: "vertex",
      action: "generations",
      rawBody: JSON.stringify({
        model: "veo-3.1-generate-preview",
        prompt: "animate this",
        image: "data:image/png;base64,AAAB",
      }),
      contentType: "application/json",
      credentials: { apiKey: saJson },
    });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body).instances[0].image).toEqual({
      bytesBase64Encoded: "AAAB",
      mimeType: "image/png",
    });
  });

  it("polls via fetchPredictOperation and maps a completed operation", async () => {
    refreshVertexToken.mockResolvedValueOnce({ accessToken: "vertex-tok" });
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        name: OPERATION_NAME,
        done: true,
        response: { videos: [{ gcsUri: "gs://bucket/v.mp4", mimeType: "video/mp4" }] },
      })
    );

    const result = await handleVideoProxyCore({
      provider: "vertex",
      requestId: JOB_ID,
      credentials: { apiKey: saJson },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/veo-3.1-generate-preview:fetchPredictOperation"
    );
    expect(init.method).toBe("POST"); // Vertex polls with POST, not GET
    expect(JSON.parse(init.body)).toEqual({ operationName: OPERATION_NAME });

    expect(await result.response.json()).toEqual({
      id: JOB_ID,
      request_id: JOB_ID,
      status: "completed",
      video: { url: "gs://bucket/v.mp4", b64_json: null, mime_type: "video/mp4" },
      videos: [{ url: "gs://bucket/v.mp4", b64_json: null, mime_type: "video/mp4" }],
    });
  });

  it("maps a failed operation to status failed", async () => {
    refreshVertexToken.mockResolvedValueOnce({ accessToken: "vertex-tok" });
    global.fetch.mockResolvedValueOnce(
      jsonResponse({ name: OPERATION_NAME, done: true, error: { code: 3, message: "bad prompt" } })
    );

    const result = await handleVideoProxyCore({
      provider: "vertex",
      requestId: JOB_ID,
      credentials: { apiKey: saJson },
    });

    const body = await result.response.json();
    expect(body.status).toBe("failed");
    expect(body.error.message).toBe("bad prompt");
  });

  it("rejects missing project id and raw API keys before any upstream call", async () => {
    const noProject = await handleVideoProxyCore({
      provider: "vertex",
      action: "generations",
      rawBody: JSON.stringify({ model: "veo-3.1-generate-preview", prompt: "x" }),
      contentType: "application/json",
      credentials: { apiKey: "AIzaRawKey" },
    });
    expect(noProject.success).toBe(false);
    expect(noProject.status).toBe(400);

    const noToken = await handleVideoProxyCore({
      provider: "vertex",
      action: "generations",
      rawBody: JSON.stringify({ model: "veo-3.1-generate-preview", prompt: "x" }),
      contentType: "application/json",
      credentials: { apiKey: "AIzaRawKey", providerSpecificData: { projectId: "proj-1" } },
    });
    expect(noToken.success).toBe(false);
    expect(noToken.status).toBe(400);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid job id without calling upstream", async () => {
    refreshVertexToken.mockResolvedValue({ accessToken: "vertex-tok" });
    const result = await handleVideoProxyCore({
      provider: "vertex",
      requestId: Buffer.from("not-an-operation", "utf8").toString("base64url"),
      credentials: { apiKey: saJson },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
