import { Buffer } from "node:buffer";

// Gemini Live API realtime STT transport.
//
// The REST generateContent path (sttCore.transcribeGemini) only transcribes
// whole files inline. The Live API's `:bidiGenerateContent` WebSocket is the
// streaming counterpart: audio goes up as realtimeInput mediaChunks and the
// server pushes incremental `serverContent.inputTranscription` events back.
// This module owns the socket lifecycle only — envelope/response shaping
// stays in sttCore so the engine's single STT exit shape is preserved.
//
// Marker contract: dispatched from sttCore's format-switch when the model
// entry carries `transport: "gemini-live"` (registry) or the caller passes a
// transport string (custom models). Never keyed on a hardcoded model id here.
//
// Transport behavior:
//   - Node >= 22 global WebSocket (undici). No new dependency.
//   - Live API expects low-latency PCM; other containers are forwarded with
//     their declared MIME unchanged (provider-side rejection is surfaced).
//   - Text accumulation is append-only over inputTranscription segments and
//     ends on serverContent.turnComplete (or graceful close with partial text).
//   - Transcription deltas are kept per-frame (chunks[]) so sttCore can shape
//     verbose_json segments without fabricating timestamps. goAway advisements
//     rotate the socket once per call: setup replay + byte-offset resume.

const SETUP_TIMEOUT_MS = 10_000;  // open → setupComplete
const TURN_TIMEOUT_MS = 60_000;   // audio streamed → turnComplete
const MAX_TIMEOUT_MS = 300_000;   // clamp ceiling for client-supplied lifecycle knobs
const CHUNK_BYTES = 16_384;       // ~0.5s of 16-bit 16kHz mono PCM
const GOAWAY_RECONNECTS = 1;      // socket rotations honoured per call

class GeminiLiveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GeminiLiveError";
    this.status = status || 502;
  }
}

// REST base (https://host/v1beta/models) → Live WS base
// (wss://host/ws/api/v1beta/models), then the bidiGenerateContent endpoint.
function toLiveWsUrl(baseUrl, model, token) {
  const url = new URL(baseUrl);
  url.protocol = "wss:";
  if (!url.pathname.startsWith("/ws/")) url.pathname = `/ws/api${url.pathname}`;
  const base = url.toString().replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(model)}:bidiGenerateContent?key=${encodeURIComponent(token || "")}`;
}

// Bind socket events supporting BOTH handler styles: addEventListener
// (browser WebSocket, undici) and onopen/onmessage property assignment
// (minimal polyfills). Whichever the implementation exposes, it works.
function bindSocket(ws, { onOpen, onMessage, onError, onClose }) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
    return;
  }
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onerror = onError;
  ws.onclose = onClose;
}

function parseFrame(data) {
  try {
    return JSON.parse(typeof data === "string" ? data : String(data));
  } catch {
    return null; // non-JSON frames carry no Live API semantics
  }
}

function firstStringField(formData, key) {
  const v = typeof formData?.get === "function" ? formData.get(key) : null;
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

// Lifecycle knobs the live registry entry advertises in params[]
// (setup/turn timeouts). They ride the same formData pass-through sttCore
// gives every transport — no sttCore change needed to reach this leaf.
function firstNumberField(formData, key, fallback) {
  const n = Number(firstStringField(formData, key));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TIMEOUT_MS) : fallback;
}

/**
 * Transcribe an audio File via the Gemini Live bidirectional stream.
 * @returns {Promise<{text: string, chunks: string[]}>} transcript plus the raw
 *   incremental inputTranscription deltas (sttCore shapes verbose_json from them).
 * @throws {GeminiLiveError} with .status for the sttCore error envelope.
 */
export async function transcribeGeminiLive({ cfg, file, model, token, formData, mimeType }) {
  const WS = globalThis.WebSocket;
  if (!WS) throw new GeminiLiveError("Gemini Live transport needs global WebSocket (Node >= 22)", 502);

  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) throw new GeminiLiveError("Empty audio file", 400);

  const instruction = firstStringField(formData, "prompt") || "Transcribe the spoken audio verbatim.";
  const language = firstStringField(formData, "language");
  const setupTimeoutMs = firstNumberField(formData, "setup_timeout_ms", SETUP_TIMEOUT_MS);
  const turnTimeoutMs = firstNumberField(formData, "turn_timeout_ms", TURN_TIMEOUT_MS);
  // system_instruction (registry param) overrides the built-in transcription
  // directive wholesale; prompt/language only shape the default.
  const instructionOverride = firstStringField(formData, "system_instruction");
  const systemText = instructionOverride
    || (language ? `${instruction} Language: ${language}.` : instruction);
  const wsUrl = toLiveWsUrl(cfg.baseUrl, model, token);

  return await new Promise((resolve, reject) => {
    let text = "";
    const chunks = [];        // raw inputTranscription deltas, shaped by sttCore
    let settled = false;
    let timer = null;
    let goAwayTimer = null;
    let ws = null;
    let generation = 0;       // socket identity: superseded closes never settle
    let sentBytes = 0;        // audio prefix already handed to the live socket
    let goAwayReconnects = GOAWAY_RECONNECTS;

    const arm = (ms, message) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(new GeminiLiveError(message, 504)), ms);
    };
    const shutdown = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (goAwayTimer) { clearTimeout(goAwayTimer); goAwayTimer = null; }
      // ws is null until the first open() dials (and stays null when the
      // constructor throws) — fail() runs shutdown() on that path.
      if (!ws) return;
      try {
        if (ws.readyState === WS.OPEN || ws.readyState === WS.CONNECTING) ws.close(1000);
      } catch { /* socket already dead — outcome is already settled */ }
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      shutdown();
      resolve({ text, chunks });
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      shutdown();
      reject(err);
    };
    const send = (frame) => {
      if (ws.readyState !== WS.OPEN) return false;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        return false; // socket died mid-send — streamAudioAndPrompt maps this to a 502
      }
      return true;
    };

    // Streams every byte not yet sent, then the flushing text turn. After a
    // goAway rotation this resumes from sentBytes — no audio re-upload.
    const streamAudioAndPrompt = () => {
      for (let off = sentBytes; off < buf.length; off += CHUNK_BYTES) {
        const mediaChunk = buf.subarray(off, off + CHUNK_BYTES).toString("base64");
        if (!send({ realtimeInput: { mediaChunks: [{ mimeType, data: mediaChunk }] } })) {
          fail(new GeminiLiveError("Gemini Live socket closed while streaming audio", 502));
          return;
        }
        sentBytes = Math.min(off + CHUNK_BYTES, buf.length);
      }
      // Final user turn: flushes the recognizer and yields turnComplete.
      send({ clientContent: { turns: [{ parts: [{ text: systemText }] }], turnComplete: true } });
    };

    // goAway: the server names the instant it will force-close this socket.
    // Graceful play = rotate BEFORE the deadline: retire the live socket,
    // dial a fresh one, replay setup, resume audio from sentBytes — text and
    // chunks survive the hop. Once the advisory budget is spent a later
    // goAway is left to the close path, which settles on partial transcript.
    const scheduleGoAwayReconnect = (goAway) => {
      if (settled || goAwayTimer || goAwayReconnects <= 0) return;
      const deadline = Date.parse(typeof goAway?.time === "string" ? goAway.time : "");
      const delay = Number.isFinite(deadline)
        ? Math.max(0, Math.min(deadline - Date.now(), setupTimeoutMs))
        : 0;
      goAwayTimer = setTimeout(() => {
        goAwayTimer = null;
        if (settled) return;
        goAwayReconnects--;
        generation++;
        try { ws?.close(1000); } catch { /* deadline crossed mid-flight — re-dial anyway */ }
        open();
      }, delay);
    };

    const open = () => {
      const gen = ++generation;
      try {
        ws = new WS(wsUrl);
      } catch {
        fail(new GeminiLiveError("Gemini Live websocket connection failed", 502));
        return;
      }
      bindSocket(ws, {
        onOpen: () => {
          if (settled || gen !== generation) return;
          arm(setupTimeoutMs, "Gemini Live timed out waiting for setupComplete");
          send({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ["TEXT"],
                inputAudioTranscription: {},
              },
              systemInstruction: { parts: [{ text: systemText }] },
            },
          });
        },
        onMessage: (ev) => {
          if (settled || gen !== generation) return;
          const frame = parseFrame(ev?.data);
          if (!frame) return;

          if (frame.error) {
            const e = frame.error;
            fail(new GeminiLiveError(`Gemini Live error${e.status ? ` (${e.status})` : ""}: ${e.message || "unknown"}`, 502));
            return;
          }
          if (frame.goAway) {
            scheduleGoAwayReconnect(frame.goAway);
            return;
          }

          const sc = frame.serverContent;
          if (!sc) return;

          const delta = typeof sc.inputTranscription?.text === "string" ? sc.inputTranscription.text : "";
          // Trim before testing: a padding-only frame carries no transcript and
          // must not make an empty run look like a partial success on close.
          if (delta.trim()) {
            text += delta;
            chunks.push(delta);
          }

          if (sc.setupComplete) {
            arm(turnTimeoutMs, "Gemini Live transcription timed out");
            streamAudioAndPrompt();
            return;
          }
          if (sc.turnComplete) succeed();
        },
        onError: () => {
          if (settled || gen !== generation) return;
          fail(new GeminiLiveError("Gemini Live websocket connection failed", 502));
        },
        onClose: (ev) => {
          if (settled || gen !== generation) return;
          // Partial transcript beats a hard error on graceful close; silence is one.
          if (text.trim()) succeed();
          else fail(new GeminiLiveError(`Gemini Live socket closed before completion${ev?.code ? ` (code ${ev.code})` : ""}`, 502));
        },
      });
    };

    open();
  });
}
