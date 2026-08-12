// Orchestration nudge: the user's delegation rule lives in ~/.claude/CLAUDE.md,
// but a rule read once at the start of a session is buried under 174K of context
// by turn 40 and stops being acted on. Session dce6e9bd ran 83 consecutive
// novel-context tool calls (all cat/grep/find) with zero delegations, served by a
// legitimate Fenrir-band model that had received the rule and the Agent tool
// intact. The rule was delivered; it was forgotten.
//
// The counter does not have to be remembered, because the client sends the whole
// conversation on every turn — every tool_use block is right there in the request
// body. So the router recomputes it per request and states the actual number at
// the moment it matters, instead of relying on the model to have kept score.
//
// Deliberately STATELESS, unlike disciplineNudge: that one corrects a past event
// and so must self-clear, whereas this reflects a condition that is still true.
// It should keep firing for as long as the session is over cap, and stops on its
// own the moment a delegation resets the count.
//
// Fail-open like every rtk hook: any error leaves the body untouched.

import { injectSystemPrompt } from "./systemInject.js";

// Tool calls that pull UNSEEN content into the lead's context. These are the ones
// that make an inline turn expensive, because everything they return is re-sent on
// every later turn. Pure manipulation of what is already in context (Edit, Write,
// TodoWrite) is correctly cheaper inline and is not counted.
export const NOVEL_CONTEXT_TOOLS = new Set([
  "Read", "Grep", "Glob", "Bash", "PowerShell",
  "WebFetch", "WebSearch", "NotebookRead",
]);

export const DELEGATION_TOOLS = new Set(["Agent", "Task"]);

// Matches the cap in ~/.claude/CLAUDE.md, which is the observed median gap between
// delegations — so the cap preserves the healthy mode and clips only the tail.
export const NOVEL_CONTEXT_CAP = 6;

function toolNamesFromMessage(msg) {
  const out = [];
  if (!msg || typeof msg !== "object") return out;

  // Claude shape: content[] blocks of {type:"tool_use", name, input}
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block && block.type === "tool_use" && block.name) {
        out.push({ name: block.name, input: block.input });
      }
    }
  }
  // OpenAI shape: tool_calls[] of {function:{name, arguments}}
  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      const name = call?.function?.name;
      if (!name) continue;
      let input = null;
      try {
        input = call.function.arguments ? JSON.parse(call.function.arguments) : null;
      } catch { input = null; }   // malformed args are a discipline problem, not ours
      out.push({ name, input });
    }
  }
  // Gemini shape: parts[] of {functionCall:{name, args}}
  if (Array.isArray(msg.parts)) {
    for (const part of msg.parts) {
      const fc = part?.functionCall;
      if (fc?.name) out.push({ name: fc.name, input: fc.args });
    }
  }
  return out;
}

function messagesOf(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.contents)) return body.contents;
  if (body.request && Array.isArray(body.request.contents)) return body.request.contents;
  return null;
}

/**
 * Walk the conversation backwards to the most recent delegation and count the
 * novel-context tool calls made since. Returns null when the shape is unreadable,
 * so callers can no-op rather than guess.
 */
export function countSinceLastDelegation(body) {
  const messages = messagesOf(body);
  if (!messages) return null;

  let novel = 0;
  let sawDelegation = false;
  let unspecifiedModel = 0;
  let consecutiveDelegations = 0;
  let countingConsecutive = true;

  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = toolNamesFromMessage(messages[i]);
    for (let j = calls.length - 1; j >= 0; j--) {
      const { name, input } = calls[j];

      if (DELEGATION_TOOLS.has(name)) {
        // Every spawn must name its role explicitly. All 26 recursive spawns
        // measured in this user's history omitted it and silently inherited the
        // lead's expensive model.
        if (!input || typeof input.model !== "string" || !input.model) unspecifiedModel += 1;
        if (countingConsecutive) consecutiveDelegations += 1;
        sawDelegation = true;
        return { novel, sawDelegation, unspecifiedModel, consecutiveDelegations };
      }

      if (NOVEL_CONTEXT_TOOLS.has(name)) {
        novel += 1;
        countingConsecutive = false;
      }
    }
  }
  return { novel, sawDelegation, unspecifiedModel, consecutiveDelegations };
}

export function buildNudge({ novel, unspecifiedModel }) {
  if (novel >= NOVEL_CONTEXT_CAP * 2) {
    return (
      `Orchestration: you have made ${novel} tool calls pulling unseen content into ` +
      `context since your last delegation. The cap is ${NOVEL_CONTEXT_CAP}, and you are ` +
      `now ${novel - NOVEL_CONTEXT_CAP} over it. Stop exploring inline and delegate the ` +
      `remainder now — spawn Explore for research, naming the role's model explicitly ` +
      `(haiku=worker, sonnet=analyst, opus=lead). Do not re-judge whether the task feels ` +
      `simple; the count is the trigger. Every further inline read is re-sent on every ` +
      `remaining turn of this session.`
    );
  }
  if (novel >= NOVEL_CONTEXT_CAP) {
    let msg =
      `Orchestration: ${novel} tool calls have pulled unseen content into context since ` +
      `your last delegation, and the cap is ${NOVEL_CONTEXT_CAP}. Delegate the remainder ` +
      `rather than continuing inline — use Explore for research and state the model ` +
      `explicitly on the spawn.`;
    if (unspecifiedModel > 0) {
      msg += ` Your last delegation named no model, so it inherited this session's model instead of a cheaper one.`;
    }
    return msg;
  }
  return null;
}

/**
 * Compute the count from the SOURCE body (pre-translation, where tool blocks are
 * still in the client's shape) and inject into the FINAL body (post-translation),
 * which is why this takes both. Returns the nudge tier for logging, or null.
 */
export function injectOrchestrationNudge(finalBody, format, sourceBody) {
  try {
    const stats = countSinceLastDelegation(sourceBody);
    if (!stats) return null;
    const prompt = buildNudge(stats);
    if (!prompt) return null;
    injectSystemPrompt(finalBody, format, prompt);
    return stats.novel >= NOVEL_CONTEXT_CAP * 2 ? "firm" : "remind";
  } catch {
    return null;   // fail-open: never break a request over a nudge
  }
}
