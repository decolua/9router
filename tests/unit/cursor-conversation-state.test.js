import { describe, expect, it } from "vitest";
import {
  archiveCheckpointTurns,
  commitConversationTurn,
  computeLineageFingerprint,
  createAgentConversationRecord,
  encodeConversationState,
  encodeConversationSummaryArchive,
  getStateSummaryArchiveIds,
  getStateTurnBlobIds,
  pruneAgentBlobs,
  resyncConversationLineageAfterCompact,
  shouldArchiveByTokenUsage,
  storeCursorBlob,
  validateConversationLineage,
  CURSOR_AGENT_CONVERSATION_DEFAULTS,
} from "../../open-sse/utils/cursorConversationState.js";
import { decodeMessage, encodeField } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;

// Minimal AgentTurn-style turn blob the archive renderer understands:
// ConversationState.turns[i] → blob → { 1: AgentTurn }, AgentTurn = {
//   1: user-message blob id, 2*: step blob ids },
// user-message blob = { 1: string text }.
function buildTurnBlob(blobStore, { userText = "hello", assistantTexts = [] } = {}) {
  const userMsg = encodeField(1, LEN, userText);
  const userMsgId = storeCursorBlob(userMsg, blobStore);
  const turnParts = [encodeField(1, LEN, userMsgId)];
  for (const text of assistantTexts) {
    const assistantMessage = encodeField(1, LEN, text);
    const message = encodeField(1, LEN, assistantMessage);
    const step = encodeField(1, LEN, message);
    turnParts.push(encodeField(2, LEN, storeCursorBlob(step, blobStore)));
  }
  return storeCursorBlob(
    encodeField(1, LEN, Buffer.concat(turnParts.map(Buffer.from))),
    blobStore,
  );
}

function buildCheckpoint(blobStore, turnSpecs, extras = []) {
  const turnIds = turnSpecs.map((spec) => Buffer.from(buildTurnBlob(blobStore, spec)));
  return Buffer.from(encodeConversationState({ turns: turnIds, summaryArchives: extras }));
}

function committed(texts) {
  const conv = createAgentConversationRecord();
  commitConversationTurn(conv, texts);
  conv.checkpoint = Buffer.from([0x08, 0x01]); // non-null marker
  return conv;
}

describe("createAgentConversationRecord", () => {
  it("starts with empty state and a fresh conversation id", () => {
    const conv = createAgentConversationRecord();
    expect(conv.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(conv.checkpoint).toBeNull();
    expect(conv.blobStore).toBeInstanceOf(Map);
    expect(conv.blobStore.size).toBe(0);
    expect(conv.turnCount).toBe(0);
    expect(conv.userTexts).toEqual([]);
    expect(conv.fingerprint).toBeNull();
  });

  it("independent records get independent ids", () => {
    expect(createAgentConversationRecord().conversationId)
      .not.toBe(createAgentConversationRecord().conversationId);
  });
});

describe("computeLineageFingerprint", () => {
  it("is order-sensitive", () => {
    expect(computeLineageFingerprint(["a", "b"]))
      .not.toBe(computeLineageFingerprint(["b", "a"]));
  });

  it("separates texts with a NUL delimiter (no concat collisions)", () => {
    expect(computeLineageFingerprint(["ab", "c"]))
      .not.toBe(computeLineageFingerprint(["a", "bc"]));
  });

  it("changes when a text is edited", () => {
    expect(computeLineageFingerprint(["hello"]))
      .not.toBe(computeLineageFingerprint(["hello!"]));
  });
});

describe("validateConversationLineage", () => {
  it("returns true when nothing is stored yet", () => {
    const conv = createAgentConversationRecord();
    expect(validateConversationLineage(conv, ["anything"])).toBe(true);
  });

  it("returns true when prior turns match the committed history", () => {
    const conv = committed(["q1", "q2", "q3"]);
    expect(validateConversationLineage(conv, ["q1", "q2", "q3", "q4"])).toBe(true);
  });

  it("returns false when a prior turn was edited", () => {
    const conv = committed(["q1", "q2", "q3"]);
    expect(validateConversationLineage(conv, ["q1-EDITED", "q2", "q3", "q4"])).toBe(false);
  });

  it("returns \"compact\" when history drops to zero after a multi-turn session (fork keeps server state)", () => {
    // Vacuous prefix match: turns.every(...) on an empty list is true once
    // dropped ≥ 2, so the fork treats a bare new message after ≥3 committed
    // turns as a client compact rather than a reset.
    const conv = committed(["q1", "q2", "q3"]);
    expect(validateConversationLineage(conv, ["fresh question"])).toBe("compact");
  });

  it("returns false when history drops to zero after a single-turn session (edit/new chat)", () => {
    const conv = committed(["only-question"]);
    expect(validateConversationLineage(conv, ["new question"])).toBe(false);
  });

  it("returns \"compact\" when a matching prefix was dropped (multi-turn compact)", () => {
    const conv = committed(["q1", "q2", "q3", "q4"]);
    // Client kept q3, q4 as priors after compacting q1, q2.
    expect(validateConversationLineage(conv, ["q3", "q4", "q5"])).toBe("compact");
  });

  it("detects client compaction from an explicit marker text", () => {
    const conv = committed(["q1", "q2", "q3"]);
    const body = { messages: [{ role: "user", content: "[9router] Earlier context compacted. q3" }] };
    expect(validateConversationLineage(conv, ["q3"], body)).toBe("compact");
  });

  it("single dropped turn after a single-turn chat is a reset, not a compact", () => {
    const conv = committed(["only-question"]);
    expect(validateConversationLineage(conv, ["new question"])).toBe(false);
  });

  it("returns true when turns extend the committed history (assistant turns had no user text)", () => {
    const conv = committed(["q1"]);
    expect(validateConversationLineage(conv, ["q1", "tool-result", "q2"])).toBe(true);
  });

  it("falls back to turnCount+fingerprint when userTexts is empty", () => {
    const conv = createAgentConversationRecord();
    conv.checkpoint = Buffer.from([0x08, 0x01]);
    conv.turnCount = 2;
    conv.fingerprint = computeLineageFingerprint(["a", "b"]);
    expect(validateConversationLineage(conv, ["a", "b", "next"])).toBe(true);
    expect(validateConversationLineage(conv, ["a", "X", "next"])).toBe(false);
    // Shorter with no stored texts: the vacuous prefix match also yields
    // "compact" (fork semantics — server state is authoritative).
    expect(validateConversationLineage(conv, ["only-one"])).toBe("compact");
  });
});

describe("commitConversationTurn / resyncConversationLineageAfterCompact", () => {
  it("commit snapshots texts, count, and fingerprint", () => {
    const conv = createAgentConversationRecord();
    commitConversationTurn(conv, ["a", "b"]);
    expect(conv.turnCount).toBe(2);
    expect(conv.userTexts).toEqual(["a", "b"]);
    expect(conv.fingerprint).toBe(computeLineageFingerprint(["a", "b"]));
  });

  it("resync after compact re-baselines on the compacted history", () => {
    const conv = committed(["q1", "q2", "q3", "q4"]);
    resyncConversationLineageAfterCompact(conv, ["q3", "q4"]);
    expect(conv.turnCount).toBe(2);
    expect(validateConversationLineage(conv, ["q3", "q4", "q5"])).toBe(true);
    expect(validateConversationLineage(conv, ["q1", "q2", "q5"])).toBe(false);
  });
});

describe("pruneAgentBlobs", () => {
  it("is a no-op at or below the cap", () => {
    const store = new Map([["a", Buffer.from("1")], ["b", Buffer.from("2")]]);
    pruneAgentBlobs(store, 2);
    expect(store.size).toBe(2);
  });

  it("evicts oldest-inserted entries first (FIFO)", () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) store.set(`k${i}`, Buffer.from(String(i)));
    pruneAgentBlobs(store, 3);
    expect([...store.keys()]).toEqual(["k2", "k3", "k4"]);
  });

  it("defaults to the env-configurable cap", () => {
    const store = new Map();
    for (let i = 0; i < CURSOR_AGENT_CONVERSATION_DEFAULTS.maxBlobsPerOwner + 5; i++) {
      store.set(`k${i}`, Buffer.from(String(i)));
    }
    pruneAgentBlobs(store);
    expect(store.size).toBe(CURSOR_AGENT_CONVERSATION_DEFAULTS.maxBlobsPerOwner);
  });
});

describe("storeCursorBlob", () => {
  it("is content-addressed via sha256 and returns the raw id", () => {
    const store = new Map();
    const id = storeCursorBlob(Buffer.from("payload"), store);
    expect(id).toHaveLength(32);
    expect(store.get(Buffer.from(id).toString("hex")).toString()).toBe("payload");
  });

  it("identical content maps to one entry", () => {
    const store = new Map();
    storeCursorBlob(Buffer.from("same"), store);
    storeCursorBlob(Buffer.from("same"), store);
    expect(store.size).toBe(1);
  });
});

describe("encodeConversationState / getStateTurnBlobIds round-trip", () => {
  it("round-trips turn ids and preserves field structure", () => {
    const idA = Buffer.alloc(32, 0xaa);
    const idB = Buffer.alloc(32, 0xbb);
    const archive = Buffer.alloc(32, 0xcc);
    const state = decodeMessage(encodeConversationState({
      turns: [idA, idB],
      summaryArchives: [archive],
    }));
    expect(getStateTurnBlobIds(state).map((b) => b.equals(idA) || b.equals(idB) ? b : b)).toHaveLength(2);
    expect(getStateTurnBlobIds(state)[0].equals(idA)).toBe(true);
    expect(getStateSummaryArchiveIds(state)[0].equals(archive)).toBe(true);
  });
});

describe("encodeConversationSummaryArchive", () => {
  it("encodes summary text and window tail", () => {
    const bytes = encodeConversationSummaryArchive({
      summarizedMessages: [Buffer.alloc(32, 1)],
      summary: "older turns",
      windowTail: 4,
    });
    const decoded = decodeMessage(bytes);
    expect(Buffer.from(decoded.get(1)[0].value)).toHaveLength(32);
    expect(Buffer.from(decoded.get(2)[0].value).toString("utf8")).toBe("older turns");
    expect(decoded.get(3)[0].value).toBe(4);
  });
});

describe("archiveCheckpointTurns", () => {
  it("returns the checkpoint unchanged at or below the threshold", () => {
    const store = new Map();
    const checkpoint = buildCheckpoint(store, [{ userText: "q" }]);
    expect(archiveCheckpointTurns(checkpoint, store, { turnThreshold: 20 })).toBe(checkpoint);
  });

  it("archives old turns, keeps the recent window, and appends a summary archive", () => {
    const store = new Map();
    const specs = Array.from({ length: 25 }, (_, i) => ({
      userText: `question ${i + 1}`,
      assistantTexts: [`answer ${i + 1}`],
    }));
    const checkpoint = buildCheckpoint(store, specs);
    const archived = archiveCheckpointTurns(checkpoint, store, { turnThreshold: 20 });

    expect(archived).not.toBe(checkpoint);
    const newState = decodeMessage(archived);
    const turnIds = getStateTurnBlobIds(newState);
    expect(turnIds).toHaveLength(20); // kept window
    // Old turn blobs were replaced by exactly one new summary archive.
    const archives = getStateSummaryArchiveIds(newState);
    expect(archives).toHaveLength(1);
    const summaryBlob = store.get(archives[0].toString("hex"));
    const summary = decodeMessage(summaryBlob);
    expect(Buffer.from(summary.get(2)[0].value).toString("utf8"))
      .toContain("[Earlier conversation — 5 turn(s)]");
    expect(Buffer.from(summary.get(2)[0].value).toString("utf8"))
      .toContain("User: question 1");
    expect(Buffer.from(summary.get(2)[0].value).toString("utf8"))
      .toContain("Assistant: answer 5");
    expect(summary.get(3)[0].value).toBe(5); // windowTail
    // summarizedMessages lists the archived turn ids.
    const summarized = summary.get(1).map((e) => Buffer.from(e.value));
    expect(summarized).toHaveLength(5);
  });

  it("keeps the most recent turns in order", () => {
    const store = new Map();
    const specs = Array.from({ length: 23 }, (_, i) => ({ userText: `q${i + 1}` }));
    const checkpoint = buildCheckpoint(store, specs);
    const newState = decodeMessage(archiveCheckpointTurns(checkpoint, store, { turnThreshold: 20 }));
    const ids = getStateTurnBlobIds(newState);
    // Re-render each kept turn: user texts must be q4..q23.
    const texts = ids.map((id) => {
      const turn = decodeMessage(store.get(id.toString("hex")));
      const agentTurn = decodeMessage(turn.get(1)[0].value);
      const userMsgId = agentTurn.get(1)[0].value;
      const userMsg = decodeMessage(store.get(Buffer.from(userMsgId).toString("hex")));
      return Buffer.from(userMsg.get(1)[0].value).toString("utf8");
    });
    expect(texts[0]).toBe("q4");
    expect(texts.at(-1)).toBe("q23");
  });

  it("is not lossy: a missing old turn blob aborts the archive", () => {
    const store = new Map();
    const specs = Array.from({ length: 25 }, (_, i) => ({ userText: `q${i + 1}` }));
    const checkpoint = buildCheckpoint(store, specs);
    // Delete one of the OLD turn blobs (index 0 → turn 1).
    const oldId = getStateTurnBlobIds(decodeMessage(checkpoint))[0];
    store.delete(oldId.toString("hex"));
    expect(archiveCheckpointTurns(checkpoint, store, { turnThreshold: 20 })).toBe(checkpoint);
  });

  it("force archives below the threshold when asked", () => {
    const store = new Map();
    const checkpoint = buildCheckpoint(store, [
      { userText: "q1" }, { userText: "q2" }, { userText: "q3" },
    ]);
    const archived = archiveCheckpointTurns(checkpoint, store, { turnThreshold: 1, force: true });
    expect(archived).not.toBe(checkpoint);
    expect(getStateTurnBlobIds(decodeMessage(archived))).toHaveLength(1);
  });

  it("preserves unrelated checkpoint fields verbatim", () => {
    const store = new Map();
    const turnId = Buffer.from(buildTurnBlob(store, { userText: "q1" }));
    const original = Buffer.concat([
      Buffer.from(encodeConversationState({ turns: [turnId], clientName: "" })),
      Buffer.from(encodeField(17, VARINT, 777)), // unknown-to-archiver field
    ]);
    const rebuilt = archiveCheckpointTurns(original, store, { turnThreshold: 0, force: true });
    const state = decodeMessage(rebuilt);
    expect(state.get(17)?.[0]?.value).toBe(777);
  });

  it("returns the input unchanged for empty/absent checkpoints", () => {
    const store = new Map();
    expect(archiveCheckpointTurns(null, store)).toBeNull();
    expect(archiveCheckpointTurns(new Uint8Array(0), store)).toEqual(new Uint8Array(0));
  });
});

describe("shouldArchiveByTokenUsage", () => {
  it("triggers at and above the ratio", () => {
    expect(shouldArchiveByTokenUsage({ used: 70, max: 100 }, 0.7)).toBe(true);
    expect(shouldArchiveByTokenUsage({ used: 69, max: 100 }, 0.7)).toBe(false);
  });

  it("never triggers on missing or zero usage", () => {
    expect(shouldArchiveByTokenUsage(null)).toBe(false);
    expect(shouldArchiveByTokenUsage({})).toBe(false);
    expect(shouldArchiveByTokenUsage({ used: 0, max: 100 })).toBe(false);
    expect(shouldArchiveByTokenUsage({ used: 50, max: 0 })).toBe(false);
  });

  it("uses the env-configurable default ratio", () => {
    expect(CURSOR_AGENT_CONVERSATION_DEFAULTS.archiveTokenRatio).toBeGreaterThan(0);
    expect(CURSOR_AGENT_CONVERSATION_DEFAULTS.archiveTokenRatio).toBeLessThan(1);
  });
});

describe("env threshold defaults", () => {
  it("exposes documented defaults", () => {
    expect(CURSOR_AGENT_CONVERSATION_DEFAULTS.turnArchiveThreshold).toBe(20);
    expect(CURSOR_AGENT_CONVERSATION_DEFAULTS.maxBlobsPerOwner).toBe(128);
    expect(CURSOR_AGENT_CONVERSATION_DEFAULTS.conversationTtlMs).toBe(30 * 60 * 1000);
  });
});
