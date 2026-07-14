/**
 * Inline `<thinking>` splitter for Claude on Kiro.
 *
 * Background:
 *   When thinking mode is enabled in the system prompt,
 *   Claude on Kiro emits its reasoning **inline** as <thinking>...</thinking>
 *   blocks inside `assistantResponseEvent.content`, rather than as separate
 *   `reasoningContentEvent` frames. To match the OpenAI streaming shape that
 *   downstream translators (Anthropic /thinking_blocks, Claude SSE, etc.)
 *   expect, we split that inline reasoning back out and route it to the
 *   `delta.reasoning_content` channel instead of `delta.content`.
 *
 * The implementation is split into pure functions so it can be unit-tested
 * without dragging in the rest of the executor stack (proxy-agent, AWS
 * EventStream parser, etc.). The KiroExecutor wires these helpers into its
 * TransformStream by passing controller-bound emit callbacks.
 */

/**
 * Stream-safe splitter. Walks one slice of upstream content at a time and
 * routes characters to either the content channel or the reasoning channel
 * based on the current thinking state.
 *
 * State is mutated on `state` so a tag split between frames (e.g. `…</think`
 * followed by `ing>foo`) is still recognised:
 *   - `state.thinkingMode` (boolean): true while inside a thinking block.
 *   - `state.pendingTag` (string): trailing characters held back because they
 *     might be the start of a tag we'll see complete on the next call.
 *
 * @param {{ thinkingMode: boolean, pendingTag: string }} state
 *   Mutable state carried across calls. Initialise with
 *   `{ thinkingMode: false, pendingTag: "" }`.
 * @param {string} raw
 *   Next slice from `assistantResponseEvent.content`. May be empty/null/undefined.
 * @param {(s: string) => void} onContent
 *   Called with text that should land in `delta.content`.
 * @param {(s: string) => void} onReasoning
 *   Called with text that should land in `delta.reasoning_content`.
 */
export function splitInlineThinking(state, raw, onContent, onReasoning) {
  let text = (state.pendingTag || "") + (raw || "");
  state.pendingTag = "";

  // Maximum length of an unfinished tag we might still complete on the next
  // frame: `</thinking>` is the longest at 11 chars.
  const PARTIAL_MAX = 11;

  while (text.length > 0) {
    const target = state.thinkingMode ? "</thinking>" : "<thinking>";
    const idx = text.indexOf(target);

    if (idx === -1) {
      // No full target tag in `text`. Look for a possible partial at the end
      // so we can complete it on the next frame.
      let holdFrom = text.length;
      for (let i = Math.max(0, text.length - PARTIAL_MAX); i < text.length; i++) {
        const tail = text.slice(i);
        if (target.startsWith(tail) && tail.length > 0) {
          holdFrom = i;
          break;
        }
      }
      const flushable = text.slice(0, holdFrom);
      if (flushable) {
        if (state.thinkingMode) onReasoning(flushable);
        else onContent(flushable);
      }
      state.pendingTag = text.slice(holdFrom);
      return;
    }

    // Found a complete target tag. Flush everything before it in the current
    // mode, flip the mode, and keep walking the remainder.
    const before = text.slice(0, idx);
    if (before) {
      if (state.thinkingMode) onReasoning(before);
      else onContent(before);
    }
    state.thinkingMode = !state.thinkingMode;
    text = text.slice(idx + target.length);
  }
}

/**
 * Drain whatever is left in `state.pendingTag` at end-of-stream. Routes the
 * leftover characters to whichever channel matches the current
 * `state.thinkingMode` so we don't silently lose data when the stream ends
 * mid-tag (e.g. `<thi`).
 *
 * @param {{ thinkingMode: boolean, pendingTag: string }} state
 * @param {(s: string) => void} onContent
 * @param {(s: string) => void} onReasoning
 */
export function flushPendingThinking(state, onContent, onReasoning) {
  if (!state.pendingTag) return;
  const leftover = state.pendingTag;
  state.pendingTag = "";
  if (state.thinkingMode) onReasoning(leftover);
  else onContent(leftover);
}
