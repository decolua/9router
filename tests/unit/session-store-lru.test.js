// The session stores exist to keep one id stable per connection/conversation so
// upstream prompt caches keep hitting. Their size caps evict `keys().next()`,
// which is only the least-recently-used entry if Map order tracks use —
// resolveContinuationId re-inserts on read for exactly that reason.
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionStore,
  deriveSessionId,
  resolveContinuationId,
  resolveSessionId,
} from "../../open-sse/utils/sessionManager.js";

const MAX_SESSIONS = 1000;
const MAX_ASSISTANT_SESSIONS = 5000;

beforeEach(() => {
  clearSessionStore();
});

describe("deriveSessionId eviction", () => {
  it("keeps the connection that is still being used when the cap is reached", () => {
    const hot = "conn-hot";
    const hotId = deriveSessionId(hot);
    for (let i = 1; i < MAX_SESSIONS; i++) deriveSessionId(`conn-${i}`);

    // Still in use — inserted first, but the most recently touched.
    expect(deriveSessionId(hot)).toBe(hotId);

    // One more connection pushes the store over the cap.
    deriveSessionId("conn-new");

    expect(deriveSessionId(hot)).toBe(hotId);
  });

  it("evicts the least-recently-used connection, not the first inserted", () => {
    const first = deriveSessionId("conn-0");
    for (let i = 1; i < MAX_SESSIONS; i++) deriveSessionId(`conn-${i}`);
    deriveSessionId("conn-0"); // touch: conn-1 is now the LRU
    deriveSessionId("conn-new");

    expect(deriveSessionId("conn-0")).toBe(first);
  });

  it("keeps an untouched connection stable while under the cap", () => {
    const id = deriveSessionId("conn-quiet");
    for (let i = 0; i < 10; i++) deriveSessionId(`conn-${i}`);
    expect(deriveSessionId("conn-quiet")).toBe(id);
  });
});

describe("assistant-anchored session eviction", () => {
  const bodyFor = (n) => ({
    messages: [{ role: "assistant", content: `conversation ${n} `.padEnd(80, "x") }],
  });
  const idFor = (n) => resolveSessionId({ body: bodyFor(n), connectionId: "c", scope: "codex" });

  it("keeps the conversation that is still being used when the cap is reached", () => {
    const hotId = idFor(0);
    for (let i = 1; i < MAX_ASSISTANT_SESSIONS; i++) idFor(i);

    expect(idFor(0)).toBe(hotId);
    idFor(MAX_ASSISTANT_SESSIONS); // pushes over the cap
    expect(idFor(0)).toBe(hotId);
  });
});

describe("resolveContinuationId eviction (already LRU — guards the reference behaviour)", () => {
  it("keeps the continuation that is still being used", () => {
    const opts = (n) => ({ sessionId: `s-${n}`, connectionId: "c", scope: "kiro" });
    const hot = resolveContinuationId(opts(0));
    for (let i = 1; i < 5000; i++) resolveContinuationId(opts(i));

    expect(resolveContinuationId(opts(0))).toBe(hot);
    resolveContinuationId(opts(5000));
    expect(resolveContinuationId(opts(0))).toBe(hot);
  });
});
