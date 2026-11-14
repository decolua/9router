import { describe, it, expect, vi, afterEach } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

const CFG = {
  baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
  authType: "bearer",
  format: "openai",
};

const CRED = { apiKey: "gsk-TEST-KEY" };

function mkFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "sample.wav", { type: "audio/wav" });
}

function stubFetch(responseBody = { text: "hello world" }) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, opts) => {
    calls.push({ url: String(url && url.url ? url.url : url), opts });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible STT transport", () => {
  it("forwards timestamp_granularities[] when provided as array syntax", async () => {
    const calls = stubFetch({ task: "transcribe", text: "hello", words: [{ word: "hello", start: 0, end: 0.5 }] });
    const formData = new FormData();
    formData.set("file", mkFile());
    formData.set("model", "whisper-large-v3");
    formData.set("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "word");
    formData.append("timestamp_granularities[]", "segment");

    const result = await handleSttCore({
      provider: "groq",
      model: "whisper-large-v3",
      formData,
      credentials: CRED,
      sttConfig: CFG,
    });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const body = calls[0].opts.body;
    expect(body.get("model")).toBe("whisper-large-v3");
    expect(body.get("response_format")).toBe("verbose_json");
    expect(body.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
  });

  it("normalizes singular timestamp_granularities parameter to timestamp_granularities[]", async () => {
    const calls = stubFetch();
    const formData = new FormData();
    formData.set("file", mkFile());
    formData.set("model", "whisper-large-v3");
    formData.set("response_format", "verbose_json");
    formData.append("timestamp_granularities", "word");

    const result = await handleSttCore({
      provider: "groq",
      model: "whisper-large-v3",
      formData,
      credentials: CRED,
      sttConfig: CFG,
    });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const body = calls[0].opts.body;
    expect(body.getAll("timestamp_granularities[]")).toEqual(["word"]);
  });

  it("omits timestamp_granularities[] when not provided in client request", async () => {
    const calls = stubFetch();
    const formData = new FormData();
    formData.set("file", mkFile());
    formData.set("model", "whisper-large-v3");

    const result = await handleSttCore({
      provider: "groq",
      model: "whisper-large-v3",
      formData,
      credentials: CRED,
      sttConfig: CFG,
    });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    const body = calls[0].opts.body;
    expect(body.getAll("timestamp_granularities[]")).toEqual([]);
  });
});
