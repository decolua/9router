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
export function stripEchoTags(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const tag of ECHO_TAGS) {
    const open = "<" + tag + ">";
    const close = "</" + tag + ">";
    let i;
    while ((i = out.indexOf(open)) !== -1) {
      const j = out.indexOf(close, i + open.length);
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
