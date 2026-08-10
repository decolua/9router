// Detect a stream that ended without ever delivering a terminal event, and
// synthesize one so the client sees a failure instead of silence.
//
// When an upstream dies mid-response the transform stream simply reaches EOF.
// createDisconnectAwareStream then closed the client stream normally, so the
// caller received a truncated body with no finish_reason and no error — it could
// not tell "the model stopped" from "the connection died". Clients that wait for
// a terminal event blocked until their own timeout (observed: an 11-minute wedge
// and sockets stranded in CLOSE-WAIT).
//
// SAFETY: a false positive here is worse than the bug — appending a spurious
// error frame to a HEALTHY stream would break working traffic. So detection is
// deliberately narrow: only formats whose terminal marker is unambiguous get a
// tracker, and `createTerminalTracker` returns null for everything else, which
// preserves today's behaviour exactly. Note that [DONE] alone is NOT a reliable
// signal — a live provider here emits finish_reason and never sends [DONE].
import { FORMATS } from "../translator/formats.js";
import { buildAbortedResponsesTerminalBytes } from "./responsesStreamHelpers.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

const DROP_MESSAGE =
  "Upstream stream ended before completing: the provider closed the connection " +
  "without sending a terminal event. The response above is incomplete.";

// ── per-format definitions ──────────────────────────────────────────────
// sawTerminal: does this outgoing text prove the stream reached a proper end?
// buildDrop:   bytes to append when it did not.
const HANDLERS = {
  [FORMATS.OPENAI]: {
    // A non-null finish_reason on any choice is the real terminal for Chat
    // Completions. [DONE] is accepted too but not required.
    sawTerminal: (text) =>
      /"finish_reason"\s*:\s*"[^"]+"/.test(text) || text.includes("data: [DONE]"),
    buildDrop: () =>
      encoder.encode(
        `data: ${JSON.stringify({
          error: {
            message: DROP_MESSAGE,
            type: "upstream_error",
            code: "upstream_stream_incomplete",
          },
        })}\n\ndata: [DONE]\n\n`
      ),
  },

  [FORMATS.CLAUDE]: {
    sawTerminal: (text) => text.includes("message_stop"),
    buildDrop: () =>
      encoder.encode(
        `event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "api_error", message: DROP_MESSAGE },
        })}\n\n`
      ),
  },

  // Responses passthrough already has a synthesized failure payload used on the
  // abort path; reuse it verbatim so both paths emit an identical terminal.
  [FORMATS.OPENAI_RESPONSES]: {
    sawTerminal: (text) =>
      text.includes("response.completed") ||
      text.includes("response.failed") ||
      text.includes("response.incomplete"),
    buildDrop: () => buildAbortedResponsesTerminalBytes(),
  },
};

/**
 * Build a tracker for the client-facing format, or null when the format has no
 * unambiguous terminal marker (in which case the caller must not synthesize
 * anything and behaviour stays as it was).
 *
 * @param {string} targetFormat - the format the CLIENT receives
 * @returns {{observe: (chunk: Uint8Array) => void, sawTerminal: () => boolean, buildDrop: () => Uint8Array} | null}
 */
export function createTerminalTracker(targetFormat) {
  const handler = HANDLERS[targetFormat];
  if (!handler) return null;

  let seen = false;
  // A terminal marker can straddle two chunks, so keep a small tail of the
  // previous chunk and test the join. Bounded so this never grows with the
  // response.
  let tail = "";
  const TAIL = 64;

  return {
    observe(chunk) {
      if (seen || !chunk) return;
      let text;
      try {
        text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      } catch {
        return;
      }
      if (!text) return;
      if (handler.sawTerminal(tail + text)) {
        seen = true;
        tail = "";
        return;
      }
      tail = (tail + text).slice(-TAIL);
    },
    sawTerminal: () => seen,
    buildDrop: () => handler.buildDrop(),
  };
}
