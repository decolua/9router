/**
 * Replaying a conversation into Claude Code as a conversation.
 *
 * `claude -p` takes one prompt on stdin, so history used to be flattened into a
 * single block of text with `[User]` / `[Assistant]` / `[Tool result]` markers.
 * The model then reads a transcript *about* a conversation instead of having
 * had one: tool results are prose rather than results linked to the call that
 * produced them, and every request is a fresh giant prompt with nothing to
 * cache.
 *
 * `--input-format stream-json` takes the real thing — one JSON frame per turn,
 * with the same content blocks the API uses. Historical frames carry
 * `shouldQuery: false`, which the CLI acknowledges without calling the model
 * (measured: `num_turns: 0`, zero input tokens); only the last frame queries.
 *
 * That last frame has to be a user or tool turn — there is nothing to query
 * otherwise — so a conversation ending on an assistant message (a prefill) has
 * no replay and keeps the flattened prompt, rather than having a continuation
 * invented for it.
 */
import crypto from "node:crypto";
import { CLAUDE_CLI_TRANSCRIPT_MARKERS } from "../config/claudeCli.js";

/**
 * An attachment in the shape the CLI reads, or null.
 *
 * Two dialects arrive here. Claude's own blocks pass straight through. OpenAI's
 * `image_url` carries either a data: URL, which is the same base64 the CLI
 * wants once it is taken apart, or a remote one, which is handed over as a url
 * source — if the CLI cannot fetch it the caller gets an error, which beats an
 * image that silently was not there.
 */
function attachmentBlock(part) {
  if (!part || typeof part !== "object") return null;

  if ((part.type === "image" || part.type === "document") && part.source) return part;

  const url = part.type === "image_url"
    ? (typeof part.image_url === "string" ? part.image_url : part.image_url?.url)
    : (part.type === "input_image" ? part.image_url || part.url : null);
  if (typeof url !== "string" || !url) return null;

  const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (data) {
    return { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } };
  }
  return { type: "image", source: { type: "url", url } };
}

/** Text of one content part, for the parts that carry any. */
function partText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.input_text === "string") return part.input_text;
  return "";
}

function messageBlocks(message) {
  if (typeof message?.content === "string") {
    return message.content ? [{ type: "text", text: message.content }] : [];
  }
  if (!Array.isArray(message?.content)) return [];

  const blocks = [];
  for (const part of message.content) {
    // Tool blocks already in Claude shape pass straight through; a client that
    // speaks that dialect has given us exactly what the CLI wants.
    if (part?.type === "tool_use" || part?.type === "tool_result") {
      blocks.push(part);
      continue;
    }
    // In the order the caller sent them: an image referred to as "the first
    // one" has to still be the first one.
    const attachment = attachmentBlock(part);
    if (attachment) {
      blocks.push(attachment);
      continue;
    }

    const text = partText(part);
    if (text) blocks.push({ type: "text", text });
  }
  return blocks;
}

/** An assistant's proposed calls, in the names the CLI knows them by. */
function toolUseBlocks(message, toolPrefix) {
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.map((call, index) => {
    const name = call.function?.name || call.name || "tool";
    const rawArguments = call.function?.arguments ?? call.arguments ?? {};
    let input = {};
    if (typeof rawArguments === "string") {
      try { input = JSON.parse(rawArguments); } catch { input = {}; }
    } else if (rawArguments && typeof rawArguments === "object") {
      input = rawArguments;
    }
    return {
      type: "tool_use",
      id: call.id || `call_${index}`,
      // Namespaced again on the way back in: the model proposed the call under
      // the CLI's own MCP name, and replaying it under the caller's name would
      // be a call to a tool that never existed in this conversation.
      name: name.startsWith(toolPrefix) ? name : `${toolPrefix}${name}`,
      input,
    };
  });
}

/**
 * A tool's answer, in the shape the model reads it.
 *
 * A result can be a string or a list of content blocks — an agent that returns
 * a screenshot with its text sends the list. Stringifying the whole list put
 * JSON punctuation in front of the model instead of the blocks, and lost the
 * image entirely. Blocks pass through; anything else is described as text,
 * which is what a bare object can honestly become.
 */
function toolResultBlock(message) {
  const raw = message.content;
  let content;
  if (typeof raw === "string") {
    content = raw;
  } else if (Array.isArray(raw)) {
    const blocks = [];
    for (const part of raw) {
      const attachment = attachmentBlock(part);
      if (attachment) { blocks.push(attachment); continue; }
      const text = partText(part);
      if (text) blocks.push({ type: "text", text });
    }
    // An empty list is not a result the model can read; the original is.
    content = blocks.length ? blocks : JSON.stringify(raw);
  } else {
    content = JSON.stringify(raw ?? "");
  }
  return {
    type: "tool_result",
    tool_use_id: message.tool_call_id || message.tool_use_id || "",
    content,
  };
}

/**
 * @param {Array<object>} messages the request's messages, already OpenAI-shaped
 * @param {string} toolPrefix the CLI's MCP namespace for this server
 * @returns {{ system: string, frames: Array<object>|null }}
 *   `frames` is null when this conversation cannot be replayed and the caller
 *   should fall back to a flattened prompt.
 */
export function buildReplayFrames(messages, toolPrefix) {
  const systemParts = [];
  const turns = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    const role = String(message.role || "user");

    if (role === "system" || role === "developer") {
      const text = messageBlocks(message).map(partText).filter(Boolean).join("");
      if (text) systemParts.push(text);
      continue;
    }

    // "function" is the older OpenAI spelling of the same thing. Falling
    // through, it was caught by the catch-all below and replayed as a plain
    // user turn — a tool's output presented as something the user said.
    if (role === "tool" || role === "function") {
      // Consecutive results belong to one user turn: they answer the calls of a
      // single assistant message, and splitting them would claim turns that
      // never happened.
      const previous = turns[turns.length - 1];
      if (previous?.role === "user" && previous.isToolResult) {
        previous.blocks.push(toolResultBlock(message));
      } else {
        turns.push({ role: "user", isToolResult: true, blocks: [toolResultBlock(message)] });
      }
      continue;
    }

    if (role === "assistant") {
      const blocks = [...messageBlocks(message), ...toolUseBlocks(message, toolPrefix)];
      if (blocks.length) turns.push({ role: "assistant", blocks });
      continue;
    }

    const blocks = messageBlocks(message);
    if (blocks.length) turns.push({ role: "user", blocks });
  }

  const system = systemParts.join("\n\n");
  const last = turns[turns.length - 1];
  // Nothing to ask: no turns at all, or the conversation ends on the assistant.
  if (!last || last.role !== "user") return { system, frames: null };

  // A conversation whose tool blocks do not pair up is replayed anyway.
  // Measured on 2.1.281: a tool_result naming a call that is not there, and a
  // tool_use nothing answered, both complete normally (exit 0, subtype
  // success, the answer returned) — the CLI rebuilds the conversation rather
  // than forwarding these frames to the API, so the API's pairing rule does
  // not reach them. Histories trimmed to a context cap routinely begin in the
  // middle of a tool exchange, and refusing those would send the ordinary case
  // down the flattened path for nothing. describeFrames still reports the
  // mismatch, so it can be seen without being acted on here.
  const frames = turns.map((turn, index) => {
    const frame = {
      type: turn.role,
      message: { role: turn.role, content: turn.blocks },
    };
    // Everything before the last user turn is history: acknowledged without a
    // model call, so replaying a long conversation costs one request, not one
    // per turn.
    if (index < turns.length - 1 && turn.role === "user") frame.shouldQuery = false;
    return frame;
  });

  return { system, frames };
}

/** The frames as the CLI reads them: one JSON document per line. */
export function framesToStdin(frames) {
  return `${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`;
}

/**
 * How much of a replay can be handed to the CLI as a transcript to resume,
 * rather than as frames on stdin.
 *
 * Measured on 2.1.281 with the request bodies captured: history frames on
 * stdin (`shouldQuery: false`) are not placed as history. The CLI queues them
 * and folds them into the newest user turn — the assistant turns land first,
 * every earlier question arrives inside the newest turn behind the CLI's
 * reminders. The model then sees the conversation in the wrong order and, in
 * the live run, re-answered earlier questions. A transcript the CLI resumes is
 * placed correctly, user/assistant/tool blocks alike, and this module can
 * write one: the CLI accepts records carrying only parentUuid, uuid, type,
 * message, sessionId, cwd and timestamp, from any directory under
 * `<config>/projects/`.
 *
 * What cannot be seeded: a conversation whose query is a tool result. The CLI
 * closes any unanswered tool_use in a transcript by its own rules ("[Tool call
 * interrupted]", or a permission denial), and drops the client's result for
 * that id as a duplicate. Every combination was tried — the pair in the
 * transcript, the pair on stdin, the result alone — and none put the client's
 * result in front of the model. Those requests keep today's stdin replay,
 * which pairs them correctly.
 *
 * @returns {{ seed: Array<object>, query: object } | null}
 *   `seed` is every frame but the last, as transcript records-to-be; null when
 *   the conversation cannot be seeded.
 */
export function transcriptSeed(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return null;
  const query = frames[frames.length - 1];
  if (query?.type !== "user") return null;
  const blocks = query.message?.content;
  if (Array.isArray(blocks) && blocks.some((b) => b?.type === "tool_result")) return null;
  return { seed: frames.slice(0, -1), query };
}

/**
 * The transcript itself: one record per frame, chained by uuid, in the shape
 * the CLI's own writer produces minus everything it does not need to read
 * back (measured; see transcriptSeed).
 *
 * @param {Array<object>} seed frames from transcriptSeed
 * @param {{ sessionId: string, cwd: string, now?: number }} where
 * @returns {string} JSONL, newline-terminated
 */
export function transcriptRecords(seed, { sessionId, cwd, now = Date.now() }) {
  let parent = null;
  const lines = seed.map((frame, index) => {
    const uuid = crypto.randomUUID();
    const record = {
      parentUuid: parent,
      type: frame.type,
      message: { role: frame.message?.role || frame.type, content: frame.message?.content || [] },
      uuid,
      sessionId,
      cwd,
      // Strictly increasing and in the past; the CLI orders by it.
      timestamp: new Date(now - (seed.length - index) * 1000).toISOString(),
    };
    parent = uuid;
    return JSON.stringify(record);
  });
  return `${lines.join("\n")}\n`;
}

/**
 * What the replayed conversation looks like, without its contents.
 *
 * A request detail records `stdinChars` and a turn count, which is enough to
 * see that something was sent and nothing about what. Diagnosing a client that
 * loops needs the shape: whether a tool call was answered, whether the ids
 * line up, whether anything arrived as bare text that should have been a
 * block. The text itself stays out — it is the one part already visible in the
 * request body, and the part worth not copying twice.
 *
 * @param {Array<object>} frames
 * @param {number} tail how many of the last turns to describe
 */
export function describeFrames(frames, tail = 8) {
  if (!Array.isArray(frames) || !frames.length) return null;
  const describe = (frame) => {
    const blocks = frame?.message?.content || [];
    return {
      role: frame.type,
      ...(frame.shouldQuery === false ? { history: true } : {}),
      blocks: blocks.map((block) => {
        if (block?.type === "tool_use") return `tool_use:${block.name}#${block.id}`;
        if (block?.type === "tool_result") return `tool_result#${block.tool_use_id}`;
        if (block?.type === "text") {
          // Marked when a turn carries the flattened transcript's own syntax:
          // the model imitates it, and it should never reach a replayed turn.
          const text = String(block.text || "");
          return CLAUDE_CLI_TRANSCRIPT_MARKERS.some((marker) => text.includes(marker))
            ? `text(${text.length}) CONTAINS-TRANSCRIPT-MARKER`
            : `text(${text.length})`;
        }
        return String(block?.type || "unknown");
      }),
    };
  };
  const calls = new Set();
  const results = new Set();
  for (const frame of frames) {
    for (const block of frame?.message?.content || []) {
      if (block?.type === "tool_use" && block.id) calls.add(block.id);
      if (block?.type === "tool_result" && block.tool_use_id) results.add(block.tool_use_id);
    }
  }
  return {
    turns: frames.length,
    toolCalls: calls.size,
    toolResults: results.size,
    // A result whose call is not in the conversation is rejected upstream, and
    // is the shape a client gets into after a provider drops a call.
    orphanResults: [...results].filter((id) => !calls.has(id)).slice(0, 5),
    unansweredCalls: [...calls].filter((id) => !results.has(id)).slice(0, 5),
    lastTurns: frames.slice(-tail).map(describe),
  };
}
