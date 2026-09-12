/**
 * Strip an injected system prompt (the "needle") from responses.
 *
 * The per-combo identity prompt is injected into requests (see
 * rtk/systemInject.js); this is the defense-in-depth side: if a model leaks
 * that text verbatim into its output, the client never sees it. Scope is the
 * exact needle only — paraphrased leaks are handled prompt-side and are not
 * detectable here reliably.
 *
 * Matching is case-insensitive with whitespace runs collapsed (models re-wrap
 * quoted text), and operates on parsed JSON string fields — never on raw
 * serialized bytes — so JSON escaping is a non-issue.
 *
 * Modeled on utils/modelNameRewrite.js:
 * - `createSystemPromptStripStream(needle)` — line-buffered byte TransformStream
 *   over SSE data lines (covers streaming, every client format). Some upstreams
 *   label the body SSE but return one bare JSON completion (optionally glued to
 *   `data: [DONE]` with no newline); at EOF that hybrid is stripped as a
 *   complete JSON body with the done marker and surrounding whitespace intact.
 * - `stripSystemPromptFromResponse(response, needle)` — 2xx only; SSE → pipe
 *   through the stream, JSON → parse/strip/re-stringify.
 * Everything fails open: any error forwards the original bytes.
 */

const SEP_MATCH_WS = /\s/;

// String-valued fields that carry model-generated text across the client
// formats (OpenAI chat/Responses, Claude, Gemini). Tool-argument fields
// (`arguments`, `input`, `partial_json`) are deliberately absent.
const TEXT_KEYS = new Set([
  "content", "text", "delta", "thinking",
  "reasoning_content", "reasoning", "instructions",
]);

function isWs(ch) {
  return SEP_MATCH_WS.test(ch);
}

// Normalized view of `text`: lowercased, every whitespace run collapsed to one
// space. `map[i]` is the index in `text` that produced view char i, so matches
// map back onto the original text for deletion.
function buildNormView(text) {
  let view = "";
  const map = new Array(text.length);
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (isWs(text[i])) {
      let j = i + 1;
      while (j < n && isWs(text[j])) j++;
      view += " ";
      map[view.length - 1] = i;
      i = j;
    } else {
      view += text[i].toLowerCase();
      map[view.length - 1] = i;
      i++;
    }
  }
  return { view, map };
}

function normNeedle(needle) {
  return buildNormView(String(needle)).view.trim();
}

// Longest suffix of `view` that is a proper prefix of `needleView` — the part
// that could still grow into a full match once more text arrives.
function longestHoldbackSuffix(view, needleView) {
  const maxK = Math.min(needleView.length - 1, view.length);
  for (let k = maxK; k > 0; k--) {
    if (view.endsWith(needleView.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Streaming needle filter with hold-back. push() returns only the text that can
 * no longer participate in a match; the tail stays pending until more text
 * arrives (push) or the stream ends (flush).
 */
export class NeedleFilter {
  constructor(needleView) {
    this.needleView = needleView;
    this.pending = "";
    this._flushed = false;
  }

  push(text) {
    if (this._flushed || !text) return text || "";
    this.pending += text;
    this._stripMatches();
    const { view, map } = buildNormView(this.pending);
    const k = longestHoldbackSuffix(view, this.needleView);
    if (k <= 0) {
      const out = this.pending;
      this.pending = "";
      return out;
    }
    const holdFrom = map[view.length - k];
    if (holdFrom === undefined || holdFrom <= 0) {
      // everything could still be part of a match
      return "";
    }
    const out = this.pending.slice(0, holdFrom);
    this.pending = this.pending.slice(holdFrom);
    return out;
  }

  flush() {
    this._flushed = true;
    const out = this.pending;
    this.pending = "";
    return out;
  }

  _stripMatches() {
    let guard = 0;
    while (guard++ < 100) {
      const { view, map } = buildNormView(this.pending);
      const idx = view.indexOf(this.needleView);
      if (idx === -1) break;
      const origStart = map[idx];
      const origEnd = map[idx + this.needleView.length - 1] + 1;
      this.pending = this.pending.slice(0, origStart) + this.pending.slice(origEnd);
    }
  }
}

/** Pure one-shot strip of every needle occurrence from `text`. */
export function stripNeedleFromText(text, needle) {
  if (!text || !needle) return text;
  const needleView = normNeedle(needle);
  if (!needleView) return text;
  try {
    const f = new NeedleFilter(needleView);
    return f.push(text) + f.flush();
  } catch (_) {
    return text; // fail-open
  }
}

/** Recurse every TEXT_KEYS string field; `visit(path, value)` returns replacement. */
function walkTextFields(node, path, visit) {
  if (!node || typeof node !== "object") return false;
  let changed = false;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (walkTextFields(node[i], `${path}.${i}`, visit)) changed = true;
    }
    return changed;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    const childPath = path ? `${path}.${key}` : key;
    if (typeof v === "string" && TEXT_KEYS.has(key)) {
      const out = visit(childPath, v);
      if (out !== v) {
        node[key] = out;
        changed = true;
      }
    } else if (v && typeof v === "object") {
      if (walkTextFields(v, childPath, visit)) changed = true;
    }
  }
  return changed;
}

/** Strip the needle from every text field of a parsed (non-streaming) JSON body. */
export function stripNeedleFromObject(body, needle) {
  if (!body || typeof body !== "object" || !needle) return body;
  try {
    walkTextFields(body, "", (_path, value) => stripNeedleFromText(value, needle));
  } catch (_) {
    // fail-open
  }
  return body;
}

// Cheap terminal-marker detection for SSE lines. False positives are harmless:
// the line is just deferred until the next line (or flush) so ordering with
// remainder events stays correct.
function isTerminalSSELine(line) {
  if (line === "data: [DONE]") return true;
  if (!line.startsWith("data:")) return false;
  const payload = line.slice(5);
  if (/"finish_reason"\s*:\s*"(?!null)[^"]*"/.test(payload)) return true;
  if (/"finishReason"\s*:/.test(payload)) return true;
  if (/"type"\s*:\s*"message_stop"/.test(payload)) return true;
  if (/"type"\s*:\s*"message_delta"/.test(payload)) return true;
  if (/"type"\s*:\s*"content_block_stop"/.test(payload)) return true;
  if (/"type"\s*:\s*"response\.completed"/.test(payload)) return true;
  if (/"type"\s*:\s*"response\.output_text\.done"/.test(payload)) return true;
  return false;
}

/**
 * Line-buffered byte stream that strips the needle from SSE data lines.
 * Decoding is streamed so multi-byte characters split across chunks survive.
 * Held-back remainders are flushed ahead of terminal events (or at EOF) by
 * cloning the last event that carried that text field.
 */
export function createSystemPromptStripStream(needle) {
  const needleView = normNeedle(needle);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  // path -> NeedleFilter (streaming state per logical text field)
  const filters = new Map();
  // path -> last parsed event whose text at `path` was non-empty (for flush cloning)
  const lastEventByPath = new Map();
  // terminal lines held back until filter remainders are flushed ahead of them
  let terminalQueue = [];

  function filterText(path, text) {
    let f = filters.get(path);
    if (!f) {
      f = new NeedleFilter(needleView);
      filters.set(path, f);
    }
    return f.push(text);
  }

  // A terminal line must wait only while a redaction hold-back is actually
  // pending. Holding unconditionally reorders the stream: the trailing usage
  // chunk (stream_options.include_usage — no finish_reason) would overtake
  // the finish chunk, and clients that read the LAST usage-bearing chunk
  // would see the finish chunk's injected estimate instead of the real
  // numbers that arrived after it. A terminal line emitted when nothing is
  // held back can never be followed by a remainder — later chunks without
  // text fields (usage-only) push nothing into the filters.
  function hasPendingRemainder() {
    for (const f of filters.values()) {
      if (f.pending && f.pending.trim()) return true;
    }
    return false;
  }

  function processLine(line) {
    if (!needleView || !line.startsWith("data:")) return line;
    const payload = line.slice(5).trimStart();
    if (!payload || payload === "[DONE]") return line;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch (_) {
      return line; // fail-open
    }
    if (!obj || typeof obj !== "object") return line;
    let changed = false;
    try {
      const activePaths = [];
      changed = walkTextFields(obj, "", (path, value) => {
        if (value) activePaths.push(path);
        return filterText(path, value);
      });
      for (const path of activePaths) lastEventByPath.set(path, JSON.parse(JSON.stringify(obj)));
    } catch (_) {
      return line; // fail-open
    }
    if (!changed) return line;
    return "data: " + JSON.stringify(obj);
  }

  // Emit held-back remainders (as cloned last events) ahead of whatever comes next.
  function flushRemainders(emit) {
    for (const [path, event] of lastEventByPath) {
      const f = filters.get(path);
      if (!f) continue;
      const remainder = f.flush();
      if (!remainder || !remainder.trim()) continue;
      try {
        const clone = JSON.parse(JSON.stringify(event));
        try { delete clone.usage; } catch (_) { /* frozen fail-open */ }
        // The event may carry other text fields whose safe text already went
        // out — blank them so the clone only delivers this path's remainder.
        walkTextFields(clone, "", (p) => (p === path ? remainder : ""));
        emit("data: " + JSON.stringify(clone) + "\n");
      } catch (_) { /* fail-open */ }
    }
    lastEventByPath.clear();
  }

  // Some upstreams advertise SSE but return one bare JSON completion — possibly
  // glued straight to `data: [DONE]` with no newline. Line processing can't see
  // the JSON (no `data:` prefix; the marker would swallow the whole line), so
  // at EOF the emitted output is reclaimed and handled as a complete JSON body.
  // Bytes are preserved unless the needle is actually stripped.
  let emitted = "";
  let rawJsonCandidate = "";

  function flushRawJsonBody(controller) {
    if (!needleView || !rawJsonCandidate) return;
    try {
      const rest = rawJsonCandidate;
      const doneAt = rest.lastIndexOf("data: [DONE]");
      const rawJson = doneAt >= 0 ? rest.slice(0, doneAt) : rest;
      const trimmedJson = rawJson.trim();
      if (!trimmedJson.startsWith("{") && !trimmedJson.startsWith("[")) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmedJson);
      } catch (_) {
        controller.enqueue(encoder.encode(rest));
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        controller.enqueue(encoder.encode(rest));
        return;
      }

      const before = JSON.stringify(parsed);
      stripNeedleFromObject(parsed, needleView);
      const after = JSON.stringify(parsed);
      if (after === before) {
        controller.enqueue(encoder.encode(rest));
        return;
      }

      const leading = rawJson.slice(0, rawJson.indexOf(trimmedJson));
      const trailing = rawJson.slice(rawJson.indexOf(trimmedJson) + trimmedJson.length);
      const suffix = doneAt >= 0 ? rest.slice(doneAt) : "";
      controller.enqueue(encoder.encode(leading + after + trailing + suffix));
    } catch (_) {
      // fail-open
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      try {
        buffer += decoder.decode(chunk, { stream: true });
        let start = 0;
        let nl;
        while ((nl = buffer.indexOf("\n", start)) !== -1) {
          const line = buffer.slice(start, nl);
          if (needleView && isTerminalSSELine(line) && hasPendingRemainder()) {
            terminalQueue.push(line);
          } else {
            // Defer bare JSON lines: an immediately following DONE marker may
            // make this the SSE-labelled raw-JSON hybrid form.
            if (needleView && (line.trimStart().startsWith("{") || line.trimStart().startsWith("[")) && !line.trimStart().startsWith("data:")) {
              rawJsonCandidate += line;
            } else {
              const out = processLine(line) + "\n";
              emitted += out;
              controller.enqueue(encoder.encode(out));
            }
          }
          start = nl + 1;
        }
        buffer = buffer.slice(start);
      } catch (_) {
        // fail-open: never break the response stream
      }
    },
    flush(controller) {
      try {
        const rest = buffer + decoder.decode();
        if (rest) {
          if (!needleView || !isTerminalSSELine(rest)) {
            // Bare JSON at EOF (no trailing newline) — same hybrid form.
            if (needleView && (rest.trimStart().startsWith("{") || rest.trimStart().startsWith("[")) && !rest.trimStart().startsWith("data:")) {
              rawJsonCandidate += rest;
            } else {
              const out = processLine(rest);
              emitted += out;
              controller.enqueue(encoder.encode(out));
            }
          } else {
            terminalQueue.push(rest.replace(/\n$/, ""));
          }
        }
        // Last chance to redact a bare-JSON body: everything up to EOF is now
        // known, so the emitted bytes can be safely superseded.
        flushRawJsonBody(controller);
        const emit = (s) => controller.enqueue(encoder.encode(s));
        flushRemainders(emit);
        for (const line of terminalQueue) emit(line + "\n");
        terminalQueue = [];
      } catch (_) {
        // fail-open
      }
    },
  });
}

/**
 * Strip the needle from a successful response. No-op when not ok, no needle,
 * or content type is neither SSE nor JSON.
 * @param {Response} response
 * @param {string} needle - The resolved injected system prompt to redact.
 * @returns {Promise<Response>}
 */
export async function stripSystemPromptFromResponse(response, needle) {
  try {
    if (!response || !response.ok || !needle) return response;
    const contentType = response.headers?.get?.("content-type") || "";
    const isSSE = contentType.includes("text/event-stream");
    const isJSON = contentType.includes("application/json");
    if (!isSSE && !isJSON) return response;

    if (isSSE) {
      if (!response.body) return response;
      const stripped = response.body.pipeThrough(createSystemPromptStripStream(needle));
      return new Response(stripped, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    const text = await response.text();
    try {
      const body = JSON.parse(text);
      if (body && typeof body === "object") stripNeedleFromObject(body, needle);
      const out = JSON.stringify(body);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(out, { status: response.status, statusText: response.statusText, headers });
    } catch (_) {
      // Not JSON after all — forward the original bytes unchanged.
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(text, { status: response.status, statusText: response.statusText, headers });
    }
  } catch (_) {
    // Stripping must never break the response — fall back to the original body.
    return response;
  }
}
