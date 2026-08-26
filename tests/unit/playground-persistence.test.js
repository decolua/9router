import { describe, expect, it } from "vitest";
import {
  PLAYGROUND_PERSISTENCE_KEYS,
  PLAYGROUND_PERSISTENCE_LIMITS,
  createPlaygroundPersistence,
} from "../../src/app/(dashboard)/dashboard/playground/lib/persistence.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.setCalls = [];
    this.failWrites = 0;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.setCalls.push(key);
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      const error = new Error("Storage quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function createSession(index, messageCount = 1) {
  return {
    id: `session-${index}`,
    updatedAt: `2026-08-26T00:${String(index).padStart(2, "0")}:00.000Z`,
    messages: Array.from({ length: messageCount }, (_, messageIndex) => ({
      id: `${index}-${messageIndex}`,
      role: "user",
      content: `message ${messageIndex}`,
    })),
  };
}

function createState(overrides = {}) {
  return {
    sessions: [createSession(1)],
    presets: [{ id: "preset-1", config: { temperature: 0.2, stop: ["END"] } }],
    config: { temperature: 0.2, stop: ["END"] },
    selection: { activeSessionId: "session-1", modelId: "test/model" },
    draft: "Keep this draft",
    ...overrides,
  };
}

describe("playground persistence", () => {
  it("reloads separate versioned namespaces with their bounded, sanitized values", () => {
    // Given: state contains values that must be bounded and secrets that must never persist.
    const storage = new MemoryStorage();
    const persistence = createPlaygroundPersistence(storage);
    const state = createState({
      sessions: Array.from({ length: 22 }, (_, index) => createSession(index, 102)).map((session) => ({
        ...session,
        messages: [{
          ...session.messages[0],
          attachments: [
            { id: "image", dataUrl: "data:image/png;base64,payload", size: 1024 },
            { id: "too-large", size: PLAYGROUND_PERSISTENCE_LIMITS.imageBytes + 1 },
            ...Array.from({ length: 4 }, (_, imageIndex) => ({ id: `image-${imageIndex}`, size: 1024 })),
          ],
          providerSpecificData: { apiKey: "sk-secret-value" },
          authorization: "Bearer sk-secret-value",
        }, ...session.messages.slice(1, -1), {
          ...session.messages.at(-1),
          attachments: [
            { id: "image", dataUrl: "data:image/png;base64,payload", size: 1024 },
            { id: "too-large", size: PLAYGROUND_PERSISTENCE_LIMITS.imageBytes + 1 },
            ...Array.from({ length: 4 }, (_, imageIndex) => ({ id: `image-${imageIndex}`, size: 1024 })),
          ],
          providerSpecificData: { apiKey: "sk-secret-value" },
          authorization: "Bearer sk-secret-value",
        }],
      })),
      presets: Array.from({ length: 22 }, (_, index) => ({
        id: `preset-${index}`,
        config: { stop: ["a", "b", "c", "d", "e"], cookie: "session-secret" },
      })),
    });

    // When: the state is saved and loaded by a simulated fresh page instance.
    const saved = persistence.save(state);
    const restored = createPlaygroundPersistence(storage).load();
    const serialized = [...storage.values.values()].join("\n");

    // Then: each namespace restores independently with exact retention and no request-lifetime secrets.
    expect(saved).toEqual({ persisted: true, memoryOnly: false, warning: null, evictedSessionIds: [] });
    expect(restored.sessions).toHaveLength(PLAYGROUND_PERSISTENCE_LIMITS.sessions);
    expect(restored.sessions.every((session) => session.messages.length === PLAYGROUND_PERSISTENCE_LIMITS.messagesPerSession)).toBe(true);
    expect(restored.sessions[0].messages.at(-1).attachments).toHaveLength(PLAYGROUND_PERSISTENCE_LIMITS.images);
    expect(restored.sessions[0].messages.at(-1).attachments.every((attachment) => attachment.size <= PLAYGROUND_PERSISTENCE_LIMITS.imageBytes)).toBe(true);
    expect(restored.presets).toHaveLength(PLAYGROUND_PERSISTENCE_LIMITS.presets);
    expect(restored.config.stop).toEqual(["END"]);
    expect(restored.presets[0].config.stop).toEqual(["a", "b", "c", "d"]);
    expect(restored.draft).toBe("Keep this draft");
    expect(Object.values(PLAYGROUND_PERSISTENCE_KEYS).every((key) => storage.getItem(key))).toBe(true);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(PLAYGROUND_PERSISTENCE_LIMITS.serializedBytes);
    expect(serialized).not.toContain("dataUrl");
    expect(serialized).not.toContain("sk-secret-value");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("providerSpecificData");
  });

  it("resets only malformed and unknown-version namespaces", () => {
    // Given: healthy draft and selection namespaces alongside corrupt sessions and an unknown presets version.
    const storage = new MemoryStorage();
    storage.values.set(PLAYGROUND_PERSISTENCE_KEYS.sessions, "{bad json");
    storage.values.set(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig, JSON.stringify({ version: 99, value: { presets: [] } }));
    storage.values.set(PLAYGROUND_PERSISTENCE_KEYS.draft, JSON.stringify({ version: 1, value: "active draft" }));
    storage.values.set(PLAYGROUND_PERSISTENCE_KEYS.selection, JSON.stringify({ version: 1, value: { modelId: "test/model" } }));

    // When: storage is hydrated.
    const restored = createPlaygroundPersistence(storage).load();

    // Then: invalid namespaces alone reset while valid active values survive.
    expect(restored.sessions).toEqual([]);
    expect(restored.presets).toEqual([]);
    expect(restored.config).toEqual({});
    expect(restored.draft).toBe("active draft");
    expect(restored.selection).toEqual({ modelId: "test/model" });
    expect(storage.getItem(PLAYGROUND_PERSISTENCE_KEYS.sessions)).toBeNull();
    expect(storage.getItem(PLAYGROUND_PERSISTENCE_KEYS.presetsConfig)).toBeNull();
    expect(storage.getItem(PLAYGROUND_PERSISTENCE_KEYS.draft)).not.toBeNull();
    expect(storage.getItem(PLAYGROUND_PERSISTENCE_KEYS.selection)).not.toBeNull();
  });

  it("evicts oldest sessions once on quota overflow and then enters memory-only mode without mutating active values", () => {
    // Given: a storage implementation that rejects the initial save and its single eviction retry.
    const storage = new MemoryStorage();
    storage.failWrites = 2;
    const activeState = createState({
      sessions: [createSession(3), createSession(1), createSession(2)],
      draft: "active draft survives",
      config: { temperature: 0.3, stop: ["END"] },
    });

    // When: persistence attempts the save.
    const result = createPlaygroundPersistence(storage).save(activeState);

    // Then: oldest sessions are evicted deterministically once, a safe warning is returned, and caller state is untouched.
    expect(result.persisted).toBe(false);
    expect(result.memoryOnly).toBe(true);
    expect(result.warning).toBe("Local storage is full; changes remain in this browser session only.");
    expect(result.evictedSessionIds).toEqual(["session-1"]);
    expect(activeState.draft).toBe("active draft survives");
    expect(activeState.config).toEqual({ temperature: 0.3, stop: ["END"] });
    expect(activeState.sessions).toHaveLength(3);
    expect(storage.setCalls.filter((key) => key === PLAYGROUND_PERSISTENCE_KEYS.sessions)).toHaveLength(2);
  });
});
