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

function hasToolResults(message) {
  return !!message?.userInputMessage?.userInputMessageContext?.toolResults?.length;
}

function canReplaceSessionStart(history, firstUserIndex) {
  return firstUserIndex === 0 && !hasToolResults(history[firstUserIndex]);
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
    if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
      baseHistory[firstUserIndex] = sessionStart;
    } else {
      baseHistory.unshift(sessionStart);
      if (baseHistory.length === 1) {
        baseHistory.push({ assistantResponseMessage: { content: "..." } });
      }
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
  if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
    sessionStart = prefixUserMessage(baseHistory[firstUserIndex], contentPrefix, modelId);
    baseHistory[firstUserIndex] = clone(sessionStart);
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
  } else if (firstUserIndex >= 0) {
    sessionStart = prefixUserMessage(
      { userInputMessage: { content: "", modelId } },
      contentPrefix,
      modelId
    );
    baseHistory.unshift(clone(sessionStart));
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
  } else {
    // No existing history: msg0 = contentPrefix + first user turn content.
    // The thinking/agentic prefix is frozen into msg0 for cacheability
    // (#2989: top-level systemPrompt removed). The first user content is
    // also frozen here so it replays verbatim on subsequent turns. The
    // current turn gets baseCurrent + currentContentPrefix (per-turn
    // context like the current time).
    sessionStart = prefixUserMessage(baseCurrent, contentPrefix, modelId);
    baseHistory.unshift(clone(sessionStart));
    // Mark msg0 as frozen so normalizeTurns() does not merge it into the
    // current turn (which would duplicate user content + corrupt msg0).
    if (baseHistory[0]?.userInputMessage) {
      baseHistory[0].userInputMessage.userInputMessageContext ||= {};
      baseHistory[0].userInputMessage.userInputMessageContext._frozenMsg0 = true;
    }
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId);
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
