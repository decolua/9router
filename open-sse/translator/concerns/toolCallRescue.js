// Tool-call rescue: recover a call the client would otherwise reject.
//
// Two faults arrive from the same place — a model that produced a tool call
// it did not quite finish, or spelled a name it half-remembers:
//
//   "Invalid args for tool \"Bash\": must have required property 'command'"
//   A call reached the client with an empty or partial argument object. The
//   client validated it against the schema the request declared and the turn
//   died there.
//
//   "bash" when the tool is "Bash"
//   The model emitted a different case than the request declared. Some clients
//   match names exactly, so the call lands on no tool at all.
//
// repair() in toolCallFallback.js works on the request history and cannot see
// either fault in the call the model is producing right now, and a call that
// fails validation sits in the history and keeps failing every turn after.
//
// This module reads the declared tools, then for each call the model produced:
// resolves the name case-insensitively, recovers arguments from a bare string or
// a mis-named key, and drops the call when neither is possible so the model
// gets to try again instead of the turn dying.
//
// Fail-open throughout: anything unexpected returns the call untouched, because
// a repair that mangles a working call is worse than the fault it prevents.

import { ROLE } from "../schema/roles.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM } from "../schema/blocks.js";

// A property the model spelled differently but meant. Keys are the required
// name we are filling, values are what the model may have called it instead.
// Case and separator variants are tried generically, so this only needs the
// names that differ by word, not by casing.
const ARGUMENT_ALIASES = {
  command: ["cmd", "script", "shell", "shell_command", "command_line"],
  description: ["desc", "explanation", "summary"],
  file_path: ["filepath", "filename", "file", "path"],
  path: ["file_path", "filepath", "target", "dir"],
  content: ["text", "body", "code"],
  query: ["q", "search", "search_query"],
  url: ["uri", "link", "href", "target_url"],
  old_string: ["oldstring", "old"],
  new_string: ["newstring", "new"],
};

// A bare string is only safe to lift into an argument when the tool takes
// exactly one required property and that property is a string. Anything else
// would guess at the shape.
const MAX_BARE_STRING_PROPERTIES = 1;

/**
 * `command` -> [`command_line`, `command-line`, `commandLine`, ...]
 * Split on the separator actually used, so `old_string` yields `oldString`.
 */
function spellingVariants(key) {
  const out = [key];
  const words = key.split(/[_\-\s]+/).filter(Boolean);
  if (words.length < 2) return out;

  const camel = words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
  const lower = words.join("_");
  const dashed = words.join("-");
  return [...new Set([key, camel, lower, dashed, words.join("")])];
}

function requiredOf(schema) {
  if (!schema || typeof schema !== "object") return [];
  return Array.isArray(schema.required) ? schema.required.filter((k) => typeof k === "string") : [];
}

function propertiesOf(schema) {
  if (!schema || typeof schema !== "object") return null;
  const props = schema.properties;
  return props && typeof props === "object" && !Array.isArray(props) ? props : null;
}

function isStringProperty(schema, key) {
  const props = propertiesOf(schema);
  const prop = props?.[key];
  if (!prop || typeof prop !== "object") return false;
  if (Array.isArray(prop.type)) return prop.type.includes("string");
  return prop.type === "string";
}

function parseJson(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

/**
 * indexDeclaredTools(tools) — declared name lookup, case-insensitive.
 * Also exposes the schema so a single pass serves both name resolution and the
 * required-property check.
 */
export function indexDeclaredTools(tools) {
  const index = new Map();
  if (!Array.isArray(tools)) return index;
  for (const tool of tools) {
    const raw = tool?.function?.name || tool?.name;
    if (typeof raw !== "string" || !raw) continue;
    const schema = tool?.function?.parameters ?? tool?.parameters ?? tool?.input_schema ?? null;
    const key = raw.toLowerCase();
    // First declaration wins: the request order is the client's own order, and
    // a later duplicate is the one a model is least likely to have meant.
    if (!index.has(key)) index.set(key, { name: raw, schema });
  }
  return index;
}

/**
 * Fill one missing required property from whatever the model did supply.
 * Returns the recovered value, or undefined when nothing fits.
 */
function recoverRequired(key, args, schema, bareString) {
  const candidates = [...spellingVariants(key), ...(ARGUMENT_ALIASES[key] || [])];

  // Match the donor case-insensitively and separator-insensitively: a model that
  // reached for `commandLine` meant `command` just as much as one that wrote
  // `command_line`, and comparing the raw strings is how the first attempt
  // failed.
  const normalizeKey = (k) => String(k).toLowerCase().replace(/[_\-\s]/g, "");
  const byNormalized = new Map();
  for (const argKey of Object.keys(args)) {
    const norm = normalizeKey(argKey);
    if (!byNormalized.has(norm)) byNormalized.set(norm, argKey);
  }

  let donor = null;
  for (const candidate of candidates) {
    // Skip only the literal key. Its own spelling variants normalize to the same
    // string as the key, so testing the normalized form here would discard
    // `newString` when the key is `new_string` — which is exactly the case this
    // lookup exists to catch.
    if (candidate === key) continue;
    const match = byNormalized.get(normalizeKey(candidate));
    if (match) { donor = match; break; }
  }

  const props = propertiesOf(schema);
  if (props && Object.prototype.hasOwnProperty.call(props, key) && "default" in props[key]) {
    return { value: props[key].default, donor };
  }

  // The model wrote the value as the whole argument string instead of a member
  // of it. Only unambiguous when the tool takes a single required string.
  if (bareString !== undefined && isStringProperty(schema, key) && requiredOf(schema).length === MAX_BARE_STRING_PROPERTIES) {
    return { value: bareString, donor };
  }

  if (donor) return { value: args[donor], donor };
  return undefined;
}

/**
 * rescueToolCall(call, index) — one call in, one decision out.
 *
 * @param {object} call        `{ id, function: { name, arguments } }` or the
 *                             flat `{ name, arguments }` the Claude and
 *                             Responses shapes use
 * @param {Map} index          from indexDeclaredTools
 * @returns {{call: object|null, renamed: boolean, recovered: number, unresolved: string[]}}
 *   `call` null means the arguments could not be recovered and the caller must
 *   drop it — sending it produces the exact error this module exists to stop.
 */
export function rescueToolCall(call, index) {
  const out = { call: call ?? null, renamed: false, recovered: 0, unresolved: [] };
  if (!call || typeof call !== "object") return out;
  // No declared tools means no schema to check against, and guessing from a
  // missing definition is how a working call turns into a broken one.
  if (!index || index.size === 0) return out;

  const isFlat = !call.function;
  const name = isFlat ? call.name : call.function?.name;
  if (typeof name !== "string" || !name) return out;

  const declared = index.get(name.toLowerCase());
  const schema = declared?.schema ?? null;
  if (declared && declared.name !== name) out.renamed = true;

  const rawArgs = isFlat ? call.arguments : call.function?.arguments;
  let args;
  let bareString;

  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    // Claude tool_use carries `input` as an object, not a JSON string. Copy it
    // rather than rebuilding from a string it was never in.
    args = { ...rawArgs };
  } else if (Array.isArray(rawArgs)) {
    // A JSON array is never a valid tool argument object, so nothing declared
    // as required can be satisfied from it.
    args = {};
  } else {
    args = parseJson(rawArgs);
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      // Not an object. If the model wrote a plain string where an object belonged,
      // keep it: it is the value of a single-argument tool, not a usable call.
      if (typeof rawArgs === "string" && rawArgs.trim() && !/^[[{]/.test(rawArgs.trim())) {
        bareString = rawArgs.trim();
      }
      args = {};
    }
  }

  const required = requiredOf(schema);
  for (const key of required) {
    if (Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined) continue;
    const found = recoverRequired(key, args, schema, bareString);
    if (!found) {
      out.unresolved.push(key);
      continue;
    }
    // Consume the donor key so a later required property cannot claim it too.
    if (found.donor) delete args[found.donor];
    args[key] = found.value;
    out.recovered += 1;
  }

  if (out.unresolved.length > 0) {
    out.call = null;
    return out;
  }

  const encoded = JSON.stringify(args);
  if (isFlat) out.call = { ...call, name: declared?.name || name, arguments: encoded };
  else out.call = { ...call, function: { ...call.function, name: declared?.name || name, arguments: encoded } };
  return out;
}

function rescueCarriers(carriers, index) {
  const kept = [];
  const stats = { renamed: 0, recovered: 0, dropped: 0 };
  for (const carrier of carriers) {
    const isFlat = !carrier.function;
    const result = rescueToolCall(carrier, index);
    if (result.call === null) {
      stats.dropped += 1;
      continue;
    }
    if (result.renamed) stats.renamed += 1;
    stats.recovered += result.recovered;
    kept.push(result.call);
  }
  return { kept, stats };
}

function mergeStats(target, stats) {
  target.renamed += stats.renamed;
  target.recovered += stats.recovered;
  target.dropped += stats.dropped;
  return target;
}

/**
 * rescueResponse(payload, tools) — walk every tool-call shape a client can be
 * handed, in one call. An assistant turn left with no content and no calls
 * still gets its finish_reason corrected, so a dropped call cannot leave the
 * client waiting on a turn that will never come.
 *
 * @returns {{payload: object, renamed: number, recovered: number, dropped: number}}
 */
export function rescueResponse(payload, tools) {
  const stats = { renamed: 0, recovered: 0, dropped: 0 };
  if (!payload || typeof payload !== "object") return { payload, ...stats };

  try {
    const index = indexDeclaredTools(tools);
    if (index.size === 0) return { payload, ...stats };

    for (const choice of payload.choices || []) {
      const message = choice?.message;
      if (message && Array.isArray(message.tool_calls) && message.tool_calls.length) {
        const { kept, stats: s } = rescueCarriers(message.tool_calls, index);
        mergeStats(stats, s);
        if (kept.length) {
          message.tool_calls = kept;
        } else {
          delete message.tool_calls;
          // Nothing survived, so this is a plain answer now, not a tool turn.
          if (choice.finish_reason === "tool_calls") choice.finish_reason = "stop";
          if (message.content == null) message.content = "";
        }
      }

      if (Array.isArray(message?.content)) {
        mergeStats(stats, rescueClaudeBlocks(message, index));
      }
    }

    // A Claude-format response is the message itself, not a choice inside one.
    if (Array.isArray(payload.content)) {
      mergeStats(stats, rescueClaudeBlocks(payload, index));
    }

    for (const item of payload.output || []) {
      if (item?.type !== RESPONSES_ITEM.FUNCTION_CALL && item?.type !== RESPONSES_ITEM.CUSTOM_TOOL_CALL) continue;
      const result = rescueToolCall({ name: item.name, arguments: item.arguments }, index);
      if (result.call === null) {
        item._dropped = true;
        stats.dropped += 1;
        continue;
      }
      if (result.renamed) stats.renamed += 1;
      stats.recovered += result.recovered;
      item.name = result.call.name;
      item.arguments = result.call.arguments;
    }
    if (Array.isArray(payload.output) && payload.output.some((i) => i?._dropped)) {
      payload.output = payload.output.filter((i) => !i?._dropped);
    }

    return { payload, ...stats };
  } catch {
    return { payload, ...stats };
  }
}

/**
 * rescueStreamedNames(chunk, index) — raise a streamed tool-call name back to
 * the case the request declared, and nothing else.
 *
 * A name arrives whole in the first delta of a call, so fixing it costs nothing
 * and needs no buffering. Arguments are the opposite: they arrive in fragments
 * and only form a parseable object at the end, so this deliberately does not
 * touch them. A streamed call whose arguments cannot be recovered is repaired on
 * the following turn by rescueRequest, which reads the history the client sends
 * back — too late to save this turn, but enough to stop it repeating forever.
 *
 * A `name` is only rewritten when it matches a declared tool under a
 * case-folding comparison and differs exactly, so nothing outside a tool call
 * can be renamed by accident.
 *
 * @returns {number} how many names were corrected
 */
// A tool call sits about five levels down (choices -> delta -> tool_calls ->
// function -> name), so a name deeper than this is not one. The bound is also
// what keeps a cyclic chunk from overflowing the stack on the stream path.
const MAX_STREAM_WALK_DEPTH = 12;

export function rescueStreamedNames(chunk, index, seen = new Map(), depth = 0) {
  if (!chunk || typeof chunk !== "object" || !index || index.size === 0) return 0;
  if (depth > MAX_STREAM_WALK_DEPTH) return 0;
  if (Array.isArray(chunk)) {
    let n = 0;
    for (const item of chunk) n += rescueStreamedNames(item, index, seen, depth + 1);
    return n;
  }

  let fixed = 0;
  for (const [key, value] of Object.entries(chunk)) {
    if (key === "name" && typeof value === "string") {
      const declared = index.get(value.toLowerCase());
      if (declared && declared.name !== value) {
        chunk[key] = declared.name;
        seen.set(value.toLowerCase(), declared.name);
        fixed += 1;
      }
      continue;
    }
    if (value && typeof value === "object") fixed += rescueStreamedNames(value, index, seen, depth + 1);
  }
  return fixed;
}

function inlineable(message) {
  if (message.content == null) return false;
  if (typeof message.content === "string") return true;
  if (Array.isArray(message.content)) {
    return message.content.some((b) => b?.type === "text" && typeof b.text === "string" && b.text.trim() !== "");
  }
  return false;
}

/**
 * Rescue the tool_use blocks of one Claude-format message, in place. A block
 * that cannot be recovered is removed; when that empties the turn, the stop
 * reason is corrected and an empty text block takes its place so the client is
 * handed a well-formed answer rather than a half-finished tool turn.
 */
function rescueClaudeBlocks(message, index) {
  const stats = { renamed: 0, recovered: 0, dropped: 0 };
  const uses = message.content.filter((b) => b?.type === CLAUDE_BLOCK.TOOL_USE);
  if (!uses.length) return stats;

  const keptById = new Map();
  for (const block of uses) {
    const result = rescueToolCall({ name: block.name, arguments: block.input }, index);
    if (result.call === null) { stats.dropped += 1; continue; }
    if (result.renamed) stats.renamed += 1;
    stats.recovered += result.recovered;
    keptById.set(block, result.call);
  }

  message.content = message.content.map((block) => {
    if (block?.type !== CLAUDE_BLOCK.TOOL_USE) return block;
    const rescued = keptById.get(block);
    if (!rescued) return null;
    return { ...block, name: rescued.name, input: parseJson(rescued.arguments) || {} };
  }).filter(Boolean);

  const stillTools = message.content.some((b) => b?.type === CLAUDE_BLOCK.TOOL_USE);
  if (!stillTools && !inlineable(message)) {
    message.content = [{ type: "text", text: "" }];
    if (message.stop_reason === "tool_use") message.stop_reason = "end_turn";
  }

  return stats;
}

/**
 * rescueRequest(body) — the same rules over the request history.
 *
 * This is the half that makes the fix stick. A call the client rejected stays
 * in the history the client sends back on the next turn, so without this the
 * same broken call is re-validated and rejected forever. Rescuing the history
 * lets the turn continue instead of looping on the error.
 */
export function rescueRequest(body) {
  const stats = { renamed: 0, recovered: 0, dropped: 0 };
  if (!body || typeof body !== "object") return { body, ...stats };

  try {
    const index = indexDeclaredTools(body.tools);
    if (index.size === 0) return { body, ...stats };

    for (const msg of body.messages || []) {
      if (msg?.role === ROLE.ASSISTANT && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const { kept, stats: s } = rescueCarriers(msg.tool_calls, index);
        mergeStats(stats, s);
        if (kept.length) msg.tool_calls = kept;
        else delete msg.tool_calls;
      }

      if (Array.isArray(msg.content)) {
        const uses = msg.content.filter((b) => b?.type === CLAUDE_BLOCK.TOOL_USE);
        if (!uses.length) continue;
        const { kept, stats: s } = rescueCarriers(
          uses.map((b) => ({ name: b.name, arguments: b.input })),
          index,
        );
        mergeStats(stats, s);
        const keptIds = new Set(kept.map((c) => c.name));
        msg.content = msg.content
          .filter((block) => block?.type !== CLAUDE_BLOCK.TOOL_USE || keptIds.has(block.name))
          .map((block) => {
            if (block?.type !== CLAUDE_BLOCK.TOOL_USE) return block;
            const match = kept.find((c) => c.name === block.name);
            return match ? { ...block, name: match.name, input: parseJson(match.arguments) || {} } : block;
          });
      }
    }

    return { body, ...stats };
  } catch {
    return { body, ...stats };
  }
}
