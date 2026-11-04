/**
 * Real capability probing for a single model.
 *
 * Every capability here is decided by an ACTUAL upstream request through the
 * local gateway — never by reading a static capability table. That is the whole
 * point of this module: `open-sse/providers/capabilities.js` tells you what a
 * model *claims*, this tells you what it *does*.
 *
 * Throughput matters as much as correctness: the catalog runs to thousands of
 * models, so a design that costs three serialised requests per model turns a
 * sweep into an afternoon. Three things keep it fast:
 *
 *  1. The tool probe doubles as the chat probe. A tool request IS a chat
 *     request, so a successful completion proves reachability and there is no
 *     separate gate to wait on.
 *  2. Capability probes run concurrently, and a hard failure on the primary
 *     (auth, not-found) aborts the rest instead of paying for calls whose
 *     answer is already known.
 *  3. Auth headers are resolved once and reused, rather than re-read from the
 *     database for every request of every model.
 */

import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_SALT = "9r-cli-auth";

// 1x1 transparent PNG. Small enough that no provider bills meaningfully for it,
// but a real image payload so vision routing is genuinely exercised.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * A short silent WAV, base64-encoded, built once at module load.
 *
 * Generated rather than inlined so the payload stays obviously minimal: 120ms of
 * 8kHz mono silence is ~2KB of base64, enough to be a valid decodable file
 * without shipping a large constant or billing for real audio minutes.
 */
const TINY_WAV_BASE64 = (() => {
  const sampleRate = 8000;
  const durationMs = 120;
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = sampleCount * 2; // mono, 16-bit
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  // Samples stay zero — silence is a valid audio file and costs nothing to read.

  return buffer.toString("base64");
})();

/**
 * A model that needs longer than this to emit a handful of tokens is not a
 * usable fallback anyway. Every second here is a second the whole sweep can be
 * stuck waiting on its slowest model, so this is kept tight.
 */
const PROBE_TIMEOUT_MS = 10000;

/** Statuses that mean "the model is fine, we're just being throttled right now". */
const RATE_LIMIT_STATUSES = new Set([429]);
/** Statuses that mean the credential/permission is wrong, not the model. */
const AUTH_STATUSES = new Set([401, 403]);

function classifyFailure(status, errorText) {
  const text = String(errorText || "").toLowerCase();
  if (RATE_LIMIT_STATUSES.has(status)) return "rate_limited";
  // Some upstreams return 200/400 with a quota message instead of a 429.
  if (
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("quota") ||
    text.includes("exhausted") ||
    text.includes("insufficient_quota")
  ) {
    return "rate_limited";
  }
  if (AUTH_STATUSES.has(status)) return "auth";
  if (status === 404) return "not_found";
  if (status === 0 || text.includes("timeout") || text.includes("aborted")) return "timeout";
  return "error";
}

/**
 * A failure that makes the sibling capability probes pointless.
 *
 * Auth and not-found are about the model or credential, so no other probe can
 * succeed. A rate limit is also shared: the sibling probe hits the SAME model, so
 * it would be throttled too - paying for a second request just to collect another
 * 429 is pure waste, and the model is re-probed on a later run anyway.
 */
const shouldAbortSiblings = (kind) =>
  kind === "auth" || kind === "not_found" || kind === "rate_limited";

/**
 * Auth headers are identical for every probe in a sweep, so resolving them per
 * request meant thousands of redundant database reads and hashes. Cached with a
 * short TTL so a key rotation still takes effect within the same session.
 */
let headerCache = { value: null, expires: 0 };
const HEADER_TTL_MS = 60000;

async function getInternalHeaders() {
  const now = Date.now();
  if (headerCache.value && headerCache.expires > now) return headerCache.value;

  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);

  headerCache = { value: headers, expires: now + HEADER_TTL_MS };
  return headers;
}

/** Drop the cached headers — used by tests and after a credential change. */
export function resetHeaderCache() {
  headerCache = { value: null, expires: 0 };
}

function defaultBaseUrl() {
  return `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
}

/**
 * Send one chat/completions request and report how it went.
 * Returns { ok, status, error, latencyMs, raw, aborted }.
 */
async function postChat(body, { baseUrl, headers, signal, timeoutMs = PROBE_TIMEOUT_MS }) {
  const start = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  // Combined so an early terminal verdict on one probe cancels the others.
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: combined,
    });
    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {}

    if (!res.ok) {
      const detail =
        parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: String(detail || `HTTP ${res.status}`).slice(0, 240),
        raw: parsed,
      };
    }
    // A 200 can still carry a provider-level error envelope.
    if (parsed?.error) {
      const detail = parsed.error?.message || parsed.error;
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: String(detail).slice(0, 240),
        raw: parsed,
      };
    }
    return { ok: true, status: res.status, latencyMs, error: null, raw: parsed };
  } catch (err) {
    const aborted = signal?.aborted === true;
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: aborted ? "skipped" : String(err?.message || err).slice(0, 240),
      raw: null,
      aborted,
    };
  }
}

const hasChoices = (result) =>
  Array.isArray(result.raw?.choices) && result.raw.choices.length > 0;

/** Body for the combined chat + tool-calling probe. */
const toolProbeBody = (model) => ({
  model,
  max_tokens: 48,
  stream: false,
  messages: [{ role: "user", content: "What's the weather in Paris? Use the tool." }],
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather for a city",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    },
  ],
  tool_choice: "auto",
});

/**
 * Probe a model's real capabilities.
 *
 * @param {string} model - Full routed id, e.g. "openai/gpt-4o" or a combo member string.
 * @param {Object}  [opts]
 * @param {boolean} [opts.probeVision=true]
 * @param {boolean} [opts.probeTools=true]
 * @param {boolean} [opts.probeAudio=false] - costs an extra call per model
 * @param {number}  [opts.timeoutMs]
 * @param {string}  [opts.baseUrl]
 * @returns {Promise<Object>} probe result
 */
export async function probeModel(model, opts = {}) {
  const { probeVision = true, probeTools = true, probeAudio = false } = opts;
  const baseUrl = opts.baseUrl || defaultBaseUrl();
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : PROBE_TIMEOUT_MS;
  const headers = await getInternalHeaders();

  const result = {
    model,
    ok: false,
    status: null,
    latencyMs: null,
    error: null,
    failureKind: null,
    capabilities: { chat: false, vision: false, tools: false, audioInput: false },
    // Per-capability detail so the UI can explain *why* something is false
    // instead of silently showing a grey icon.
    detail: { chat: null, vision: null, tools: null, audioInput: null },
    probedAt: new Date().toISOString(),
  };

  // Cancels the secondary probes the moment the primary proves them pointless.
  const controller = new AbortController();

  // ---- Primary: chat + tools in one request ------------------------------
  // A tool request is a chat request, so this answers reachability and tool
  // support together. Only an actual tool_call proves tool support: a prose
  // answer means the request was ACCEPTED but the model chose not to call,
  // which is not evidence of capability and is reported distinctly.
  const primaryBody = probeTools
    ? toolProbeBody(model)
    : {
        model,
        max_tokens: 16,
        stream: false,
        messages: [{ role: "user", content: "Reply with the word: ok" }],
      };

  const primary = postChat(primaryBody, { baseUrl, headers, timeoutMs }).then((r) => {
    // Abort the rest as soon as the outcome is already known — no sibling probe
    // can add anything past a bad credential, a missing model, or a shared limit.
    if (!r.ok && shouldAbortSiblings(classifyFailure(r.status, r.error))) controller.abort();
    return r;
  });

  const jobs = [primary];

  if (probeVision) {
    jobs.push(
      postChat(
        {
          model,
          max_tokens: 16,
          stream: false,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Reply with the word: ok" },
                { type: "image_url", image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
        },
        { baseUrl, headers, signal: controller.signal, timeoutMs },
      ),
    );
  }

  if (probeAudio) {
    jobs.push(
      postChat(
        {
          model,
          max_tokens: 16,
          stream: false,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Reply with the word: ok" },
                {
                  type: "input_audio",
                  input_audio: { data: TINY_WAV_BASE64, format: "wav" },
                },
              ],
            },
          ],
        },
        { baseUrl, headers, signal: controller.signal, timeoutMs },
      ),
    );
  }

  const settled = await Promise.all(jobs);
  let cursor = 0;
  const chat = settled[cursor++];
  const vision = probeVision ? settled[cursor++] : null;
  const audio = probeAudio ? settled[cursor++] : null;

  // ---- Chat / tools ------------------------------------------------------
  result.status = chat.status ?? null;
  result.latencyMs = chat.latencyMs ?? null;
  const chatOk = chat.ok && hasChoices(chat);
  result.capabilities.chat = chatOk;
  result.ok = chatOk;
  result.detail.chat = chatOk ? "ok" : chat.error || "failed";

  if (!chatOk) {
    result.error = chat.error || "Chat probe failed";
    // A rate-limited model is NOT broken — say so explicitly so the UI can
    // offer "retry later" instead of "remove this model".
    result.failureKind = classifyFailure(chat.status ?? 0, chat.error);
  }

  if (probeTools) {
    const message = chat.raw?.choices?.[0]?.message;
    const calledTool = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    result.capabilities.tools = chat.ok && calledTool;
    if (result.capabilities.tools) result.detail.tools = "ok";
    else if (chat.ok) result.detail.tools = "accepted tools but returned no tool_call";
    else result.detail.tools = chat.error || "tool request rejected";
  }

  // ---- Vision ------------------------------------------------------------
  if (vision) {
    if (vision.aborted) {
      result.detail.vision = "skipped — the model itself was unreachable";
    } else {
      result.capabilities.vision = vision.ok && hasChoices(vision);
      result.detail.vision = result.capabilities.vision
        ? "ok"
        : vision.error || "rejected image input";
    }
  }

  // ---- Audio input -------------------------------------------------------
  if (audio) {
    if (audio.aborted) {
      result.detail.audioInput = "skipped — the model itself was unreachable";
    } else {
      result.capabilities.audioInput = audio.ok && hasChoices(audio);
      result.detail.audioInput = result.capabilities.audioInput
        ? "ok"
        : audio.error || "rejected audio input";
    }
  }

  return result;
}

/** Provider segment of a routed model id, used to bound per-provider load. */
export function providerOf(model) {
  const id = String(model || "");
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : id;
}

/**
 * Probe many models with bounded concurrency.
 *
 * Concurrency is bounded PER PROVIDER rather than globally. A single global
 * limit is the wrong shape for this workload: set it low and a catalog of
 * thousands takes hours even though most requests are just waiting on the
 * network; set it high and every slot lands on whichever provider happens to
 * own the next models in the list, which rate-limits that provider and makes
 * its models look broken — corrupting the very results the sweep exists to
 * produce. Limiting per provider lets dozens of providers run at once while no
 * single one is hammered.
 *
 * @param {string[]} models
 * @param {Object} [opts]
 * @param {number} [opts.concurrency=32] - global ceiling
 * @param {number} [opts.perProvider=4]  - simultaneous requests to one provider
 * @param {Function} [opts.onResult] - called with each result as it lands
 */
export async function probeModels(models, opts = {}) {
  const list = (Array.isArray(models) ? models : []).filter(
    (m) => typeof m === "string" && m.trim(),
  );
  if (list.length === 0) return [];

  const globalLimit = Math.max(1, Math.min(Number(opts.concurrency) || 32, 128));
  const perProvider = Math.max(1, Math.min(Number(opts.perProvider) || 4, 32));

  const results = new Array(list.length);

  // Per-provider queues built once. Scanning the flat list for a provider with a
  // free slot would be O(n) per dispatch — O(n²) over a catalog of thousands.
  const queues = new Map();
  list.forEach((model, index) => {
    const provider = providerOf(model);
    if (!queues.has(provider)) queues.set(provider, { pending: [], inFlight: 0 });
    queues.get(provider).pending.push(index);
  });

  const providers = [...queues.keys()];
  let rotation = 0;
  let active = 0;
  let completed = 0;

  return new Promise((resolve) => {
    const pump = () => {
      while (active < globalLimit) {
        // Round-robin so no provider monopolises the pool just by appearing
        // first, and one slow provider cannot stall the others.
        let picked = -1;
        for (let scanned = 0; scanned < providers.length; scanned += 1) {
          const queue = queues.get(providers[(rotation + scanned) % providers.length]);
          if (queue.pending.length > 0 && queue.inFlight < perProvider) {
            rotation = (rotation + scanned + 1) % providers.length;
            picked = queue.pending.shift();
            break;
          }
        }
        if (picked === -1) break;

        const model = list[picked];
        const queue = queues.get(providerOf(model));
        queue.inFlight += 1;
        active += 1;

        probeModel(model, opts)
          .catch((err) => ({
            model,
            ok: false,
            status: 0,
            latencyMs: null,
            error: String(err?.message || err).slice(0, 240),
            failureKind: "error",
            capabilities: { chat: false, vision: false, tools: false, audioInput: false },
            detail: { chat: null, vision: null, tools: null, audioInput: null },
            probedAt: new Date().toISOString(),
          }))
          .then((value) => {
            results[picked] = value;
            if (typeof opts.onResult === "function") {
              try {
                opts.onResult(value);
              } catch {}
            }
            queue.inFlight -= 1;
            active -= 1;
            completed += 1;
            if (completed === list.length) resolve(results);
            else pump();
          });
      }
    };

    pump();
  });
}
