// Whole-text echo scrubbing for NON-streaming replies.
//
// The streaming path filters incrementally in openai-to-claude.js, holding a
// carry buffer for tags split across chunks. A non-streaming body has the whole
// text at once, so it needs neither the buffer nor the state machine — but it
// was getting no filtering at all, which meant a model could echo the harness
// XML or regurgitate the user's message and have it pass straight through on
// any non-streamed reply.

import { isUserEcho } from "./userEcho.js";

const ECHO_TAGS = ["instructions", "system-reminder", "task-notification", "command-message", "command-name"];

// Drop whole <tag>...</tag> blocks, and an unclosed trailing block, matching
// what the streaming filter does at end of stream.
//
// The opening tag is matched WITH ATTRIBUTES. This was an exact `indexOf("<tag>")`,
// which a model walks straight through by inventing one: an observed reply opened
// `<task-notification task_id="a424703057daa789f">`, which is not the string
// `<task-notification>`, so nothing matched and the whole block reached the client
// verbatim. The tag was in the list and the filter did run — it could not see it.
// Only whitespace may follow the name, so `<system-reminders>` is still not
// `<system-reminder>`.
const OPEN_TAG_RE = new Map(
  ECHO_TAGS.map((tag) => [tag, new RegExp("<" + tag + "(?:\\s[^>]*)?>")]),
);

export function stripEchoTags(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const tag of ECHO_TAGS) {
    const open = OPEN_TAG_RE.get(tag);
    const close = "</" + tag + ">";
    let m;
    while ((m = open.exec(out)) !== null) {
      const i = m.index;
      const j = out.indexOf(close, i + m[0].length);
      out = j === -1 ? out.slice(0, i) : out.slice(0, i) + out.slice(j + close.length);
    }
  }
  return out;
}

// Returns the text to emit: tags stripped, and emptied entirely when the whole
// reply is the user's own message repeated back.
export function scrubEcho(text, lastUserText) {
  const stripped = stripEchoTags(text);
  if (lastUserText && isUserEcho(stripped, lastUserText)) return "";
  return stripped;
}

// Apply to whichever field carries visible text in each response shape. Returns
// true when anything was changed, so the caller can record a discipline strike.
export function scrubResponseBody(body, lastUserText) {
  if (!body || typeof body !== "object") return false;
  let changed = false;

  const fix = (obj, key) => {
    if (!obj || typeof obj[key] !== "string" || !obj[key]) return;
    const next = scrubEcho(obj[key], lastUserText);
    if (next !== obj[key]) {
      obj[key] = next;
      changed = true;
    }
  };

  // OpenAI chat completion
  if (Array.isArray(body.choices)) {
    for (const c of body.choices) fix(c && c.message, "content");
  }
  // Claude message
  if (Array.isArray(body.content)) {
    for (const b of body.content) {
      if (b && b.type === "text") fix(b, "text");
    }
  }
  // Gemini / Antigravity
  const response = body.response || body;
  if (Array.isArray(response.candidates)) {
    for (const cand of response.candidates) {
      const parts = cand && cand.content && cand.content.parts;
      if (Array.isArray(parts)) for (const p of parts) fix(p, "text");
    }
  }

  return changed;
}
