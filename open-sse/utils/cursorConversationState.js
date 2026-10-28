// Conversation lineage validation and KV blob pruning/archiving for the
// Cursor AgentService path.
//
// AgentService persists conversation state as KV blobs (turn blobs, summary
// archives) plus a checkpoint frame. Resuming a checkpoint only makes sense
// while the client's message history still matches the turns it was built
// from: if the user edited a message, forked the conversation, or the client
// compacted context, replaying stored state desyncs the server session from
// what the client believes happened.
//
// The helpers here are deliberately standalone (pure functions over a Map
// blobStore + protobuf bytes) so the executor can adopt them incrementally:
//
//   - validateConversationLineage(conv, userTexts, body) → true | "compact" | false
//   - pruneAgentBlobs(blobStore, maxBlobs) → FIFO cap enforcement
//   - archiveCheckpointTurns(checkpointBytes, blobStore, opts) → new checkpoint
//
// Design notes for full wiring live in the PR body; see also the retained-
// session discussion on the fork this was extracted from.

import crypto from "crypto";
import { decodeMessage, encodeField } from "./cursorProtobuf.js";

const PROTOBUF_LEN = 2;
const PROTOBUF_VARINT = 0;

const CURSOR_CONVERSATION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TURN_ARCHIVE_THRESHOLD = 20;
const DEFAULT_MAX_BLOBS_PER_OWNER = 128;

const turnArchiveThreshold = (() => {
  const value = Number(process.env.CURSOR_TURN_ARCHIVE_THRESHOLD);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TURN_ARCHIVE_THRESHOLD;
})();

const maxBlobsPerOwner = (() => {
  const value = Number(process.env.CURSOR_MAX_BLOBS_PER_OWNER);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_BLOBS_PER_OWNER;
})();

const archiveTokenRatio = (() => {
  const value = Number(process.env.CURSOR_ARCHIVE_TOKEN_RATIO);
  return Number.isFinite(value) && value > 0 && value < 1 ? value : 0.70;
})();

export const CURSOR_AGENT_CONVERSATION_DEFAULTS = Object.freeze({
  conversationTtlMs: CURSOR_CONVERSATION_TTL_MS,
  turnArchiveThreshold,
  maxBlobsPerOwner,
  archiveTokenRatio,
});

// ─── Conversation record ────────────────────────────────────────────────
// Opaque per-owner record; callers own storage (e.g. a TTL'd Map entry).
export function createAgentConversationRecord() {
  return {
    conversationId: crypto.randomUUID(),
    checkpoint: null,       // serialized ConversationState bytes
    blobStore: new Map(),   // hex id → Buffer
    turnCount: 0,
    fingerprint: null,      // sha256 over committed user texts
    userTexts: [],          // committed prior user texts, in order
    lastAccessMs: Date.now(),
  };
}

// ─── Lineage validation ────────────────────────────────────────────────

// SHA256 over user-text turns in order; a mismatch means the client history
// no longer matches the checkpoint (edited/forked conversation) → start fresh.
export function computeLineageFingerprint(userTexts) {
  const hash = crypto.createHash("sha256");
  for (const text of userTexts) {
    hash.update(text);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function hasClientCompactMarker(body, textFromContent) {
  for (const message of body?.messages || []) {
    const text = textFromContent(message?.content);
    if (!text) continue;
    if (text.includes("[9router] Earlier context compacted")) return true;
    if (/conversation (was )?summarized|earlier conversation|context compacted/i.test(text)) return true;
  }
  return false;
}

function isLikelyClientCompact(conv, userTexts, body, textFromContent) {
  if (!conv.checkpoint) return false;
  const turns = userTexts.slice(0, -1);
  if (turns.length >= conv.turnCount) return false;
  if (hasClientCompactMarker(body, textFromContent)) return true;
  // Soft: dropped ≥2 prior turns. An empty prior after a single-turn chat
  // stays a reset (edit/replace first message) — see lineage unit tests.
  const dropped = conv.turnCount - turns.length;
  if (dropped < 2) return false;
  if (Array.isArray(conv.userTexts) && turns.every((text, index) => text === conv.userTexts[index])) {
    return true;
  }
  // Divergent short history after a multi-turn session → treat as client
  // compact: keep the checkpoint and let the server state win.
  return conv.turnCount >= 3;
}

// Compare incoming client user texts against the committed conversation.
// Returns:
//   true      — lineage holds, resume the checkpoint
//   "compact" — client compacted context; keep server state, resync lineage
//   false     — lineage broken (edit/fork/new chat); reset the conversation
// textFromContent: (content) => string, injected so this module stays free of
// executor-side content-block parsing.
export function validateConversationLineage(conv, userTexts, body = null, textFromContent = (c) => (typeof c === "string" ? c : "")) {
  if (conv.checkpoint === null) return true; // nothing stored yet → fresh
  const turns = userTexts.slice(0, -1);
  if (isLikelyClientCompact(conv, userTexts, body, textFromContent)) return "compact";
  if (Array.isArray(conv.userTexts) && conv.userTexts.length > 0) {
    if (turns.length === conv.userTexts.length) {
      return turns.every((text, index) => text === conv.userTexts[index]) ? true : false;
    }
    if (turns.length > conv.userTexts.length) {
      return conv.userTexts.every((text, index) => text === turns[index]) ? true : false;
    }
    // Shorter: only treat as compact when a non-empty prefix still matches.
    // Empty prior turns after a stored history means the first user message
    // was replaced (edit/new chat), not a multi-turn compact.
    if (turns.length > 0 && turns.every((text, index) => text === conv.userTexts[index])) {
      return "compact";
    }
    return false;
  }
  if (conv.turnCount !== turns.length) return false;
  if (conv.fingerprint === null) return true;
  return conv.fingerprint === computeLineageFingerprint(turns);
}

export function commitConversationTurn(conv, userTexts) {
  conv.turnCount = userTexts.length;
  conv.userTexts = [...userTexts];
  conv.fingerprint = computeLineageFingerprint(userTexts);
}

export function resyncConversationLineageAfterCompact(conv, userTexts) {
  conv.turnCount = userTexts.length;
  conv.userTexts = [...userTexts];
  conv.fingerprint = computeLineageFingerprint(userTexts);
}

// ─── Blob storage ──────────────────────────────────────────────────────

// FIFO prune: keep at most maxBlobs entries per owner.
export function pruneAgentBlobs(blobStore, maxBlobs = maxBlobsPerOwner) {
  let excess = blobStore.size - maxBlobs;
  if (excess <= 0) return;
  for (const key of blobStore.keys()) {
    if (excess <= 0) break;
    blobStore.delete(key);
    excess -= 1;
  }
}

// Content-addressed store: id = sha256(bytes); returns the 32-byte id.
export function storeCursorBlob(data, blobStore) {
  const bytes = Buffer.from(data);
  const id = crypto.createHash("sha256").update(bytes).digest();
  blobStore.set(id.toString("hex"), bytes);
  return new Uint8Array(id);
}

// ─── Checkpoint (de)serialization helpers ───────────────────────────────

const agentString = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentMessage = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const concatBuffers = (parts) => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export function encodeConversationSummaryArchive({
  summarizedMessages = [],
  summary = "",
  windowTail = 0,
  summaryMessage = new Uint8Array(),
} = {}) {
  const parts = summarizedMessages.map((id) => encodeField(1, PROTOBUF_LEN, Buffer.from(id)));
  if (summary) parts.push(agentString(2, summary));
  if (windowTail) parts.push(encodeField(3, PROTOBUF_VARINT, windowTail));
  if (summaryMessage?.length) parts.push(encodeField(4, PROTOBUF_LEN, Buffer.from(summaryMessage)));
  return concatBuffers(parts);
}

export function encodeConversationState({ turns = [], summaryArchives = [], clientName = "9router" } = {}) {
  const parts = [];
  for (const id of turns) parts.push(encodeField(8, PROTOBUF_LEN, Buffer.from(id)));
  for (const id of summaryArchives) parts.push(encodeField(13, PROTOBUF_LEN, Buffer.from(id)));
  if (clientName) parts.push(agentString(22, clientName));
  return concatBuffers(parts);
}

export function getStateTurnBlobIds(state) {
  return (state.get(8) || [])
    .map((entry) => entry?.value)
    .filter((value) => value instanceof Uint8Array || Buffer.isBuffer(value))
    .map((value) => Buffer.from(value));
}

export function getStateSummaryArchiveIds(state) {
  return (state.get(13) || [])
    .map((entry) => entry?.value)
    .filter((value) => value instanceof Uint8Array || Buffer.isBuffer(value))
    .map((value) => Buffer.from(value));
}

function extractAgentString(message, field) {
  const value = message?.get(field)?.[0]?.value;
  return value instanceof Uint8Array || Buffer.isBuffer(value)
    ? Buffer.from(value).toString("utf8")
    : "";
}

// Best-effort human-readable rendering of one stored turn blob, used for the
// archive summary. Returns null when the blob chain is incomplete.
function extractTextFromTurnBlob(turnBlobId, blobStore) {
  const turnData = blobStore.get(Buffer.from(turnBlobId).toString("hex"));
  if (!turnData) return null;
  const turnStruct = decodeMessage(turnData);
  const agentTurnBytes = turnStruct.get(1)?.[0]?.value;
  if (!agentTurnBytes) return null;
  const agentTurn = decodeMessage(agentTurnBytes);
  const userMsgId = agentTurn.get(1)?.[0]?.value;
  if (!userMsgId) return null;
  const userMsgData = blobStore.get(Buffer.from(userMsgId).toString("hex"));
  if (!userMsgData) return null;
  const userText = extractAgentString(decodeMessage(userMsgData), 1);
  const lines = [];
  if (userText) lines.push(`User: ${userText.slice(0, 1000)}`);
  for (const stepEntry of agentTurn.get(2) || []) {
    const stepData = blobStore.get(Buffer.from(stepEntry.value).toString("hex"));
    if (!stepData) continue;
    const step = decodeMessage(stepData);
    const message = step.get(1)?.[0]?.value;
    if (!message) continue;
    const decoded = decodeMessage(message);
    const assistant = decoded.get(1)?.[0]?.value;
    if (assistant) {
      const text = extractAgentString(decodeMessage(assistant), 1);
      if (text) lines.push(`Assistant: ${text.slice(0, 800)}`);
      continue;
    }
    // Best-effort tool step: field 2 often carries tool-call payloads.
    const tool = decoded.get(2)?.[0]?.value;
    if (tool) {
      const toolMsg = decodeMessage(tool);
      const name = extractAgentString(toolMsg, 1) || extractAgentString(toolMsg, 5) || "tool";
      lines.push(`Tool: ${String(name).slice(0, 120)}`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

// Archive old turns out of a checkpoint: renders turns beyond the retention
// window into a summary-archive blob, keeps the most recent `turnThreshold`
// turn blobs, and returns a rebuilt checkpoint.
//
// NOT LOSSY: if any old turn blob is missing or cannot be rendered, the
// original checkpoint is returned untouched — an incomplete archive is worse
// than a long turn list.
export function archiveCheckpointTurns(checkpointBytes, blobStore, {
  turnThreshold = turnArchiveThreshold,
  force = false,
} = {}) {
  if (!checkpointBytes?.length || !blobStore) return checkpointBytes;
  const state = decodeMessage(checkpointBytes);
  const turnIds = getStateTurnBlobIds(state);
  if (!force && turnIds.length <= turnThreshold) return checkpointBytes;

  const keep = Math.min(turnThreshold, turnIds.length);
  if (keep >= turnIds.length) return checkpointBytes;
  const oldIds = turnIds.slice(0, turnIds.length - keep);
  const recentIds = turnIds.slice(-keep);
  const archiveLines = [`[Earlier conversation — ${oldIds.length} turn(s)]\n`];
  let archivedCount = 0;
  for (let i = 0; i < oldIds.length; i++) {
    const text = extractTextFromTurnBlob(oldIds[i], blobStore);
    if (!text) continue; // skip missing blobs; only archive when all representable
    archiveLines.push(`Turn ${i + 1}:\n${text}`);
    archiveLines.push("");
    archivedCount += 1;
  }
  // Conservative: only replace turns when every old turn could be represented.
  if (archivedCount !== oldIds.length) return checkpointBytes;

  const archiveBlobId = storeCursorBlob(
    encodeConversationSummaryArchive({
      summarizedMessages: oldIds,
      summary: archiveLines.join("\n"),
      windowTail: oldIds.length,
    }),
    blobStore,
  );
  pruneAgentBlobs(blobStore);

  // Rebuild the checkpoint: preserve every other field verbatim, replace the
  // turn list with the retained tail, append the new summary archive.
  const parts = [];
  for (const [field, entries] of state.entries()) {
    if (field === 8 || field === 13 || field === 11) continue;
    for (const entry of entries) {
      if (entry.wireType === PROTOBUF_LEN) parts.push(encodeField(field, PROTOBUF_LEN, entry.value));
      else if (entry.wireType === PROTOBUF_VARINT) parts.push(encodeField(field, PROTOBUF_VARINT, entry.value));
    }
  }
  for (const id of recentIds) parts.push(encodeField(8, PROTOBUF_LEN, id));
  for (const id of getStateSummaryArchiveIds(state)) parts.push(encodeField(13, PROTOBUF_LEN, id));
  parts.push(encodeField(13, PROTOBUF_LEN, Buffer.from(archiveBlobId)));
  return concatBuffers(parts);
}

// Token-pressure archive trigger: archive when usage crosses the ratio.
export function shouldArchiveByTokenUsage(tokenUsage, ratio = archiveTokenRatio) {
  const used = Number(tokenUsage?.used) || 0;
  const max = Number(tokenUsage?.max) || 0;
  return max > 0 && used > 0 && used / max >= ratio;
}
