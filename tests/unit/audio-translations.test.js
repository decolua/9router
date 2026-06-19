import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fetch at module level so we can assert the upstream URL per kind.
let fetchedUrl = null;
let fetchMock = null;

describe("audio translations (handleSttCore kind routing)", () => {
  beforeEach(() => {
    fetchedUrl = null;
    fetchMock = vi.fn(async (url, init) => {
      fetchedUrl = url;
      return new Response(JSON.stringify({ text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function load() {
    return (await import("../../open-sse/handlers/sttCore.js")).handleSttCore;
  }

  function makeRequest() {
    const fd = new FormData();
    fd.append("model", "whisper-1");
    fd.append("file", new File([new Uint8Array([1, 2, 3])], "audio.wav", { type: "audio/wav" }));
    return fd;
  }

  it("kind=translation swaps /audio/transcriptions → /audio/translations for openai-format", async () => {
    const handleSttCore = await load();
    const cfg = {
      baseUrl: "https://api.openai.com/v1/audio/transcriptions",
      format: "openai",
      authType: "none",
    };
    const res = await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: makeRequest(),
      sttConfig: cfg,
      kind: "translation",
    });
    expect(res.success).toBe(true);
    expect(fetchedUrl).toBe("https://api.openai.com/v1/audio/translations");
  });

  it("kind=transcription (default) keeps /audio/transcriptions", async () => {
    const handleSttCore = await load();
    const cfg = {
      baseUrl: "https://api.openai.com/v1/audio/transcriptions",
      format: "openai",
      authType: "none",
    };
    await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: makeRequest(),
      sttConfig: cfg,
    });
    expect(fetchedUrl).toBe("https://api.openai.com/v1/audio/transcriptions");
  });

  it("kind=translation refuses specialized STT formats (deepgram) with 400", async () => {
    const handleSttCore = await load();
    const cfg = {
      baseUrl: "https://api.deepgram.com/v1/listen",
      format: "deepgram",
      authType: "none",
    };
    const res = await handleSttCore({
      provider: "deepgram",
      model: "nova-2",
      formData: makeRequest(),
      sttConfig: cfg,
      kind: "translation",
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kind=translation returns 400 when STT baseUrl has no /transcriptions suffix", async () => {
    const handleSttCore = await load();
    const cfg = {
      baseUrl: "https://example.com/v1/audio/stt",
      format: "openai",
      authType: "none",
    };
    const res = await handleSttCore({
      provider: "openai",
      model: "whisper-1",
      formData: makeRequest(),
      sttConfig: cfg,
      kind: "translation",
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
