const DEFAULTS = Object.freeze({
  hardThreshold: 6,
  longContextChars: 24000,
  largeToolResultChars: 12000,
});

const TASK_ACTION_TERMS = ["audit", "review", "investigate", "analyze", "analyse", "assess", "diagnose", "debug", "refactor", "redesign", "restructure", "harden", "optimize", "optimise", "benchmark", "profile", "trace", "reproduce", "resolve", "rewrite", "overhaul", "plan", "implement", "survey"];
const COMPLEX_ACTION_TERMS = new Set(TASK_ACTION_TERMS.filter((term) => !["plan", "implement", "resolve"].includes(term)));
const LEADING_TASK_FILLERS = new Set(["can", "could", "would", "will", "please", "kindly", "you", "help", "me", "with", "to", "i", "we", "need", "want", "like", "fully", "deeply", "thoroughly"]);
const STRONG_TASK_PHRASES = [
  { reason: "audit", terms: ["fully audit", "deep review", "deep repository audit"] },
  { reason: "architecture", terms: ["design the architecture", "design architecture", "repository restructure", "rollback procedures", "repository-wide", "multi-file", "cross-component", "cross component"] },
  { reason: "concurrency", terms: ["race condition", "concurrency", "stale-write", "stale write"] },
  { reason: "root-cause", terms: ["root cause", "debug intermittent", "intermittent failing tests", "failing tests with unclear cause", "failures with unclear causes", "unclear failure"] },
  { reason: "performance", terms: ["performance investigation"] },
];
const GATED_TERMS = [
  { reason: "architecture", terms: ["architecture", "migration", "migrate", "rollback"] },
  { reason: "security", terms: ["security", "authentication", "permissions"] },
];
const PUNCTUATED_PHRASES = new Set([...STRONG_TASK_PHRASES, ...GATED_TERMS]
  .flatMap((group) => group.terms)
  .map((term) => term.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean).join(" ")));
const TEXT_FIELDS = ["text", "content", "input_text", "output_text", "arguments", "output"];
const USER_TEXT_FIELDS = ["text", "content", "input_text"];
const PART_FIELDS = ["content", "parts", "input"];
const MODALITY_TYPES = new Set(["image_url", "input_image", "input_file", "file", "document", "input_audio", "input_video"]);

function own(value, key) {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function requestSource(body) {
  const nested = own(body, "request");
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : body;
}

export function requestCollections(body) {
  const source = requestSource(body);
  const messages = own(source, "messages");
  if (Array.isArray(messages) && messages.length) return [{ items: messages, stringInput: false }];
  const input = own(source, "input");
  if (Array.isArray(input) && input.length) return [{ items: input, stringInput: false }];
  if (typeof input === "string" && input.trim()) return [{ items: [input], stringInput: true }];
  const contents = own(source, "contents");
  if (Array.isArray(contents) && contents.length) return [{ items: contents, stringInput: false }];
  return [];
}

function isToolResult(value) {
  return own(value, "role") === "tool" || own(value, "type") === "tool_result" || own(value, "type") === "function_call_output";
}

function contentLength(value, state, seen = new Set(), inToolResult = false) {
  if (typeof value === "string") {
    if (inToolResult) state.toolResultChars += value.length;
    return value.length;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  const toolResult = inToolResult || isToolResult(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + contentLength(item, state, seen, toolResult), 0);
  let size = 0;
  for (const key of TEXT_FIELDS) {
    const text = own(value, key);
    if (typeof text === "string") {
      size += text.length;
      if (toolResult || key === "output") state.toolResultChars += text.length;
    }
  }
  for (const key of PART_FIELDS) {
    const child = own(value, key);
    if (Array.isArray(child)) size += contentLength(child, state, seen, toolResult);
  }
  return size;
}

function hasModality(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasModality(item, seen));
  if (MODALITY_TYPES.has(own(value, "type"))) return true;
  if ([...MODALITY_TYPES].some((key) => own(value, key) !== undefined)) return true;
  return PART_FIELDS.some((key) => {
    const child = own(value, key);
    return Array.isArray(child) && hasModality(child, seen);
  });
}

function userText(value, seen = new Set()) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => userText(item, seen)).join(" ");
  let text = "";
  for (const key of USER_TEXT_FIELDS) {
    const child = own(value, key);
    if (typeof child === "string") text += ` ${child}`;
  }
  for (const key of PART_FIELDS) {
    const child = own(value, key);
    if (Array.isArray(child)) text += ` ${userText(child, seen)}`;
  }
  return text.trim();
}

function inspectToolActivity(value, state, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) inspectToolActivity(item, state, seen);
    return;
  }
  const type = own(value, "type");
  const calls = own(value, "tool_calls");
  if (isToolResult(value)) state.toolResults += 1;
  if (Array.isArray(calls)) state.toolCalls += calls.length;
  else if (type === "function_call" || type === "tool_use" || (own(value, "role") === "assistant" && own(value, "function_call"))) state.toolCalls += 1;
  for (const key of PART_FIELDS) inspectToolActivity(own(value, key), state, seen);
}

function inspectItem(item, state) {
  const role = own(item, "role");
  const type = own(item, "type");
  inspectToolActivity(item, state);
  const modalityPresent = hasModality(item);
  if (modalityPresent) state.modalities += 1;
  if (role === "user" || type === "input_text") {
    const text = userText(own(item, "content") ?? own(item, "parts") ?? own(item, "input") ?? item);
    state.userTexts.push(text);
    if (text || modalityPresent) state.userContextItems += 1;
  }
}

export function inspectRequest(body) {
  const state = { chars: 0, systemChars: 0, messageCount: 0, systemMessages: 0, itemCount: 0, userContextItems: 0, toolCalls: 0, toolResults: 0, toolResultChars: 0, modalities: 0, userTexts: [] };
  if (!body || typeof body !== "object" || Array.isArray(body)) return state;
  for (const { items, stringInput } of requestCollections(body)) {
    for (const item of items) {
      state.itemCount += 1;
      if (stringInput) {
        state.messageCount += 1;
        state.chars += item.length;
        state.userTexts.push(item);
        state.userContextItems += 1;
        continue;
      }
      const role = own(item, "role");
      const length = contentLength(item, state);
      if (role === "system" || role === "developer") {
        state.systemMessages += 1;
        state.systemChars += length;
      } else {
        state.messageCount += 1;
        state.chars += length;
      }
      inspectItem(item, state);
    }
  }
  return state;
}

function addIntentChunk(tokens, chunk, quoted) {
  const normalized = chunk.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!normalized) return;
  if (/[._/\\]/u.test(normalized) || /\p{Ll}\p{M}*\p{Lu}/u.test(normalized)) {
    tokens.push({ value: normalized, quoted });
    return;
  }
  const parts = normalized.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  const punctuated = /[^\p{L}\p{N}\p{M}\s]/u.test(normalized);
  if (punctuated && parts.length > 1 && !PUNCTUATED_PHRASES.has(parts.join(" "))) {
    tokens.push({ value: normalized, quoted });
    return;
  }
  for (const part of parts) tokens.push({ value: part, quoted });
}

function intentTokens(text) {
  const tokens = [];
  let chunk = "", quote = null, escaped = false, quoted = false;
  const flush = () => { addIntentChunk(tokens, chunk, quoted); chunk = ""; };
  for (const character of text) {
    if (quote) {
      if (escaped) { chunk += character; escaped = false; }
      else if (character === "\\") escaped = true;
      else if (character === quote) { flush(); quote = null; quoted = false; }
      else chunk += character;
    } else if (character === '"' || character === "`" || character === "'") {
      flush(); quote = character; quoted = true;
    } else if (/\s/u.test(character)) flush();
    else chunk += character;
  }
  flush();
  return tokens;
}

function hasTerm(tokens, term, allowQuoted = false) {
  const phrase = term.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  return tokens.some((token, index) => phrase.every((part, offset) => tokens[index + offset]?.value === part && (allowQuoted || !tokens[index + offset].quoted)));
}

function firstTaskAction(tokens) {
  for (const token of tokens) {
    if (token.quoted || LEADING_TASK_FILLERS.has(token.value)) continue;
    return token.value;
  }
  return null;
}

export function keywordMatches(text) {
  const tokens = intentTokens(text);
  const action = firstTaskAction(tokens);
  const taskOriented = TASK_ACTION_TERMS.includes(action);
  const complexAction = COMPLEX_ACTION_TERMS.has(action);
  const reasonsFor = (groups, allowQuoted = false) => groups.filter((group) => group.terms.some((term) => hasTerm(tokens, term, allowQuoted))).map((group) => group.reason);
  return {
    strong: reasonsFor(STRONG_TASK_PHRASES),
    complexAction,
    gated: taskOriented ? reasonsFor(GATED_TERMS, true) : [],
  };
}

function hasUsableRoutingContext(state) {
  return state.userContextItems > 0;
}

function conservative(reason, config, metadata = {}) {
  return { level: "hard", score: config.hardThreshold, escalationScore: config.hardThreshold, reasons: [reason], metadata };
}

export function classifyTaskComplexity(body, config = DEFAULTS) {
  const settings = { ...DEFAULTS, ...config };
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return conservative("invalid-request", settings);
    const state = inspectRequest(body);
    const metadata = { chars: state.chars, systemChars: state.systemChars, messages: state.messageCount, systemMessages: state.systemMessages, toolCalls: state.toolCalls, toolResults: state.toolResults, toolResultChars: state.toolResultChars, modalities: state.modalities };
    if (state.itemCount === 0) return conservative("empty-request", settings, metadata);
    if (!hasUsableRoutingContext(state, settings)) return conservative("contextless-request", settings, metadata);
    let escalationScore = 0;
    const reasons = [];
    const add = (points, reason) => { escalationScore += points; reasons.push(reason); };
    if (state.chars >= settings.longContextChars) add(4, "large-context");
    else if (state.chars >= Math.floor(settings.longContextChars / 3)) add(2, "medium-context");
    if (state.messageCount >= 16) add(3, "long-history");
    else if (state.messageCount >= 8) add(1, "multi-turn-history");
    if (state.toolCalls + state.toolResults >= 8) add(3, "substantial-tool-history");
    else if (state.toolCalls + state.toolResults >= 3) add(2, "repeated-tool-history");
    if (state.toolResultChars >= settings.largeToolResultChars) add(4, "large-tool-result-history");
    else if (state.toolResultChars >= Math.floor(settings.largeToolResultChars / 3)) add(2, "medium-tool-result-history");
    if (state.modalities >= 3) add(2, "multiple-modalities");
    else if (state.modalities > 0) add(1, "modality-present");
    const scoreText = (text, factor = 1) => {
      const matches = keywordMatches(text);
      for (const reason of matches.strong) add(6 * factor, reason);
      if (matches.complexAction && matches.strong.length === 0) add(6 * factor, "complex-action");
      for (const reason of matches.gated) add(6 * factor, reason);
    };
    scoreText(state.userTexts.at(-1) || "");
    let historical = 0;
    const historicalCap = Math.min(4, Math.max(0, settings.hardThreshold - 1));
    for (const previous of state.userTexts.slice(0, -1)) {
      const before = escalationScore;
      scoreText(previous, 1 / 3);
      const contribution = escalationScore - before;
      if (historical + contribution > historicalCap) escalationScore -= historical + contribution - historicalCap;
      historical = Math.min(historicalCap, historical + contribution);
      if (historical === historicalCap) break;
    }
    const publicScore = Math.min(escalationScore, settings.hardThreshold + 1);
    return {
      level: publicScore >= settings.hardThreshold ? "hard" : "easy",
      score: publicScore,
      escalationScore,
      reasons: [...new Set(reasons)],
      metadata,
    };
  } catch {
    return conservative("classifier-error", settings);
  }
}

export { DEFAULTS };
