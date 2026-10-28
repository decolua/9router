// Scenario: an OpenAI-compatible transcription proxy must expose the provider's
// speaker diarization: accept the client's diarization option, forward it to the
// provider with diarization enabled, and return speaker-labeled segments when the
// client asks for a verbose response.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nodeHttp from "node:http";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

// The real Next server answers the public paths: routing, the /v1 → /api/v1
// rewrite and the app-router convention all stay out of the test's hands.
const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "9router-dg-stt-"));
process.env.DATA_DIR = DATA_DIR;
process.env.NEXT_TELEMETRY_DISABLED = "1";

let app;
let server;
let origin;
let upstream;
let upstreamOrigin;
let upstreamCalls;

const FULL_TRANSCRIPT = "hello world and more";
const PLAIN_FIXTURE = {
  metadata: { duration: 8.04 },
  results: { channels: [{ alternatives: [{ transcript: FULL_TRANSCRIPT, confidence: 0.99 }] }] },
};
const DIARIZED_FIXTURE = {
  metadata: { duration: 8.04 },
  results: {
    channels: [{ alternatives: [{ transcript: FULL_TRANSCRIPT, confidence: 0.99 }] }],
    utterances: [
      { start: 0, end: 3.62, confidence: 0.98, transcript: "hello world", speaker: 0 },
      { start: 4.1, end: 7.9, confidence: 0.97, transcript: "and more", speaker: 1 },
    ],
  },
};

// A deliberately hostile payload: a null entry (which must not throw) followed
// by an utterance with no `end` (which must not drop the duration key).
const MALFORMED_FIXTURE = {
  metadata: { duration: 8.04 },
  results: {
    channels: [{ alternatives: [{ transcript: FULL_TRANSCRIPT, confidence: 0.99 }] }],
    utterances: [
      { start: 0, end: 5, confidence: 0.98, transcript: "first", speaker: 0 },
      null,
      { start: 6, confidence: 0.97, transcript: "second", speaker: 1 },
    ],
  },
};

const AUDIO_BYTES = new Uint8Array([1, 2, 3, 4]);

const DEEPGRAM_PARAMS = new Set([
  "model", "smart_format", "punctuate", "language", "detect_language",
  "diarize", "diarize_model", "utterances",
]);

// Stands in for api.deepgram.com on loopback: rejects any query parameter the
// real API does not know, answers with speaker utterances only when diarization
// was asked for, and records the request body, so a leaked client field, a
// missing forward or a touched audio payload fails deterministically without
// ever leaving the machine.
function installDeepgramStub() {
  upstreamCalls = [];
  return upstreamCalls;
}

beforeAll(async () => {
  upstream = nodeHttp.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    upstreamCalls.push(u);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      u.body = Buffer.concat(chunks);
      let status = 200;
      let payload = PLAIN_FIXTURE;
      const leaked = [...u.searchParams.keys()].find((k) => !DEEPGRAM_PARAMS.has(k));
      if (leaked) {
        status = 400;
        payload = { error: { message: `Unknown query parameter: ${leaked}` } };
      } else if (u.searchParams.get("diarize") === "true" && u.searchParams.get("utterances") === "true") {
        payload = DIARIZED_FIXTURE;
      } else if (u.searchParams.get("language") === "xx") {
        payload = MALFORMED_FIXTURE;
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
  upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  installDeepgramStub();

  // Dependencies are faked only where they would leave the process: a throwaway
  // database holds the settings plus one Deepgram key pointed at the loopback
  // provider above. Everything between the client and the handler is the real app.
  const { updateSettings, createProviderConnection } = await import("@/lib/localDb");
  await updateSettings({ requireApiKey: false });
  await createProviderConnection({
    provider: "deepgram", authType: "apikey", name: "unit-test", apiKey: "test-key",
    isActive: true, providerSpecificData: { baseUrl: upstreamOrigin },
  });

  const next = (await import("next")).default;
  app = next({ dir: REPO_ROOT, dev: true, quiet: true });
  await app.prepare();
  const handle = app.getRequestHandler();
  server = nodeHttp.createServer((req, res) => handle(req, res));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;

  // The first request compiles the route, and while it compiles the dev server
  // can drop the multipart body. Warm the endpoint before any test pays for it.
  let warm;
  for (let attempt = 0; attempt < 10; attempt++) {
    warm = await transcribe({ language: "en" });
    if (warm.status === 200) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`transcription endpoint never answered 200: ${warm?.status}`);
}, 300_000);

afterAll(async () => {
  try {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((closed, failed) => server.close((err) => (err ? failed(err) : closed())));
      }
      if (upstream) {
        upstream.closeAllConnections();
        await new Promise((closed, failed) => upstream.close((err) => (err ? failed(err) : closed())));
      }
    } finally {
      if (app) await app.close();
    }
  } finally {
    nodeFs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
});

function makeForm(fields) {
  const fd = new FormData();
  fd.append("file", new File([AUDIO_BYTES], "audio.wav", { type: "audio/wav" }));
  fd.append("model", "dg/nova-3");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

// Expected upstream bodies for n dispatched requests: the audio payload must
// reach the provider untouched, one entry per call so the count is pinned too.
const audioBodies = (n) => Array.from({ length: n }, () => [...AUDIO_BYTES]);

async function http(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  return { status: response.status, body: await response.json() };
}

const transcribe = (fields) =>
  http("/v1/audio/transcriptions", { method: "POST", body: makeForm(fields) });
const catalog = (id) => http(`/v1/models/info?id=${encodeURIComponent(id)}`);

describe("deepgram diarization via the transcription endpoint", () => {
  it("enables diarization and leaves plain requests unchanged", async () => {
    const calls = installDeepgramStub();

    const r1 = await transcribe({ language: "en", diarize_model: "latest", response_format: "verbose_json" });
    expect(r1.status).toBe(200);
    const u1 = calls[0];
    expect(u1.searchParams.get("diarize")).toBe("true");
    expect(u1.searchParams.get("diarize_model")).toBe("latest");
    expect(u1.searchParams.get("utterances")).toBe("true");

    // a distinct model value must pass through verbatim, not collapse to a default
    await transcribe({ language: "en", diarize_model: "whisper", response_format: "verbose_json" });
    expect(calls[1].searchParams.get("diarize_model")).toBe("whisper");

    const r2 = await transcribe({ language: "en" });
    expect(r2.status).toBe(200);
    const u2 = calls[2];
    expect(u2.searchParams.get("model")).toBe("nova-3");
    expect(u2.searchParams.has("diarize")).toBe(false);
    expect(r2.body).toEqual({ text: FULL_TRANSCRIPT });

    // whitespace around a client value is trimmed before dispatch; the trimmed
    // diarize_model passthrough is proven in the no-format block below
    await transcribe({ language: " en ", diarize_model: " latest ", response_format: "verbose_json" });
    expect(calls[3].searchParams.get("language")).toBe("en");

    // every captured request carried exactly the audio bytes it was given
    expect(calls.map((c) => [...c.body])).toEqual(audioBodies(4));
  }, 120_000);

  it("returns speaker-labeled segments in verbose_json", async () => {
    const calls = installDeepgramStub();

    const r1 = await transcribe({ language: "en", diarize_model: "latest", response_format: "verbose_json" });
    expect(r1.status).toBe(200);
    expect(r1.body.text).toBe(FULL_TRANSCRIPT);
    expect(r1.body.duration).toBe(7.9);
    expect(r1.body.segments[0]).toEqual({ id: 0, start: 0, end: 3.62, text: "hello world", speaker: 0 });
    expect(r1.body.segments[1]).toEqual({ id: 1, start: 4.1, end: 7.9, text: "and more", speaker: 1 });

    // plain fixture without diarization: verbose_json still reports the full
    // transcript, a numeric duration from the response metadata, and no segments
    const r2 = await transcribe({ language: "en", response_format: "verbose_json" });
    expect(r2.body.text).toBe(FULL_TRANSCRIPT);
    expect(r2.body.duration).toBe(8.04);
    expect(r2.body.segments).toEqual([]);

    expect(calls.map((c) => [...c.body])).toEqual(audioBodies(2));
  }, 120_000);

  it("lists the diarization parameter in the model catalog", async () => {
    for (const id of ["dg/nova-3", "dg/nova-2", "dg/whisper-large", "dg/nova"]) {
      const res = await catalog(id);
      expect(res.status).toBe(200);
      expect(res.body.params).toContain("diarize_model");
    }
  }, 120_000);

  it("keeps unsupported client fields out of the upstream request", async () => {
    const calls = installDeepgramStub();

    const r1 = await transcribe({
      language: "en", prompt: "ctx", temperature: "0",
      diarize_model: "latest", response_format: "verbose_json",
    });
    expect(r1.status).toBe(200);
    expect(Object.keys(r1.body).sort()).toEqual(["duration", "segments", "text"]);

    // diarized upstream with no response_format asked for: the trimmed model
    // value still reaches the provider together with utterances=true, while the
    // dispatched body stays the bare transcript with segments held back
    const r2 = await transcribe({ diarize_model: " latest " });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ text: FULL_TRANSCRIPT });
    const u2 = calls[calls.length - 1];
    expect(u2.searchParams.get("diarize")).toBe("true");
    expect(u2.searchParams.get("diarize_model")).toBe("latest");
    expect(u2.searchParams.get("utterances")).toBe("true");
    expect(u2.searchParams.get("detect_language")).toBe("true");

    expect(calls.map((c) => [...c.body])).toEqual(audioBodies(2));
  }, 120_000);

  it("keeps duration numeric and segments well-formed on malformed utterances", async () => {
    const calls = installDeepgramStub();

    // The provider replies with a null utterance entry and a trailing utterance
    // that has no `end`. Neither may throw, and neither may drop a JSON key.
    const r = await transcribe({ language: "xx", response_format: "verbose_json" });
    expect(r.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(r.body, "duration")).toBe(true);
    expect(typeof r.body.duration).toBe("number");
    expect(Number.isFinite(r.body.duration)).toBe(true);

    // The null entry is dropped; the remaining two map to a stable shape.
    expect(r.body.segments).toHaveLength(2);
    for (const s of r.body.segments) {
      expect(Object.keys(s).sort()).toEqual(["end", "id", "speaker", "start", "text"]);
      expect(typeof s.start).toBe("number");
      expect(typeof s.end).toBe("number");
      expect(typeof s.speaker).toBe("number");
    }
    expect(r.body.segments[0].text).toBe("first");
    expect(r.body.segments[1].text).toBe("second");
    // Last surviving utterance has no `end`, so duration falls back to metadata.
    expect(r.body.duration).toBe(8.04);

    expect(calls.map((c) => [...c.body])).toEqual(audioBodies(1));
  }, 120_000);
});
