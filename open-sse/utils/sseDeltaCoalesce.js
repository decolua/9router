/**
 * Coalesce Anthropic content_block_delta SSE events before forwarding to a
 * client.
 *
 * Claude Code's VS Code extension renders one postMessage per SSE event. A fast
 * Anthropic-compatible upstream (DeepSeek V4.1 Flash, others) emits one
 * content_block_delta per token — mostly thinking_delta at high effort — and the
 * extension falls behind, leaving the UI stuck on "working" for minutes.
 * (#4558, upstream anthropics/claude-code#86854.)
 *
 * Semantics: buffer consecutive content_block_delta events that share the SAME
 * content-block index AND the same delta type; emit them as ONE merged event
 * when any of:
 *   - a different index or delta type arrives (flush the prior group)
 *   - a boundary event arrives (content_block_start/stop, message_delta/stop,
 *     ping, error)
 *   - the window's timer fires, so a long same-type burst flushes as a batch
 *     every `window` ms rather than all at once at the end
 *
 * It is LOSSLESS: merged deltas carry the concatenated text of the originals.
 * Anthropic's own API already batches multiple tokens per delta, so a correct
 * client sees no semantic difference. OFF by default — set one SSE_COALESCE_*
 * env var to opt in. Scoped to streams whose TARGET is Claude, independent of
 * which upstream produced it.
 */

const BOUNDARY_TYPES = new Set([
  "content_block_start",
  "content_block_stop",
  "message_start",
  "message_delta",
  "message_stop",
  "ping",
  "error",
]);

const DEFAULT_WINDOWS = {
  thinking_delta: 400,
  text_delta: 40,
  input_json_delta: 40,
};

function windowMsFor(deltaType) {
  // Off by default: coalescing only activates when an operator sets one of these.
  // This keeps behaviour identical to today unless explicitly opted in (#4558).
  const envName = `SSE_COALESCE_${deltaType.replace(/_delta$/, "").toUpperCase()}_MS`;
  const fromEnv = Number(process.env[envName]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const global = Number(process.env.SSE_COALESCE_MS);
  if (Number.isFinite(global) && global > 0) return global;
  return 0;
}

function mergeDeltas(target, source) {
  if (source.type === "thinking_delta") target.thinking = (target.thinking ?? "") + (source.thinking ?? "");
  else if (source.type === "text_delta") target.text = (target.text ?? "") + (source.text ?? "");
  else if (source.type === "input_json_delta") target.partial_json = (target.partial_json ?? "") + (source.partial_json ?? "");
  return target;
}

/**
 * @param onEmit (events: object[]) => void  — called for immediate events and
 *   for timer-driven flushes. For a transform stream this wires to
 *   controller.enqueue. Tests can pass a plain collector.
 */
export function createDeltaCoalescer(onEmit) {
  let pending = null; // { index, type, target, timer }
  const emit = (evts) => { if (evts && evts.length) onEmit(evts); };

  const flushPending = () => {
    if (!pending) return;
    if (pending.timer) { clearTimeout(pending.timer); pending.timer = null; }
    const event = pending.target;
    pending = null;
    emit([event]);
  };

  return {
    feed(event) {
      if (!event || typeof event !== "object") return emit([event]);

      if (event.type !== "content_block_delta") {
        if (BOUNDARY_TYPES.has(event.type)) flushPending();
        return emit([event]);
      }

      const index = event.index;
      const dtype = event.delta?.type;
      if (!dtype) {
        flushPending();
        return emit([event]);
      }

      if (pending && pending.index === index && pending.type === dtype) {
        // Same group: append. Do NOT restart the timer — the window flushes the
        // accumulated batch on its own schedule.
        mergeDeltas(pending.target.delta, event.delta);
        return;
      }

      flushPending();
      const windowMs = windowMsFor(dtype);
      if (windowMs === 0) return emit([event]);

      const timer = setTimeout(() => {
        const target = pending?.target;
        pending = null;
        if (target) emit([target]);
      }, windowMs);
      timer.unref?.();
      pending = { index, type: dtype, target: { ...event, delta: { ...event.delta } }, timer };
    },
    flush: flushPending,
    /** True when coalescing is active (any non-zero window). */
    enabled() {
      return ["thinking_delta", "text_delta", "input_json_delta"].some((d) => windowMsFor(d) > 0);
    },
  };
}
