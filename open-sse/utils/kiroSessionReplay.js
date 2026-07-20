import { MEMORY_CONFIG } from "../config/runtimeConfig.js";

const sessionStartStore = new Map();
const MAX_SESSION_STARTS = 5000;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sessionKey(connectionId, conversationId) {
  return `${connectionId || ""}:${conversationId || ""}`;
}

function ensureUserMessageModelId(message, modelId) {
  if (message?.userInputMessage && !message.userInputMessage.modelId && modelId) {
    message.userInputMessage.modelId = modelId;
  }
  return message;
}

function ensureHistoryModelIds(history, modelId) {
  for (const item of history || []) {
    ensureUserMessageModelId(item, modelId);
  }
  return history;
}

function prefixUserMessage(message, contentPrefix, modelId) {
  const out = clone(message) || { userInputMessage: { content: "" } };
  if (!out.userInputMessage) out.userInputMessage = { content: "" };
  ensureUserMessageModelId(out, modelId);
  if (contentPrefix) {
    const content = out.userInputMessage.content || "";
    out.userInputMessage.content = content
      ? `${contentPrefix}\n\n${content}`
      : contentPrefix;
  }
  return out;
}

function findFirstUserIndex(history) {
  return history.findIndex((item) => item?.userInputMessage);
}

function rememberSessionStart(key, entry) {
  if (sessionStartStore.size >= MAX_SESSION_STARTS) {
    sessionStartStore.delete(sessionStartStore.keys().next().value);
  }
  sessionStartStore.set(key, { ...entry, lastUsed: Date.now() });
}

/**
 * Preserve Kiro cacheability by freezing the first user message (`msg0`) for a
 * session, replaying that exact message as the first history user on later
 * turns, and injecting volatile current-time context only into the current turn.
 */
export function applyKiroSessionReplay({
  conversationId,
  connectionId,
  modelId,
  systemPrompt = "",
  contentPrefix = "",
  currentContentPrefix = "",
  history = [],
  currentMessage,
} = {}) {
  const key = sessionKey(connectionId, conversationId);
  const existing = conversationId ? sessionStartStore.get(key) : null;
  const baseHistory = clone(history) || [];
  const baseCurrent = clone(currentMessage) || { userInputMessage: { content: "" } };

  if (existing && existing.modelId === modelId && existing.systemPrompt === systemPrompt) {
    existing.lastUsed = Date.now();
    const firstUserIndex = findFirstUserIndex(baseHistory);
    const sessionStart = ensureUserMessageModelId(clone(existing.sessionStart), modelId);
    if (firstUserIndex >= 0) {
      baseHistory[firstUserIndex] = sessionStart;
    } else {
      baseHistory.unshift(sessionStart);
    }
    return {
      history: ensureHistoryModelIds(baseHistory, modelId),
      currentMessage: prefixUserMessage(baseCurrent, currentContentPrefix, modelId),
      replayed: true,
    };
  }

  const firstUserIndex = findFirstUserIndex(baseHistory);
  let sessionStart;
  let nextCurrent = ensureUserMessageModelId(baseCurrent, modelId);
  if (firstUserIndex >= 0) {
    sessionStart = prefixUserMessage(baseHistory[firstUserIndex], contentPrefix, modelId);
    baseHistory[firstUserIndex] = clone(sessionStart);
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
  } else {
    sessionStart = prefixUserMessage(baseCurrent, contentPrefix, modelId);
    nextCurrent = clone(sessionStart);
  }

  if (conversationId) {
    rememberSessionStart(key, {
      sessionStart: clone(sessionStart),
      modelId,
      systemPrompt,
    });
  }

  return {
    history: ensureHistoryModelIds(baseHistory, modelId),
    currentMessage: nextCurrent,
    replayed: false,
  };
}

export function clearKiroSessionReplayStore() {
  sessionStartStore.clear();
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionStartStore) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) sessionStartStore.delete(key);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (cleanup.unref) cleanup.unref();
