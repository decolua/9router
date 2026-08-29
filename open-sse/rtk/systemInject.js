// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.js and ponytail.js.

import { FORMATS } from "../translator/formats.js";
import { OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { ROLE } from "../translator/schema/roles.js";

const SEP = "\n\n";

export function injectSystemPrompt(body, format, prompt) {
  try {
    if (!body || !prompt) return;
    if (typeof body !== "object") return;

    // Kiro wire shape is unique (conversationState/systemPrompt) — handle directly.
    if (isKiroBody(body) || format === FORMATS.KIRO) {
      injectKiroSystem(body, prompt);
      return;
    }

    // Claude/Gemini own a dedicated system field, yet their bodies also carry
    // messages[]/contents[] — decide by format label before the shape sniff below.
    // Anthropic rejects a "system" role inside messages[] (no such input role).
    if (format === FORMATS.CLAUDE) {
      injectClaudeSystem(body, prompt);
      return;
    }
    if (format === FORMATS.GEMINI || format === FORMATS.GEMINI_CLI
      || format === FORMATS.VERTEX || format === FORMATS.ANTIGRAVITY) {
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    }

    // Dispatch by actual wire shape for OpenAI-shaped formats.
    // instructions string takes precedence; messages[] means Chat; input[] means Responses.
    if (typeof body.instructions === "string") {
      injectInstructionsSystem(body, prompt);
      return;
    }
    if (Array.isArray(body.messages)) {
      injectChatSystem(body, prompt);
      return;
    }
    if (Array.isArray(body.input)) {
      // Responses input[]: empty array already normalized elsewhere; string stays untouched here
      injectResponsesInputSystem(body, prompt);
      return;
    }
    if (typeof body.input === "string") {
      body.instructions = prompt;
      return;
    }

    // OpenAI-shaped but no array (e.g. empty body) — no-op
  } catch (_) {
    // fail-open
  }
}

function isKiroBody(body) {
  if (!body || typeof body !== "object") return false;
  if (typeof body.systemPrompt !== "string") return false;
  const cs = body.conversationState;
  if (!cs || typeof cs !== "object") return false;
  return Array.isArray(cs.history) || !!(cs.currentMessage && typeof cs.currentMessage === "object");
}

// Exact idempotency: prompt present as its own SEP-delimited segment (or the
// whole string), not as a substring of unrelated text.
function hasPrompt(haystack, prompt) {
  if (!haystack || typeof haystack !== "string") return false;
  if (haystack === prompt) return true;
  return haystack.split(SEP).includes(prompt);
}

function dedupStringAppend(curr, prompt) {
  if (!curr) return prompt;
  if (hasPrompt(curr, prompt)) return curr;
  return `${curr}${SEP}${prompt}`;
}

// ---- OpenAI instructions string ----
function injectInstructionsSystem(body, prompt) {
  try {
    const curr = body.instructions;
    if (typeof curr !== "string") return;
    if (hasPrompt(curr, prompt)) return;
    const next = curr ? `${curr}${SEP}${prompt}` : prompt;
    try { body.instructions = next; } catch (_) { /* frozen/proxy fail-open */ }
  } catch (_) {}
}

// ---- Chat messages[] ----
function injectChatSystem(body, prompt) {
  try {
    const arr = body.messages;
    if (!Array.isArray(arr)) return;
    // Exact idempotency: scan existing system/developer content for full prompt
    if (containsPromptInMessages(arr, prompt)) return;
    let idx = -1;
    try { idx = arr.findIndex(m => m && (m.role === ROLE.SYSTEM || m.role === ROLE.DEVELOPER)); } catch (_) { return; }
    if (idx >= 0) {
      appendToChatMessage(arr[idx], prompt);
    } else {
      // create typed system message at index 0; fail-open on frozen/proxy
      try { arr.unshift({ role: ROLE.SYSTEM, content: prompt }); } catch (_) {}
    }
  } catch (_) {}
}

function containsPromptInMessages(arr, prompt) {
  try {
    for (const m of arr) {
      if (!m || (m.role !== ROLE.SYSTEM && m.role !== ROLE.DEVELOPER)) continue;
      const c = m.content;
      if (typeof c === "string" && hasPrompt(c, prompt)) return true;
      if (Array.isArray(c)) {
        for (const part of c) {
          if (part && typeof part.text === "string" && hasPrompt(part.text, prompt)) return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function appendToChatMessage(msg, prompt) {
  try {
    if (!msg || typeof msg !== "object") return;
    const c = msg.content;
    if (typeof c === "string") {
      const next = dedupStringAppend(c, prompt);
      if (next === c) return;
      // avoid partial mutation: try assignment, bail if setter throws
      try { msg.content = next; } catch (_) {}
      return;
    }
    if (Array.isArray(c)) {
      // already deduped at message level; but guard block-level too
      try {
        if (c.some(b => b && b.text === prompt)) return;
      } catch (_) {}
      try { c.push({ type: OPENAI_BLOCK.TEXT, text: prompt }); } catch (_) {}
      return;
    }
    try { msg.content = prompt; } catch (_) {}
  } catch (_) {}
}

// ---- Responses input[] ----
function injectResponsesInputSystem(body, prompt) {
  try {
    const arr = body.input;
    if (!Array.isArray(arr)) return;
    // instructions already handled above
    if (containsPromptInResponsesInput(arr, prompt)) return;
    // find system/developer message items only (type === message)
    let idx = -1;
    try {
      idx = arr.findIndex(m => m && (!m.type || m.type === RESPONSES_ITEM.MESSAGE || m.type === "message") && (m.role === ROLE.SYSTEM || m.role === ROLE.DEVELOPER));
    } catch (_) { return; }
    if (idx >= 0) {
      appendToResponsesMessage(arr[idx], prompt);
    } else {
      try {
        const insertAt = arr.findIndex(m => m?.type !== "additional_tools");
        if (insertAt > 0) {
          arr.splice(insertAt, 0, {
            type: RESPONSES_ITEM.MESSAGE,
            role: ROLE.DEVELOPER,
            content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }],
          });
        } else {
          arr.unshift({
            type: RESPONSES_ITEM.MESSAGE,
            role: ROLE.SYSTEM,
            content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }],
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function containsPromptInResponsesInput(arr, prompt) {
  try {
    for (const item of arr) {
      if (!item || item.type !== RESPONSES_ITEM.MESSAGE) continue;
      if (item.role !== ROLE.SYSTEM && item.role !== ROLE.DEVELOPER) continue;
      const c = item.content;
      if (typeof c === "string" && hasPrompt(c, prompt)) return true;
      if (Array.isArray(c)) {
        for (const part of c) {
          if (part && typeof part.text === "string" && hasPrompt(part.text, prompt)) return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function appendToResponsesMessage(msg, prompt) {
  try {
    if (!msg || typeof msg !== "object") return;
    const c = msg.content;
    if (typeof c === "string") {
      const next = dedupStringAppend(c, prompt);
      if (next === c) return;
      try { msg.content = next; } catch (_) {}
      return;
    }
    if (Array.isArray(c)) {
      try { if (c.some(b => b && b.text === prompt)) return; } catch (_) {}
      try { c.push({ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }); } catch (_) {}
      return;
    }
    try { msg.content = [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }]; } catch (_) {}
  } catch (_) {}
}

// ---- Claude ----
function injectClaudeSystem(body, prompt) {
  try {
    const sys = body.system;
    if (typeof sys === "string") {
      if (hasPrompt(sys, prompt)) return;
      const next = sys.length > 0 ? `${sys}${SEP}${prompt}` : prompt;
      try { body.system = next; } catch (_) {}
      return;
    }
    if (Array.isArray(sys)) {
      try { if (sys.some(b => b && b.text === prompt)) return; } catch (_) {}
      const block = { type: CLAUDE_BLOCK.TEXT, text: prompt };
      let lastCacheIdx = -1;
      try {
        for (let i = sys.length - 1; i >= 0; i--) {
          if (sys[i]?.cache_control) { lastCacheIdx = i; break; }
        }
      } catch (_) {}
      try {
        if (lastCacheIdx >= 0) sys.splice(lastCacheIdx, 0, block);
        else sys.push(block);
      } catch (_) {}
      return;
    }
    // absent/null
    try { body.system = prompt; } catch (_) {}
  } catch (_) {}
}

// ---- Gemini ----
function injectGeminiSystem(body, prompt) {
  try {
    let target = body;
    try {
      if (body.request && typeof body.request === "object") target = body.request;
    } catch (_) {}
    let useSnake = false;
    try { useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction"); } catch (_) {}
    const key = useSnake ? "system_instruction" : "systemInstruction";
    let sys;
    try { sys = target[key]; } catch (_) { sys = undefined; }
    if (sys && Array.isArray(sys.parts)) {
      try { if (sys.parts.some(p => p && p.text === prompt)) return; } catch (_) {}
      try { sys.parts.push({ text: prompt }); } catch (_) {}
      return;
    }
    try { target[key] = { parts: [{ text: prompt }] }; } catch (_) {}
  } catch (_) {}
}

// ---- Kiro ----
// Updates top-level systemPrompt and only the mirrored leading prefix of the
// first user history turn, else current user. next = old + SEP + prompt.
// Replace old leading prefix only; preserve time context and user tail.
function injectKiroSystem(body, prompt) {
  try {
    let oldPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
    // Repair path: a previous partial write left systemPrompt updated but user
    // content still mirroring the pre-write prefix. Re-derive the effective old
    // prefix from content so this pass converges instead of early-returning.
    const cs0 = body.conversationState;
    let firstUser0 = cs0 && Array.isArray(cs0.history)
      ? (cs0.history.find(it => it && it.userInputMessage)?.userInputMessage ?? null)
      : null;
    if (!firstUser0 && cs0?.currentMessage?.userInputMessage) firstUser0 = cs0.currentMessage.userInputMessage;

    if (firstUser0 && typeof firstUser0.content === "string" && oldPrompt && !hasPrompt(oldPrompt, prompt)) {
      const c0 = firstUser0.content;
      if (c0 === oldPrompt || (c0.startsWith(oldPrompt) && !c0.startsWith(`${oldPrompt}${SEP}`))) {
        // systemPrompt advanced past mirrored prefix → stale; treat as un-mirrored
        oldPrompt = "";
      }
    }
    if (oldPrompt && hasPrompt(oldPrompt, prompt)) return;
    const next = oldPrompt ? `${oldPrompt}${SEP}${prompt}` : prompt;

    // Atomicity: write user content first, then systemPrompt only if content
    // write succeeded (or was a no-op). If systemPrompt write then fails, the
    // repair heuristic above re-derives from content on retry — no permanent
    // half-applied state.
    const cs = body.conversationState;
    let targetMsg = null;
    try {
      const hist = Array.isArray(cs?.history) ? cs.history : null;
      if (hist) {
        for (const item of hist) {
          if (item && item.userInputMessage) { targetMsg = item.userInputMessage; break; }
        }
      }
      if (!targetMsg && cs?.currentMessage?.userInputMessage) {
        targetMsg = cs.currentMessage.userInputMessage;
      }
    } catch (_) { targetMsg = null; }

    let sysWritten = false;
    try { body.systemPrompt = next; sysWritten = true; } catch (_) {}

    const applyContent = () => {
      const content = typeof targetMsg.content === "string" ? targetMsg.content : "";
      if (oldPrompt === "") {
        // Empty old prompt: prepend unless already at head (exact, not substring)
        if (content.startsWith(prompt) || content.startsWith(next)) return;
        const newContent = content ? `${next}${SEP}${content}` : next;
        try { targetMsg.content = newContent; } catch (_) {}
        return;
      }
      if (!content.startsWith(oldPrompt)) return; // not mirrored at head — leave alone
      if (content.startsWith(next)) return; // already applied → idempotent
      const tail = content.slice(oldPrompt.length);
      try { targetMsg.content = `${next}${tail}`; } catch (_) {}
    };

    try {
      if (targetMsg) applyContent();
    } catch (_) {}
    if (sysWritten && targetMsg) {
      // verify convergence: content should now start with next (or be un-mirrored)
      let ok = false;
      try {
        const c = targetMsg.content;
        ok = typeof c !== "string" || c.startsWith(next) || !c.startsWith(oldPrompt);
      } catch (_) {}
      if (!ok) {
        try { body.systemPrompt = oldPrompt; } catch (_) {} // rollback
      }
    }
  } catch (_) {}
}
