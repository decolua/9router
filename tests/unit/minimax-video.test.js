import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("open-sse/services/tokenRefresh.js", () => ({
  refreshTokenByProvider: vi.fn(),
}));

import {
  getVideoConfig,
  handleVideoProxyCore,
} from "open-sse/handlers/videoCore.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";

const originalFetch = global.fetch;
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("MiniMax video registry", () => {
  it("registers the v2 video model for both regional providers", () => {
    for (const provider of ["minimax", "minimax-cn"]) {
      expect(PROVIDER_MEDIA[provider].serviceKinds).toContain("video");
      expect(PROVIDER_MODELS[provider]).toContainEqual(
        expect.objectContaining({ id: "MiniMax-H3", kind: "video" }),
      );
      expect(getVideoConfig(provider).defaultModel).toBe("MiniMax-H3");
    }
  });
});

describe("MiniMax video v2 adapter", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("maps an OpenAI-style text-to-video request to the global v2 schema", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ task_id: "task-123" }));

    const result = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: JSON.stringify({
        model: "MiniMax-H3",
        prompt: "A lantern drifting over a quiet lake",
        resolution: "2K",
        duration: 5,
        aspect_ratio: "16:9",
      }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.minimax.io/v2/video_generation");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({
      model: "MiniMax-H3",
      content: [{ type: "text", text: "A lantern drifting over a quiet lake" }],
      resolution: "2K",
      duration: 5,
      ratio: "16:9",
    });
    expect(await result.response.json()).toEqual({ request_id: "task-123" });
  });

  it("uses the China endpoint and maps its regional watermark field", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ task_id: "task-cn" }));

    await handleVideoProxyCore({
      provider: "minimax-cn",
      action: "generations",
      rawBody: JSON.stringify({
        model: "MiniMax-H3",
        prompt: "Clouds crossing a mountain ridge",
        resolution: "2K",
        duration: 4,
        ratio: "21:9",
        aigc_watermark: true,
      }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.minimaxi.com/v2/video_generation");
    expect(JSON.parse(init.body).aigc_watermark).toBe(true);
  });

  it("maps task polling status and output video fields", async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        task: {
          id: "task-123",
          status: "succeeded",
          content: { url: "https://media.example/video.mp4" },
          resolution: "2K",
          duration: 5,
          ratio: "16:9",
          usage: { output_seconds: 5 },
        },
      }),
    );

    const result = await handleVideoProxyCore({
      provider: "minimax",
      requestId: "task-123",
      credentials: { apiKey: "test-key" },
    });

    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://api.minimax.io/v2/query/video_generation/task-123",
    );
    expect(await result.response.json()).toEqual({
      request_id: "task-123",
      status: "done",
      video: {
        url: "https://media.example/video.mp4",
        duration: 5,
        resolution: "2K",
        aspect_ratio: "16:9",
      },
      usage: { output_seconds: 5 },
    });
  });

  it("rejects incomplete or unsupported text-to-video requests before fetching", async () => {
    const result = await handleVideoProxyCore({
      provider: "minimax",
      action: "generations",
      rawBody: JSON.stringify({ model: "MiniMax-H3", prompt: "A forest" }),
      contentType: "application/json",
      credentials: { apiKey: "test-key" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
