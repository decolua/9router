// Concern: inline <think>…</think> reasoning splitter (streaming-safe).
//
// Many OpenAI-compatible upstreams (R1 mirrors, GLM/DeepSeek via third-party
// proxies, some free pools) do NOT send reasoning in a separate field
// (reasoning_content / reasoning_details). Instead they inline it in `content`
// wrapped in <think>…</think>. If a translator only reads the separate field
// (see concerns/reasoning.js) that reasoning leaks through as ordinary text —
// the client shows a "thinking" label with empty/garbled body, and downstream
// models lose the reasoning context ("the model gets dumber").
//
// This is the SINGLE source of truth for splitting those tags. It is a pure,
// dependency-free state machine so every response translator handles the inline
// shape identically and it survives tags split across SSE chunks
// (e.g. "<thi" in chunk N, "nk>" in chunk N+1).

const OPEN = "<think>";
const CLOSE = "</think>";

// Longest suffix of `s` that is a proper (non-full) prefix of `tag`.
// Used to hold back a possible partial tag straddling a chunk boundary.
function partialTailLen(s, tag) {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.slice(s.length - n) === tag.slice(0, n)) return n;
  }
  return 0;
}

// Split a streamed content string into { reasoning, text }, carrying open-tag
// state and any partial-tag remainder across calls via `state.thinkTag`.
// - reasoning: text that was inside <think>…</think> in this chunk
// - text:      text that was outside the tags in this chunk
// Either may be "". Order within a single chunk is preserved implicitly
// because reasoning always precedes the text that follows its close tag; a
// chunk that contains only one kind returns "" for the other.
export function splitThinkTags(content, state) {
  if (typeof content !== "string" || content === "") {
    return { reasoning: "", text: "" };
  }
  const st = (state.thinkTag ??= { inThink: false, buf: "" });
  let buf = st.buf + content;
  st.buf = "";

  let reasoning = "";
  let text = "";

  while (buf.length > 0) {
    if (!st.inThink) {
      const i = buf.indexOf(OPEN);
      if (i === -1) {
        // No full open tag — emit all but a possible partial tag suffix.
        const tail = partialTailLen(buf, OPEN);
        text += buf.slice(0, buf.length - tail);
        st.buf = buf.slice(buf.length - tail);
        break;
      }
      text += buf.slice(0, i);
      buf = buf.slice(i + OPEN.length);
      st.inThink = true;
    } else {
      const i = buf.indexOf(CLOSE);
      if (i === -1) {
        const tail = partialTailLen(buf, CLOSE);
        reasoning += buf.slice(0, buf.length - tail);
        st.buf = buf.slice(buf.length - tail);
        break;
      }
      reasoning += buf.slice(0, i);
      buf = buf.slice(i + CLOSE.length);
      st.inThink = false;
    }
  }

  return { reasoning, text };
}

// Flush any buffered partial tag at end-of-stream. A stream that ends mid-tag
// (e.g. "…done<thi") never completed a real tag, so the remainder is surfaced
// as whatever mode we're in: text when outside, reasoning when still open.
export function flushThinkTags(state) {
  const st = state?.thinkTag;
  if (!st || !st.buf) return { reasoning: "", text: "" };
  const rem = st.buf;
  st.buf = "";
  return st.inThink ? { reasoning: rem, text: "" } : { reasoning: "", text: rem };
}

// True when the splitter is mid-<think> (no close tag seen yet). Lets callers
// keep a thinking block open across chunks.
export function isInsideThink(state) {
  return !!state?.thinkTag?.inThink;
}
