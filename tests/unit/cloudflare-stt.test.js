// Cloudflare Workers AI STT (Deepgram Nova-3) transport contract.
//
// Black-box tests against open-sse/handlers/sttCore.js. Wire observables only:
//   - dispatch on sttConfig.format "cloudflare-workers-ai", never a hardcoded model id;
//   - the account id comes from the connection's providerSpecificData and is
//     URL-encoded into the path; a connection without one fails fast, before any
//     upstream call;
//   - bearer auth, raw audio body, content type taken from the uploaded file;
//   - `diarize` is forwarded only when the client asks for it, `language` only
//     when non-blank;
//   - response_format=verbose_json returns words (with speaker when diarized),
//     one segment per run of the same speaker, num_speakers and usage;
//   - Cloudflare's `success:false` envelope (HTTP 200) and non-2xx responses
//     both become gateway errors.
//
// NOT pinned: exact JSON key order, Cloudflare account entitlements, daily
// neuron quota, and what the model hears (fixtures are synthetic).
import { describe, it, expect, vi, afterEach } from "vitest";

import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

// ── fixtures (synthetic: no real account, token or audio) ──────────────────

const STTCFG = {
  baseUrl: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run",
  authType: "apikey",
  authHeader: "bearer",
  format: "cloudflare-workers-ai",
};
const MODEL = "@cf/deepgram/nova-3";
const CRED = { apiKey: "cf-token-TEST", providerSpecificData: { accountId: "acct-TEST" } };

// Two speakers: A A A B B A (word-level, as Workers AI returns them).
const WORDS = [
  { word: "hello", punctuated_word: "Hello", start: 0.0, end: 0.4, speaker: 0 },
  { word: "there", punctuated_word: "there,", start: 0.4, end: 0.8, speaker: 0 },
  { word: "how", punctuated_word: "how", start: 0.8, end: 1.0, speaker: 0 },
  { word: "fine", punctuated_word: "Fine", start: 1.2, end: 1.6, speaker: 1 },
  { word: "thanks", punctuated_word: "thanks.", start: 1.6, end: 2.0, speaker: 1 },
  { word: "great", punctuated_word: "Great.", start: 2.2, end: 2.6, speaker: 0 },
];
const OK_BODY = {
  success: true,
  errors: [],
  messages: [],
  result: {
    usage: { neurons: 123.4 },
    results: {
      channels: [{ alternatives: [{ transcript: "Hello there, how Fine thanks. Great.", words: WORDS }] }],
    },
  },
};

function mkFile(type = "audio/webm") {
  return new File([new Uint8Array([1, 2, 3, 4])], "a.webm", { type });
}

function mkFormData(extra = {}, fileType) {
  const fd = new FormData();
  fd.set("file", mkFile(fileType));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

// Capture the outbound request so assertions read the real wire shape.
function stubFetch(body = OK_BODY, status = 200) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, opts) => {
    calls.push({ url: new URL(String(url && url.href ? url.href : url)), opts });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

async function run({ formData = mkFormData(), cfg = STTCFG, model = MODEL, credentials = CRED, transport } = {}) {
  return handleSttCore({ provider: "cloudflare-ai", model, formData, credentials, sttConfig: cfg, transport });
}

async function json(result) {
  return result.response.json();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── dispatch + auth ────────────────────────────────────────────────────────

describe("Cloudflare Workers AI STT dispatch", () => {
  it("posts raw audio to {baseUrl}/{model} with bearer auth and the file's content type", async () => {
    const calls = stubFetch();
    const result = await run();

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-TEST/ai/run/@cf/deepgram/nova-3",
    );
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer cf-token-TEST");
    expect(calls[0].opts.headers["Content-Type"]).toBe("audio/webm");
    expect(calls[0].opts.body.byteLength).toBe(4);
  });

  it("the account id is URL-encoded so it cannot rewrite the path", async () => {
    const calls = stubFetch();
    await run({ credentials: { apiKey: "t", providerSpecificData: { accountId: "a/../b?x=1" } } });

    expect(calls[0].url.pathname.startsWith("/client/v4/accounts/a%2F..%2Fb%3Fx%3D1/ai/run/")).toBe(true);
    expect(calls[0].url.search).not.toContain("x=1");
  });

  it("a connection without an account id fails before any upstream call", async () => {
    const calls = stubFetch();
    const result = await run({ credentials: { apiKey: "t", providerSpecificData: {} } });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/accountId/);
    expect(calls).toHaveLength(0);
  });

  it("the registry declares the model as stt and routes through sttConfig.format", async () => {
    const models = PROVIDER_MODELS["cf"] || PROVIDER_MODELS["cloudflare-ai"] || [];
    const entry = models.find((m) => m.id === MODEL);
    expect(entry).toBeTruthy();
    expect(entry.kind).toBe("stt");

    // No hardcoded model id in dispatch: any model id reaches the same transport.
    const calls = stubFetch();
    await run({ model: "@cf/deepgram/another-model" });
    expect(calls[0].url.pathname.endsWith("/ai/run/@cf/deepgram/another-model")).toBe(true);
  });
});

// ── request params ─────────────────────────────────────────────────────────

describe("Workers AI request params", () => {
  it("sends no diarize by default and always asks for punctuation", async () => {
    const calls = stubFetch();
    await run();

    expect(calls[0].url.searchParams.get("diarize")).toBeNull();
    expect(calls[0].url.searchParams.get("punctuate")).toBe("true");
  });

  it("forwards diarize only when the client sends a truthy value", async () => {
    for (const [value, expected] of [["true", "true"], ["1", "true"], ["false", null], ["", null]]) {
      const calls = stubFetch();
      await run({ formData: mkFormData({ diarize: value }) });
      expect(calls[0].url.searchParams.get("diarize")).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  it("forwards a non-blank language and omits a blank one", async () => {
    let calls = stubFetch();
    await run({ formData: mkFormData({ language: "pt" }) });
    expect(calls[0].url.searchParams.get("language")).toBe("pt");

    vi.unstubAllGlobals();
    calls = stubFetch();
    await run({ formData: mkFormData({ language: "  " }) });
    expect(calls[0].url.searchParams.get("language")).toBeNull();
  });

  it("client-only fields never reach the provider", async () => {
    const calls = stubFetch();
    await run({ formData: mkFormData({ response_format: "verbose_json", model: "x", temperature: "0.2" }) });

    expect(calls[0].url.searchParams.get("response_format")).toBeNull();
    expect(calls[0].url.searchParams.get("temperature")).toBeNull();
  });
});

// ── response mapping ───────────────────────────────────────────────────────

describe("response_format mapping", () => {
  it("default response is just {text}", async () => {
    stubFetch();
    const body = await json(await run());

    expect(body).toEqual({ text: "Hello there, how Fine thanks. Great." });
  });

  it("verbose_json returns words with speaker, segments per speaker run, num_speakers and usage", async () => {
    stubFetch();
    const body = await json(await run({ formData: mkFormData({ diarize: "true", response_format: "verbose_json", language: "pt" }) }));

    expect(body.text).toBe("Hello there, how Fine thanks. Great.");
    expect(body.language).toBe("pt");
    expect(body.duration).toBe(2.6);
    expect(body.words).toHaveLength(6);
    expect(body.words[0]).toEqual({ word: "Hello", start: 0.0, end: 0.4, speaker: 0 });
    expect(body.num_speakers).toBe(2);
    expect(body.usage).toEqual({ neurons: 123.4 });

    // A A A | B B | A  -> three segments, in order, with the span of each run.
    expect(body.segments.map((s) => s.speaker)).toEqual([0, 1, 0]);
    expect(body.segments[0]).toMatchObject({ id: 0, start: 0.0, end: 1.0, text: "Hello there, how" });
    expect(body.segments[1]).toMatchObject({ id: 1, start: 1.2, end: 2.0, text: "Fine thanks." });
    expect(body.segments[2]).toMatchObject({ id: 2, start: 2.2, end: 2.6, text: "Great." });
  });

  it("without speaker labels verbose_json has words but no segments or num_speakers", async () => {
    const noSpeakers = {
      ...OK_BODY,
      result: {
        ...OK_BODY.result,
        results: { channels: [{ alternatives: [{ transcript: "hi", words: [{ word: "hi", start: 0, end: 0.3 }] }] }] },
      },
    };
    stubFetch(noSpeakers);
    const body = await json(await run({ formData: mkFormData({ response_format: "verbose_json" }) }));

    expect(body.words).toEqual([{ word: "hi", start: 0, end: 0.3 }]);
    expect(body.segments).toBeUndefined();
    expect(body.num_speakers).toBeUndefined();
  });

  it("an empty result is an empty transcript, not a crash", async () => {
    stubFetch({ success: true, errors: [], messages: [], result: { results: { channels: [] } } });
    const body = await json(await run({ formData: mkFormData({ response_format: "verbose_json" }) }));

    expect(body.text).toBe("");
    expect(body.words).toEqual([]);
    expect(body.duration).toBe(0);
  });

  it("null or malformed word entries are skipped", async () => {
    const dirty = {
      ...OK_BODY,
      result: { results: { channels: [{ alternatives: [{ transcript: "x", words: [null, 7, { word: "ok", start: 0, end: 1, speaker: 0 }] }] }] } },
    };
    stubFetch(dirty);
    const body = await json(await run({ formData: mkFormData({ response_format: "verbose_json" }) }));

    expect(body.words).toHaveLength(1);
    expect(body.words[0].word).toBe("ok");
  });
});

// ── errors ─────────────────────────────────────────────────────────────────

describe("Workers AI errors", () => {
  it("missing credentials short-circuit before any upstream call", async () => {
    const calls = stubFetch();
    const result = await run({ credentials: {} });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("HTTP 429 (daily neuron quota) passes the status through with the vendor message", async () => {
    stubFetch({ success: false, result: {}, messages: [], errors: [{ code: 4006, message: "daily free allocation used up" }] }, 429);
    const result = await run();

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("daily free allocation used up");
  });

  it("HTTP 408 (upstream timeout) passes the status through", async () => {
    stubFetch({ success: false, result: {}, messages: [], errors: [{ code: 3046, message: "Request timeout" }] }, 408);
    const result = await run();

    expect(result.success).toBe(false);
    expect(result.status).toBe(408);
  });

  it("success:false inside an HTTP 200 becomes a gateway error carrying the vendor code", async () => {
    stubFetch({ success: false, result: {}, messages: [], errors: [{ code: 4006, message: "quota" }] }, 200);
    const result = await run();

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("4006");
  });
});
