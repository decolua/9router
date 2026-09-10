import {
  KIRO_TOOL_DESCRIPTION_MAX_LENGTH,
  KIRO_TOOL_ID_MAX_LENGTH,
  KIRO_TOOL_NAME_MAX_LENGTH,
} from "../../config/kiroConstants.js";

const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TOOL_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendText(target, extra) {
  if (!extra) return;
  target.content = target.content ? `${target.content}\n\n${extra}` : extra;
}

function trimCodePoints(value, limit) {
  return [...String(value || "")].slice(0, limit).join("");
}

function uniqueName(rawName, index, usedNames) {
  const cleaned = String(rawName || "")
    .trim()
    .replace(TOOL_NAME_PATTERN, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = trimCodePoints(cleaned || `tool_${index + 1}`, KIRO_TOOL_NAME_MAX_LENGTH);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_NAME_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedNames.add(candidate);
  return candidate;
}

const STRIPPED_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "$schema",
  "$id",
  "examples",
  "default",
  "title",
]);

const TOP_LEVEL_COMBINATORS = ["allOf", "anyOf", "oneOf"];

function cleanSchemaValue(value) {
  if (Array.isArray(value)) return value.map(cleanSchemaValue);
  if (!value || typeof value !== "object") return value;

  const cleaned = {};
  for (const [key, child] of Object.entries(value)) {
    if (STRIPPED_SCHEMA_KEYS.has(key)) continue;
    if (key === "required" && Array.isArray(child) && child.length === 0) continue;
    cleaned[key] = cleanSchemaValue(child);
  }
  return cleaned;
}

function finishRootSchema(cleaned) {
  cleaned.type = "object";
  if (!cleaned.properties || typeof cleaned.properties !== "object" || Array.isArray(cleaned.properties)) {
    cleaned.properties = {};
  }
  if (Array.isArray(cleaned.required)) {
    cleaned.required = [...new Set(cleaned.required.filter(
      (name) => typeof name === "string" && Object.hasOwn(cleaned.properties, name)
    ))];
    if (cleaned.required.length === 0) delete cleaned.required;
  }
  return cleaned;
}

// Kiro rejects top-level oneOf/allOf/anyOf on tool input schemas: consume the
// combinator keys, merge every branch's properties into the root (first writer
// wins) and keep only the required entries that survive the merge. Combinators
// at nested levels are preserved — only the root is flattened.
function normalizeRootSchema(schema) {
  const source = schema && typeof schema === "object" && !Array.isArray(schema) ? clone(schema) : {};
  const branches = [];
  for (const key of TOP_LEVEL_COMBINATORS) {
    const list = source[key];
    if (!Array.isArray(list)) continue;
    for (const branch of list) {
      if (branch && typeof branch === "object" && !Array.isArray(branch)) {
        branches.push({ fromAllOf: key === "allOf", schema: branch });
      }
    }
  }
  if (branches.length === 0) {
    return finishRootSchema(cleanSchemaValue(source));
  }

  const rest = {};
  for (const [key, value] of Object.entries(source)) {
    if (TOP_LEVEL_COMBINATORS.includes(key)) continue;
    rest[key] = value;
  }
  const cleaned = cleanSchemaValue(rest);
  const properties = (cleaned.properties && typeof cleaned.properties === "object" && !Array.isArray(cleaned.properties))
    ? cleaned.properties
    : {};
  const requiredNames = new Set(
    Array.isArray(cleaned.required) ? cleaned.required.filter((name) => typeof name === "string") : []
  );
  for (const { fromAllOf, schema: branch } of branches) {
    const cleanedBranch = cleanSchemaValue(branch);
    if (cleanedBranch.properties && typeof cleanedBranch.properties === "object" && !Array.isArray(cleanedBranch.properties)) {
      for (const [name, prop] of Object.entries(cleanedBranch.properties)) {
        if (!Object.hasOwn(properties, name)) properties[name] = prop;
      }
    }
    if (fromAllOf && Array.isArray(cleanedBranch.required)) {
      for (const name of cleanedBranch.required) {
        if (typeof name === "string") requiredNames.add(name);
      }
    }
  }
  cleaned.type = "object";
  cleaned.properties = properties;
  const filtered = [...requiredNames].filter((name) => Object.hasOwn(properties, name));
  if (filtered.length > 0) cleaned.required = filtered;
  else delete cleaned.required;
  return cleaned;
}

/** Normalize OpenAI- or Claude-shaped tool definitions into Kiro tool specs. */
export function normalizeKiroToolSpecs(tools) {
  const specs = [];
  const nameMap = new Map();
  const usedNames = new Set();

  for (const [index, tool] of (Array.isArray(tools) ? tools : []).entries()) {
    if (!tool || typeof tool !== "object") continue;
    const rawName = tool.function?.name ?? tool.name;
    if (typeof rawName !== "string" || !rawName.trim()) continue;

    // A repeated definition with the same source name describes the same tool.
    if (nameMap.has(rawName)) continue;
    const name = uniqueName(rawName, index, usedNames);
    nameMap.set(rawName, name);

    const rawDescription = tool.function?.description ?? tool.description ?? `Tool: ${rawName}`;
    const description = trimCodePoints(
      String(rawDescription || `Tool: ${rawName}`),
      KIRO_TOOL_DESCRIPTION_MAX_LENGTH
    );
    const schema = tool.function?.parameters ?? tool.parameters ?? tool.input_schema ?? {};
    specs.push({
      toolSpecification: {
        name,
        description,
        inputSchema: { json: normalizeRootSchema(schema) },
      },
    });
  }

  return { specs, nameMap };
}

function toolCallText(toolUse) {
  return `[Tool call: ${toolUse?.name || "unknown"}(${text(toolUse?.input || {})})]`;
}

function toolResultText(toolResult) {
  const content = Array.isArray(toolResult?.content)
    ? toolResult.content.map((part) => text(part?.text ?? part)).filter(Boolean).join("\n")
    : text(toolResult?.content);
  return `[Tool result${toolResult?.status === "error" ? " (error)" : ""}: ${content}]`;
}

function mergeUser(target, source) {
  appendText(target, source.content);
  if (Array.isArray(source.images) && source.images.length > 0) {
    target.images = [...(target.images || []), ...source.images];
  }
  const results = source.userInputMessageContext?.toolResults;
  if (Array.isArray(results) && results.length > 0) {
    target.userInputMessageContext ||= {};
    target.userInputMessageContext.toolResults = [
      ...(target.userInputMessageContext.toolResults || []),
      ...results,
    ];
  }
}

function mergeAssistant(target, source) {
  appendText(target, source.content);
  if (Array.isArray(source.toolUses) && source.toolUses.length > 0) {
    target.toolUses = [...(target.toolUses || []), ...source.toolUses];
  }
}

function normalizeTurns(history, currentMessage, modelId) {
  const rawTurns = [...(Array.isArray(history) ? history : [])];
  if (currentMessage) rawTurns.push(currentMessage);
  const turns = [];

  for (const raw of rawTurns) {
    const isUser = !!raw?.userInputMessage;
    const isAssistant = !!raw?.assistantResponseMessage;
    if (isUser === isAssistant) continue;

    const turn = isUser
      ? { userInputMessage: clone(raw.userInputMessage) }
      : { assistantResponseMessage: clone(raw.assistantResponseMessage) };
    const previous = turns[turns.length - 1];
    if (turn.userInputMessage && previous?.userInputMessage) {
      mergeUser(previous.userInputMessage, turn.userInputMessage);
    } else if (turn.assistantResponseMessage && previous?.assistantResponseMessage) {
      mergeAssistant(previous.assistantResponseMessage, turn.assistantResponseMessage);
    } else {
      turns.push(turn);
    }
  }

  if (turns[0]?.assistantResponseMessage) {
    turns.unshift({ userInputMessage: { content: "continue", modelId } });
  }
  if (turns.length === 0 || turns[turns.length - 1]?.assistantResponseMessage) {
    turns.push({ userInputMessage: { content: "continue", modelId } });
  }

  for (const turn of turns) {
    if (turn.userInputMessage) {
      turn.userInputMessage.content = text(turn.userInputMessage.content).trim() || "continue";
      turn.userInputMessage.modelId ||= modelId;
      if (turn.userInputMessage.userInputMessageContext?.tools) {
        delete turn.userInputMessage.userInputMessageContext.tools;
      }
    } else {
      turn.assistantResponseMessage.content =
        text(turn.assistantResponseMessage.content).trim() || "...";
    }
  }
  return turns;
}

function rawId(value) {
  return typeof value === "string" ? value : "";
}

function reserveToolId(value, turnIndex, callIndex, name, usedIds) {
  const sanitized = rawId(value).replace(/[^a-zA-Z0-9_-]/g, "");
  const generated = `call_msg${turnIndex}_tc${callIndex}_${name || "tool"}`;
  const base = trimCodePoints(
    TOOL_ID_PATTERN.test(sanitized) && sanitized ? sanitized : generated,
    KIRO_TOOL_ID_MAX_LENGTH
  );
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, KIRO_TOOL_ID_MAX_LENGTH - tail.length)}${tail}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeToolInput(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) return clone(input);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return input == null ? {} : null;
}

function normalizeToolResult(result) {
  const content = Array.isArray(result?.content)
    ? result.content.map((part) => ({ text: text(part?.text ?? part) }))
    : [{ text: text(result?.content) }];
  return {
    toolUseId: rawId(result?.toolUseId),
    status: result?.status === "error" ? "error" : "success",
    content: content.length > 0 ? content : [{ text: "" }],
  };
}

function flattenResults(userMessage, results) {
  for (const result of results) appendText(userMessage, toolResultText(result));
}

function cleanUserContext(userMessage) {
  const context = userMessage.userInputMessageContext;
  if (!context) return;
  if (!context.toolResults?.length) delete context.toolResults;
  if (!context.tools?.length) delete context.tools;
  if (Object.keys(context).length === 0) delete userMessage.userInputMessageContext;
}

function reconcileToolPair(assistant, user, turnIndex, nameMap, specNames, usedIds, repairs) {
  const calls = Array.isArray(assistant.toolUses) ? assistant.toolUses : [];
  const results = Array.isArray(user.userInputMessageContext?.toolResults)
    ? user.userInputMessageContext.toolResults.map(normalizeToolResult)
    : [];
  if (calls.length === 0) {
    if (results.length > 0) {
      flattenResults(user, results);
      repairs.orphanResults += results.length;
    }
    if (user.userInputMessageContext) delete user.userInputMessageContext.toolResults;
    cleanUserContext(user);
    return;
  }

  const callQueues = new Map();
  const callRecords = calls.map((call, callIndex) => {
    const key = rawId(call?.toolUseId);
    const mappedName = nameMap.get(call?.name) || call?.name;
    const input = normalizeToolInput(call?.input);
    const record = { call, callIndex, key, mappedName, input, result: null };
    const queue = callQueues.get(key) || [];
    queue.push(record);
    callQueues.set(key, queue);
    return record;
  });

  const orphanResults = [];
  for (const result of results) {
    const queue = callQueues.get(rawId(result.toolUseId));
    const record = queue?.find((candidate) => !candidate.result);
    if (record) record.result = result;
    else orphanResults.push(result);
  }

  const keptCalls = [];
  const keptResults = [];
  for (const record of callRecords) {
    const hasSpec = typeof record.mappedName === "string" && specNames.has(record.mappedName);
    const valid = !!record.result && hasSpec && record.input !== null;
    if (!valid) {
      appendText(assistant, toolCallText({ name: record.mappedName, input: record.call?.input }));
      repairs.missingResults += record.result ? 0 : 1;
      repairs.invalidToolUses += hasSpec && record.input !== null ? 0 : 1;
      if (record.result) {
        flattenResults(user, [record.result]);
        repairs.orphanResults++;
      }
      continue;
    }

    const toolUseId = reserveToolId(
      record.key,
      turnIndex,
      record.callIndex,
      record.mappedName,
      usedIds
    );
    keptCalls.push({
      toolUseId,
      name: record.mappedName,
      input: record.input,
    });
    keptResults.push({ ...record.result, toolUseId });
  }

  if (orphanResults.length > 0) {
    flattenResults(user, orphanResults);
    repairs.orphanResults += orphanResults.length;
  }

  if (keptCalls.length > 0) assistant.toolUses = keptCalls;
  else delete assistant.toolUses;
  user.userInputMessageContext ||= {};
  if (keptResults.length > 0) user.userInputMessageContext.toolResults = keptResults;
  else delete user.userInputMessageContext.toolResults;
  cleanUserContext(user);
}

/** Validate the final Kiro wire conversation without mutating it. */
export function validateKiroConversation(history, currentMessage, toolSpecs = []) {
  const errors = [];
  const turns = [...(history || []), currentMessage].filter(Boolean);
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter(Boolean));
  const usedIds = new Set();

  for (let index = 0; index < turns.length; index++) {
    const expectedUser = index % 2 === 0;
    const isUser = !!turns[index]?.userInputMessage;
    if (isUser !== expectedUser) errors.push(`role:${index}`);
    if (!isUser) {
      const calls = turns[index].assistantResponseMessage?.toolUses || [];
      const results = turns[index + 1]?.userInputMessage?.userInputMessageContext?.toolResults || [];
      const callIds = calls.map((call) => call.toolUseId);
      const resultIds = results.map((result) => result.toolUseId);
      if (calls.length !== results.length || callIds.some((id) => !resultIds.includes(id))) {
        errors.push(`pair:${index}`);
      }
      for (const call of calls) {
        if (!call.toolUseId || usedIds.has(call.toolUseId)) errors.push(`id:${index}`);
        usedIds.add(call.toolUseId);
        if (!specNames.has(call.name)) errors.push(`spec:${index}`);
      }
    } else if (index === 0) {
      const results = turns[index].userInputMessage?.userInputMessageContext?.toolResults;
      if (results?.length) errors.push("orphan:0");
    }
  }
  if (!currentMessage?.userInputMessage?.content) errors.push("current");
  return { valid: errors.length === 0, errors };
}

function flattenAllStructuredTools(turns, repairs) {
  for (const turn of turns) {
    if (turn.assistantResponseMessage?.toolUses?.length) {
      for (const call of turn.assistantResponseMessage.toolUses) {
        appendText(turn.assistantResponseMessage, toolCallText(call));
      }
      repairs.invalidToolUses += turn.assistantResponseMessage.toolUses.length;
      delete turn.assistantResponseMessage.toolUses;
    }
    const user = turn.userInputMessage;
    const results = user?.userInputMessageContext?.toolResults;
    if (results?.length) {
      flattenResults(user, results);
      repairs.orphanResults += results.length;
      delete user.userInputMessageContext.toolResults;
      cleanUserContext(user);
    }
  }
}

/**
 * Produce a strict Kiro conversation: alternating turns, current user message,
 * adjacent one-to-one tool use/result pairs, and tool specs only on currentMessage.
 */
export function canonicalizeKiroConversation({
  history,
  currentMessage,
  modelId,
  toolSpecs = [],
  nameMap = new Map(),
} = {}) {
  const turns = normalizeTurns(history, currentMessage, modelId);
  const repairs = { missingResults: 0, orphanResults: 0, invalidToolUses: 0 };
  const specNames = new Set(toolSpecs.map((spec) => spec?.toolSpecification?.name).filter(Boolean));
  const usedIds = new Set();

  for (let index = 0; index < turns.length; index += 2) {
    const user = turns[index].userInputMessage;
    if (index === 0) {
      const leadingResults = user.userInputMessageContext?.toolResults || [];
      if (leadingResults.length > 0) {
        flattenResults(user, leadingResults);
        repairs.orphanResults += leadingResults.length;
        delete user.userInputMessageContext.toolResults;
        cleanUserContext(user);
      }
    }
    const assistant = turns[index + 1]?.assistantResponseMessage;
    const nextUser = turns[index + 2]?.userInputMessage;
    if (assistant && nextUser) {
      reconcileToolPair(assistant, nextUser, index + 1, nameMap, specNames, usedIds, repairs);
    }
  }

  const finalCurrent = turns[turns.length - 1];
  finalCurrent.userInputMessage.userInputMessageContext ||= {};
  if (toolSpecs.length > 0) {
    finalCurrent.userInputMessage.userInputMessageContext.tools = clone(toolSpecs);
  }
  cleanUserContext(finalCurrent.userInputMessage);

  let finalHistory = turns.slice(0, -1);
  let validation = validateKiroConversation(finalHistory, finalCurrent, toolSpecs);
  if (!validation.valid) {
    flattenAllStructuredTools(turns, repairs);
    finalHistory = turns.slice(0, -1);
    validation = validateKiroConversation(finalHistory, finalCurrent, toolSpecs);
  }

  return {
    history: finalHistory,
    currentMessage: finalCurrent,
    repairs,
    valid: validation.valid,
    errors: validation.errors,
  };
}
