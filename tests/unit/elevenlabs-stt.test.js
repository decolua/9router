// ElevenLabs Scribe STT transport contract.
//
// Black-box tests against open-sse/handlers/sttCore.js. Wire observables only:
//   - dispatch on sttConfig.format "elevenlabs-stt", never a hardcoded model id;
//   - xi-api-key auth header (the STT engine's own authHeader map), not Bearer;
//   - model_id carries the upstream model, `file` the audio part;
//   - blank language is omitted so the vendor auto-detects;
//   - Scribe params (timestamps_granularity, tag_audio_events) ride the body only
//     when the client sends them; out-of-range granularity is dropped;
//   - diarize and num_speakers are mutually exclusive upstream — diarize wins;
//   - response_format maps to Scribe additional_formats: json → envelope,
//     text → plain body, srt/vtt → the subtitle render verbatim, verbose_json →
//     envelope + words + real segments (never synthesized);
//   - upstream non-2xx → gateway error envelope (status passthrough).
//
// NOT pinned: exact JSON key order, region hosts, ElevenLabs account entitlements.
import { describe, it, expect, vi, afterEach } from "vitest";

import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

// ── fixtures ──────────────────────────────────────────────────────────────

const STTCFG = {
  baseUrl: "https://api.elevenlabs.io/v1/speech-to-text",
  authType: "apikey",
  authHeader: "xi-api-key",
  format: "elevenlabs-stt",
  responseFormats: { segments: "seg_json", subtitles: "srt", captions: "vtt" },
};
const CRED = { apiKey: "sk-el-TEST" };

const TRANSCRIPT = {
  language_code: "eng",
  language_probability: 0.99,
  text: "hello from scribe",
  words: [{ text: "hello", start: 0.1, end: 0.4, confidence: 0.98 }],
};

function mkFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "a.wav", { type: "audio/wav" });
}

function mkFormData(extra = {}) {
  const fd = new FormData();
  fd.set("file", mkFile());
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

// Capture the outbound multipart body so assertions read the real wire shape.
function stubFetch(json = TRANSCRIPT, extraFormats = []) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, opts) => {
    calls.push({ url: String(url && url.url ? url.url : url), opts });
    const body = extraFormats.length ? { ...json, additional_formats: extraFormats } : json;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

function field(calls, name) {
  const form = calls[0].opts.body;
  const v = form.get(name);
  return typeof v === "string" ? v : v;
}

async function run({ formData = mkFormData(), cfg = STTCFG, model = "scribe_v1", transport } = {}) {
  const result = await handleSttCore({
    provider: "elevenlabs",
    model,
    formData,
    credentials: CRED,
    sttConfig: cfg,
    transport,
  });
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── dispatch + auth ───────────────────────────────────────────────────────

describe("ElevenLabs Scribe dispatch", () => {
  it("hits the speech-to-text endpoint with xi-api-key (never Bearer) and model_id", async () => {
    const calls = stubFetch();
    const result = await run();

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0].opts.method).toBe("POST");

    const headers = calls[0].opts.headers;
    expect(headers["xi-api-key"]).toBe("sk-el-TEST");
    expect(headers.Authorization).toBeUndefined();

    expect(field(calls, "model_id")).toBe("scribe_v1");
    const file = calls[0].opts.body.get("file");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("a.wav");
    await expect(result.response.json()).resolves.toEqual({ text: "hello from scribe" });
  });

  it("registry model ids dispatch through sttConfig.format (no hardcoded model check)", async () => {
    const sttModels = (PROVIDER_MODELS.el || []).filter((m) => m.kind === "stt");
    expect(sttModels.length).toBeGreaterThan(0);

    for (const m of sttModels) {
      const calls = stubFetch();
      const result = await run({ model: m.id });
      expect(result.success).toBe(true);
      expect(field(calls, "model_id")).toBe(m.id);
      vi.unstubAllGlobals();
    }
  });

  it("per-connection baseUrl override wins over the registry default", async () => {
    const calls = stubFetch();
    const result = await handleSttCore({
      provider: "elevenlabs",
      model: "scribe_v1",
      formData: mkFormData(),
      credentials: { apiKey: "sk-el-TEST", providerSpecificData: { baseUrl: "https://api.eu.elevenlabs.io/v1/speech-to-text/" } },
      sttConfig: STTCFG,
    });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe("https://api.eu.elevenlabs.io/v1/speech-to-text");
  });

  it("missing credentials short-circuit before any upstream call", async () => {
    const calls = stubFetch();
    const result = await handleSttCore({
      provider: "elevenlabs",
      model: "scribe_v1",
      formData: mkFormData(),
      sttConfig: STTCFG,
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("upstream error becomes the gateway error envelope with the vendor message", async () => {
    vi.stubGlobal("fetch", async () => new Response(
      JSON.stringify({ detail: [{ msg: "invalid model_id" }] }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(typeof result.error).toBe("string");
  });
});

// ── request params ────────────────────────────────────────────────────────

describe("Scribe request params", () => {
  it("blank language is omitted so ElevenLabs auto-detects", async () => {
    const calls = stubFetch();
    await run({ formData: mkFormData({ language: "   " }) });
    expect(calls[0].opts.body.get("language_code")).toBeNull();
  });

  it("a supplied language maps to language_code", async () => {
    const calls = stubFetch();
    await run({ formData: mkFormData({ language: "vie" }) });
    expect(field(calls, "language_code")).toBe("vie");
  });

  it("timestamps_granularity and tag_audio_events ride the body only when sent", async () => {
    const bare = stubFetch();
    await run();
    expect(bare[0].opts.body.get("timestamps_granularity")).toBeNull();
    expect(bare[0].opts.body.get("tag_audio_events")).toBeNull();
    vi.unstubAllGlobals();

    const calls = stubFetch();
    await run({ formData: mkFormData({ timestamps_granularity: "word", tag_audio_events: "true" }) });
    expect(field(calls, "timestamps_granularity")).toBe("word");
    expect(field(calls, "tag_audio_events")).toBe("true");
  });

  it("an unsupported timestamps_granularity value is dropped rather than forwarded", async () => {
    const calls = stubFetch();
    const result = await run({ formData: mkFormData({ timestamps_granularity: "sentence" }) });
    expect(result.success).toBe(true);
    expect(calls[0].opts.body.get("timestamps_granularity")).toBeNull();
  });

  it("diarize and num_speakers never both go out — diarize wins", async () => {
    const both = stubFetch();
    await run({ formData: mkFormData({ diarize: "true", num_speakers: "3" }) });
    expect(field(both, "diarize")).toBe("true");
    expect(both[0].opts.body.get("num_speakers")).toBeNull();
    vi.unstubAllGlobals();

    const count = stubFetch();
    await run({ formData: mkFormData({ num_speakers: "3" }) });
    expect(field(count, "num_speakers")).toBe("3");
    expect(count[0].opts.body.get("diarize")).toBeNull();
  });

  it("num_speakers outside Scribe's 1-32 range is dropped", async () => {
    const calls = stubFetch();
    await run({ formData: mkFormData({ num_speakers: "99" }) });
    expect(calls[0].opts.body.get("num_speakers")).toBeNull();
  });
});

// ── response_format mapping ───────────────────────────────────────────────

describe("response_format mapping", () => {
  it("json asks for no additional render and returns the plain envelope", async () => {
    const calls = stubFetch();
    const result = await run({ formData: mkFormData({ response_format: "json" }) });
    expect(calls[0].opts.body.get("additional_formats")).toBeNull();
    await expect(result.response.json()).resolves.toEqual({ text: "hello from scribe" });
  });

  it("text returns a plain-text body", async () => {
    stubFetch();
    const result = await run({ formData: mkFormData({ response_format: "text" }) });
    expect(result.success).toBe(true);
    expect(result.response.headers.get("Content-Type")).toContain("text/plain");
    await expect(result.response.text()).resolves.toBe("hello from scribe");
  });

  it("srt requests the srt render and serves it verbatim", async () => {
    const srt = "1\n00:00:00,100 --> 00:00:00,400\nhello\n";
    const calls = stubFetch(TRANSCRIPT, [{ format: "srt", content: srt }]);
    const result = await run({ formData: mkFormData({ response_format: "srt" }) });

    expect(JSON.parse(field(calls, "additional_formats"))).toEqual([{ format: "srt" }]);
    expect(result.response.headers.get("Content-Type")).toContain("text/plain");
    await expect(result.response.text()).resolves.toBe(srt);
  });

  it("vtt requests the vtt render and serves it verbatim", async () => {
    const vtt = "WEBVTT\n\n00:00.100 --> 00:00.400\nhello\n";
    const calls = stubFetch(TRANSCRIPT, [{ format: "vtt", content: vtt }]);
    const result = await run({ formData: mkFormData({ response_format: "vtt" }) });

    expect(JSON.parse(field(calls, "additional_formats"))).toEqual([{ format: "vtt" }]);
    await expect(result.response.text()).resolves.toBe(vtt);
  });

  it("srt falls back to plain text when the render is absent", async () => {
    stubFetch(TRANSCRIPT, []);
    const result = await run({ formData: mkFormData({ response_format: "srt" }) });
    await expect(result.response.text()).resolves.toBe("hello from scribe");
  });

  it("verbose_json requests seg_json and returns real words + segments", async () => {
    const segments = [{ id: 0, text: "hello from scribe", start: 0.1, end: 1.2 }];
    const calls = stubFetch(TRANSCRIPT, [{ format: "seg_json", content: JSON.stringify(segments) }]);
    const result = await run({ formData: mkFormData({ response_format: "verbose_json" }) });

    expect(JSON.parse(field(calls, "additional_formats"))).toEqual([{ format: "seg_json" }]);
    await expect(result.response.json()).resolves.toEqual({
      text: "hello from scribe",
      language: "eng",
      language_probability: 0.99,
      words: TRANSCRIPT.words,
      segments,
    });
  });

  it("verbose_json omits segments rather than fabricating them when the render is missing", async () => {
    stubFetch(TRANSCRIPT, []);
    const result = await run({ formData: mkFormData({ response_format: "verbose_json" }) });
    const body = await result.response.json();
    expect(body.text).toBe("hello from scribe");
    expect(body.segments).toBeUndefined();
  });

  it("an unparseable seg_json render degrades to no segments (no throw)", async () => {
    stubFetch(TRANSCRIPT, [{ format: "seg_json", content: "{not json" }]);
    const result = await run({ formData: mkFormData({ response_format: "verbose_json" }) });
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.text).toBe("hello from scribe");
    expect(body.segments).toBeUndefined();
  });

  it("format mapping is config-driven, not hardcoded", async () => {
    const calls = stubFetch(TRANSCRIPT, [{ format: "webvtt", content: "WEBVTT\n" }]);
    const custom = { ...STTCFG, responseFormats: { segments: "seg", subtitles: "subrip", captions: "webvtt" } };
    const result = await run({ formData: mkFormData({ response_format: "vtt" }), cfg: custom });
    expect(JSON.parse(field(calls, "additional_formats"))).toEqual([{ format: "webvtt" }]);
    await expect(result.response.text()).resolves.toBe("WEBVTT\n");
  });
});

// ── dispatch override ─────────────────────────────────────────────────────

describe("transport marker", () => {
  it("an explicit caller marker overrides the registry format", async () => {
    const calls = stubFetch();
    // "gemini-stt" would issue a generateContent GET, not the Scribe POST — proves
    // the marker, not the provider id, selects the transport.
    const result = await run({ transport: "elevenlabs-stt", cfg: { ...STTCFG, format: "gemini-stt" } });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
  });

  it("an unknown provider/model id with no marker still uses sttConfig.format", async () => {
    const calls = stubFetch();
    const result = await run({ model: "scribe_custom_eu" });
    expect(result.success).toBe(true);
    expect(field(calls, "model_id")).toBe("scribe_custom_eu");
  });
});
