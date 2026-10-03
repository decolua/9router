// Gemini Live (realtime bidi) STT transport contract.
//
// Black-box tests against open-sse/handlers/sttCore.js. Wire observables only:
//   - transport marker drives dispatch (caller param / registry entry), never a
//     hardcoded model id;
//   - session opens with a setup frame declaring the model; audio rides
//     realtimeInput frames only AFTER the server's setup-complete ack;
//   - inputTranscription deltas accumulate into {text}; verbose_json adds
//     segments {id,text} with NO timing keys (protocol carries none);
//   - error frame → gateway error envelope (any 4xx/5xx, shape only);
//   - system_instruction / prompt override setup instruction (substring);
//   - client-supplied setup_timeout_ms (tiny) bounds the wait (error occurs);
//   - response_format never reaches the session setup;
//   - custom-model transport persists via POST /api/models/custom (whitelist)
//     with unknown values silently dropped;
//   - the persisted custom transport is resolved by the app layer (stt.js)
//     and reaches engine dispatch end-to-end (handleStt → WS, not REST).
//
// NOT pinned (unstated or implementation-only): goAway/reconnect semantics,
// timeout clamp ceilings, specific status codes, byte-exact WS URLs (only
// wss:// + bidiGenerateContent + model-id substrings), exact frame JSON paths.
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

// ── fixtures ──────────────────────────────────────────────────────────────

const STTCFG = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  authType: "apikey",
  authHeader: "key",
  format: "gemini-stt",
};
const CRED = { apiKey: "AIza-TEST" };

const LIVE_ID = "probe-live-capability-1";

function mkFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "a.wav", { type: "audio/wav" });
}

function mkFormData(extra = {}) {
  const fd = new FormData();
  fd.set("file", mkFile());
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

// ── fake WebSocket ────────────────────────────────────────────────────────

class FakeWS {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.sent = []; // JSON.parsed frames, in send order
    this.readyState = FakeWS.CONNECTING;
    this.closed = false;
    this.closeCalls = []; // {code, reason} recordings
    this._listeners = {};
    FakeWS.instances.push(this);
    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = FakeWS.OPEN;
      if (typeof this.onopen === "function") this.onopen({});
      (this._listeners.open || []).forEach((f) => f({}));
    });
  }

  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  // Fire a server frame through both supported binding styles.
  emit(obj) {
    const ev = { data: JSON.stringify(obj) };
    if (typeof this.onmessage === "function") this.onmessage(ev);
    (this._listeners.message || []).forEach((f) => f(ev));
  }

  // Fire a server-initiated close through both supported binding styles.
  // Distinct from close(), which only records the client-side shutdown.
  emitClose(code = 1000) {
    this.closed = true;
    this.readyState = FakeWS.CLOSED;
    const ev = { code, reason: "" };
    if (typeof this.onclose === "function") this.onclose(ev);
    (this._listeners.close || []).forEach((f) => f(ev));
  }

  close(code, reason) {
    this.closed = true;
    this.readyState = FakeWS.CLOSED;
    this.closeCalls.push({ code: code ?? 1000, reason: reason ?? "" });
  }
}

function stubWs() {
  vi.stubGlobal("WebSocket", FakeWS);
}

// Fetch spy that records calls; handler defaults to "REST must not happen".
function stubFetch(handler = () => { throw new Error("REST must not be used for live transport"); }) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, opts) => {
    calls.push(String(url && url.url ? url.url : url));
    return handler(url, opts);
  });
  return calls;
}

// Server drives a completed session: setup ack → transcription deltas → turn done.
function serverScript(instance, texts) {
  instance.emit({ serverContent: { setupComplete: true } });
  for (const t of texts) instance.emit({ serverContent: { inputTranscription: { text: t } } });
  instance.emit({ serverContent: { turnComplete: true } });
}

async function liveSession({ model = LIVE_ID, formData = mkFormData(), transport = "gemini-live" } = {}) {
  stubWs();
  const fetchCalls = stubFetch();
  const pending = handleSttCore({ provider: "gemini", model, formData, credentials: CRED, sttConfig: STTCFG, transport });
  await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
  const ws = FakeWS.instances[0];
  await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(1)); // setup frame sent
  return { pending, ws, fetchCalls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWS.instances.length = 0;
});

// ── S1/S2/S3: transport marker dispatch, text envelope, no REST ───────────

describe("Live transport dispatch via caller marker", () => {
  it("T3: transport 'gemini-live' opens a WebSocket, never REST; text = accumulated deltas", async () => {
    // REST-fallback contrast (folded from T1): a live-capability id with no
    // transport marker falls to REST and fails cleanly — the live path is opt-in.
    stubFetch(() => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "live models require the streaming endpoint" } }),
    }));
    const restResult = await handleSttCore({
      provider: "gemini",
      model: LIVE_ID,
      formData: mkFormData(),
      credentials: CRED,
      sttConfig: STTCFG,
    });
    expect(restResult.success).toBe(false);

    // Caller-marker dispatch: explicit transport "gemini-live" opens the WS,
    // never REST; text = accumulated inputTranscription deltas.
    const { pending, ws, fetchCalls } = await liveSession();
    serverScript(ws, ["hello ", "world"]);
    const result = await pending;
    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toEqual({ text: "hello world" });
    expect(fetchCalls).toHaveLength(0);

    // Registry-marker dispatch: the live entry's transport field alone — no
    // caller transport param — routes to the WS path; id derived from the
    // registry, never a literal.
    const regId = (PROVIDER_MODELS.gemini || []).find(
      (m) => m && m.kind === "stt" && m.transport === "gemini-live",
    )?.id;
    FakeWS.instances.length = 0;
    stubWs();
    const regFetchCalls = stubFetch();
    const regPending = handleSttCore({
      provider: "gemini",
      model: regId,
      formData: mkFormData(),
      credentials: CRED,
      sttConfig: STTCFG,
    });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const regWs = FakeWS.instances[0];
    await vi.waitFor(() => expect(regWs.sent.length).toBeGreaterThanOrEqual(1));
    serverScript(regWs, ["reg ", "live"]);
    const regResult = await regPending;
    expect(regResult.success).toBe(true);
    await expect(regResult.response.json()).resolves.toEqual({ text: "reg live" });
    expect(regFetchCalls).toHaveLength(0);
  });

  it("T4: setup frame first (carries model id); audio only in realtimeInput at index >=1; WS URL is the bidi endpoint", async () => {
    const { pending, ws, fetchCalls } = await liveSession();
    const setup = ws.sent[0];
    expect(setup.setup).toBeTruthy();
    expect(JSON.stringify(setup.setup)).toContain(LIVE_ID);
    expect(setup.realtimeInput).toBeUndefined();

    serverScript(ws, ["x"]);
    const result = await pending;
    expect(result.success).toBe(true);
    expect(fetchCalls).toHaveLength(0);

    const audioIdx = ws.sent.findIndex((f) => f.realtimeInput);
    expect(audioIdx).toBeGreaterThanOrEqual(1);
    const media = ws.sent[audioIdx].realtimeInput.mediaChunks;
    expect(Array.isArray(media)).toBe(true);
    expect(typeof media[0].data).toBe("string");
    expect(media[0].data.length).toBeGreaterThan(0);
    expect(Buffer.from(media[0].data, "base64").length).toBeGreaterThan(0);

    expect(ws.url).toContain("wss://");
    expect(ws.url).toContain("bidiGenerateContent");
    expect(ws.url).toContain(LIVE_ID);

    // REST contrast (folded from T2): an ordinary gemini model still transcribes
    // over REST generateContent — the live path is opt-in, never the default.
    stubFetch(() => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "hello rest" }] } }] }),
      text: async () => "",
    }));
    const restResult = await handleSttCore({
      provider: "gemini",
      model: "gemini-2.0-flash",
      formData: mkFormData(),
      credentials: CRED,
      sttConfig: STTCFG,
    });
    expect(restResult.success).toBe(true);
    await expect(restResult.response.json()).resolves.toEqual({ text: "hello rest" });
  });

  it("T5: server error frame yields the gateway error envelope (any 4xx/5xx, no text pin)", async () => {
    const { pending, ws } = await liveSession();
    ws.emit({ error: { code: "X", message: "Y" } });
    const result = await pending;
    expect(result.success).toBe(false);
    expect(typeof result.status).toBe("number");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThanOrEqual(599);
  });
});

// ── S7: client knobs (instruction overrides ride the setup frame) ─────────

describe("Setup frame knobs", () => {
  it("T6: client prompt overrides the setup instruction", async () => {
    const { pending, ws } = await liveSession({ formData: mkFormData({ prompt: "Say it back" }) });
    const setupJson = JSON.stringify(ws.sent[0]);
    expect(setupJson).toContain("Say it back");
    serverScript(ws, ["ok"]);
    const result = await pending;
    expect(result.success).toBe(true);
  });

  it("T7: system_instruction override appears in the setup frame", async () => {
    const { pending, ws } = await liveSession({ formData: mkFormData({ system_instruction: "TRANSCRIBE-VERBATIM-OVERRIDE-42" }) });
    const setupJson = JSON.stringify(ws.sent[0]);
    expect(setupJson).toContain("TRANSCRIBE-VERBATIM-OVERRIDE-42");
    serverScript(ws, ["ok"]);
    const result = await pending;
    expect(result.success).toBe(true);
  });

  it("T8: response_format is client-only and never reaches the session setup", async () => {
    const { pending, ws } = await liveSession({ formData: mkFormData({ response_format: "verbose_json" }) });
    expect(JSON.stringify(ws.sent[0])).not.toContain("response_format");
    serverScript(ws, ["a", "b"]);
    const result = await pending;
    expect(result.success).toBe(true);
  });

  it("T9: tiny setup_timeout_ms with no server ack errors out within the bound", async () => {
    const { pending } = await liveSession({ formData: mkFormData({ setup_timeout_ms: "5" }) });
    // deliberately emit nothing — the client knob must end the wait
    const result = await pending;
    expect(result.success).toBe(false);
    expect(typeof result.status).toBe("number");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThanOrEqual(599);
  });
});

// ── S8: verbose_json shaping ──────────────────────────────────────────────

describe("Response shaping", () => {
  it("T10: verbose_json adds {id,text} segments in arrival order with NO timing fields", async () => {
    const { pending, ws } = await liveSession({ formData: mkFormData({ response_format: "verbose_json" }) });
    serverScript(ws, ["hello ", "world"]);
    const result = await pending;
    const body = await result.response.json();
    expect(body.text).toBe("hello world");
    expect(Array.isArray(body.segments)).toBe(true);
    expect(body.segments).toHaveLength(2);
    const [s0, s1] = body.segments;
    expect(s0.id).toBe(0);
    expect(s1.id).toBe(1);
    for (const seg of body.segments) {
      expect(Object.keys(seg)).toContain("id");
      expect(Object.keys(seg)).toContain("text");
      expect("start" in seg).toBe(false);
      expect("end" in seg).toBe(false);
      expect("duration" in seg).toBe(false);
    }
    expect(s0.text).toBe("hello ");
    expect(s1.text).toBe("world");
    expect("duration" in body).toBe(false);
  });

  it("T11: default format carries text only, no segments", async () => {
    const { pending, ws } = await liveSession();
    serverScript(ws, ["one", "two"]);
    const result = await pending;
    const body = await result.response.json();
    expect(Object.keys(body)).toContain("text");
    expect("segments" in body).toBe(false);
  });
});

// ── S2a: registry marks the live family (data, not code) ─────────────────

describe("Registry family marking", () => {
  it("T12: gemini stt catalog includes a live-transport entry advertising the lifecycle params", () => {
    const live = (PROVIDER_MODELS.gemini || []).find(
      (m) => m && m.kind === "stt" && m.transport === "gemini-live",
    );
    expect(live).toBeTruthy();
    expect(live.id).toBeTruthy();
    expect(Array.isArray(live.params)).toBe(true);
    for (const p of ["language", "prompt", "system_instruction", "setup_timeout_ms", "turn_timeout_ms"]) {
      expect(live.params).toContain(p);
    }
  });
});

// ── S2b: custom-model transport persistence (route level) ─────────────────

describe("Custom-model transport persistence via POST /api/models/custom", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    // paths.js freezes DATA_DIR at module load — re-evaluate the db chain per test
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-gemini-live-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
  });

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function postCustom(payload) {
    const { POST } = await import("@/app/api/models/custom/route.js");
    const res = await POST({ json: async () => payload });
    return res.json();
  }

  async function customRows() {
    const { getCustomModels } = await import("@/lib/db/repos/aliasRepo.js");
    return getCustomModels();
  }

  it("T13: whitelisted transport persists on the saved row", { timeout: 30000 }, async () => {
    const body = await postCustom({
      providerAlias: "gemini",
      id: "probe-custom-capability-9",
      type: "stt",
      transport: "gemini-live",
    });
    expect(body.success).toBe(true);
    const row = (await customRows()).find((m) => m && m.providerAlias === "gemini" && m.id === "probe-custom-capability-9");
    expect(row).toBeTruthy();
    expect(row.type).toBe("stt");
    expect(row.transport).toBe("gemini-live");
  });

  it("T14: unknown transport is silently dropped — prior whitelisted transport survives re-save", { timeout: 30000 }, async () => {
    const first = await postCustom({
      providerAlias: "gemini",
      id: "probe-custom-capability-10",
      type: "stt",
      transport: "gemini-live",
    });
    expect(first.success).toBe(true);
    // Re-saving the same model with an unknown transport must not clobber
    // the persisted marker: silent-drop keeps the stored value (merge keeps
    // omitted fields, per addCustomModel).
    const second = await postCustom({
      providerAlias: "gemini",
      id: "probe-custom-capability-10",
      type: "stt",
      transport: "nope",
    });
    expect(second.success).toBe(true);
    const row = (await customRows()).find((m) => m && m.providerAlias === "gemini" && m.id === "probe-custom-capability-10");
    expect(row).toBeTruthy();
    expect(row.transport).toBe("gemini-live");
  });
});

// ── S2c (T15): app-layer custom-transport resolution, end-to-end ─────────
//
// Gate C M1 closure. Only handleStt (src/sse/handlers/stt.js) maps a
// persisted custom-model transport onto the handleSttCore dispatch; T13/T14
// stop at repo persistence. Fake model id is absent from the registry, so a
// WebSocket opening here is observable proof the caller-supplied transport
// marker was resolved and passed — deleting that resolution fails T15.

describe("App-layer custom transport resolution (stt.js)", () => {
  it("T15: persisted custom gemini-live transport reaches WS dispatch through real handleStt", async () => {
    const LOCALDB = "@/lib/localDb";
    const AUTH = "../../src/sse/services/auth.js";
    try {
      vi.resetModules();
      vi.doMock(LOCALDB, () => ({
        getSettings: async () => ({ requireApiKey: false }),
        getCustomModels: async () => ([{
          providerAlias: "gemini", id: "probe-sttjs-1", type: "stt", transport: "gemini-live",
        }]),
      }));
      vi.doMock(AUTH, () => ({
        extractApiKey: () => null,
        isValidApiKey: async () => true,
        getProviderCredentials: async () => ({
          apiKey: "AIza-TEST", connectionId: "c1", connectionName: "t", providerSpecificData: {},
        }),
        markAccountUnavailable: async () => ({ shouldFallback: false }),
      }));
      // getModelInfo stays REAL: "gemini/..." is a reserved-prefix passthrough,
      // so the parse→route hop in the chain is exercised, not stubbed.
      const { handleStt } = await import("../../src/sse/handlers/stt.js");

      stubWs();
      const fetchCalls = stubFetch(); // default handler throws: REST must not happen
      const fd = mkFormData();
      fd.set("model", "gemini/probe-sttjs-1");

      const pending = handleStt({ formData: async () => fd });
      await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
      const ws = FakeWS.instances[0];
      await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(1)); // setup first
      serverScript(ws, ["hello ", "world"]);
      const res = await pending;
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.text).toBe("hello world");
      expect(fetchCalls).toHaveLength(0);
    } finally {
      vi.doUnmock(LOCALDB);
      vi.doUnmock(AUTH);
    }
  });
});

// ── S5/S6/S9: lifecycle gates (setup ack, turn timeout, turn completion) ──

// Setup/turn gating, graceful close, and transcript accumulation hygiene:
// padding-only frames are dropped, and a whitespace-only run is a failure
// rather than a blank success.
describe("Lifecycle gates", () => {
  it("T16: audio streaming waits for the server setup-complete reply", async () => {
    const { pending, ws } = await liveSession();
    // deliberately do NOT emit setupComplete
    await new Promise((r) => setTimeout(r, 80));
    const audioFrames = ws.sent.filter((f) => f.realtimeInput);
    expect(audioFrames).toHaveLength(0);
    // clean up: let the pending promise settle so afterEach unstub works cleanly
    ws.emit({ serverContent: { setupComplete: true } });
    ws.emit({ serverContent: { turnComplete: true } });
    await pending;
  });

  it("T17: tiny turn_timeout_ms with setup-complete but no turn-complete errors out", async () => {
    const { pending, ws } = await liveSession({ formData: mkFormData({ turn_timeout_ms: "5" }) });
    ws.emit({ serverContent: { setupComplete: true } });
    // deliberately do NOT emit turnComplete
    const result = await pending;
    expect(result.success).toBe(false);
    expect(typeof result.status).toBe("number");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThanOrEqual(599);
  });

  it("T18: server turnComplete closes the WebSocket gracefully", async () => {
    const { pending, ws } = await liveSession();
    serverScript(ws, ["done"]);
    await pending;
    expect(ws.closeCalls.length).toBeGreaterThanOrEqual(1);
    expect(ws.closeCalls[0].code).toBe(1000);
  });

  it("T19: whitespace-only transcription frames are not appended to the transcript", async () => {
    const { pending, ws } = await liveSession();
    ws.emit({ serverContent: { setupComplete: true } });
    // a padding-only frame must contribute nothing to the transcript
    ws.emit({ serverContent: { inputTranscription: { text: "   " } } });
    ws.emit({ serverContent: { inputTranscription: { text: "done" } } });
    ws.emit({ serverContent: { turnComplete: true } });
    const result = await pending;
    const body = await result.response.json();
    expect(body.text).toBe("done");
  });

  it("T20: a run that receives only whitespace frames errors instead of returning a blank transcript", async () => {
    const { pending, ws } = await liveSession();
    ws.emit({ serverContent: { setupComplete: true } });
    ws.emit({ serverContent: { inputTranscription: { text: "   " } } });
    // server closes before any real transcript arrived: a partial success would
    // hand the client a whitespace-only transcript
    ws.emitClose(1000);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(typeof result.status).toBe("number");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThanOrEqual(599);
  });
});
