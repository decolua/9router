/**
 * Correlation context and terminal event owner tests (task 6).
 *
 * These tests intentionally import a module that does not exist yet:
 *   - src/lib/webhooks/events.js
 *
 * The locked minimal API (documented here for GREEN) is:
 *
 *   setWebhookSink(sink|null)            DI seam; sink(event) => void | Promise<void>
 *   runWithWebhookContext(options, fn)   root scope: {requestId, modality} -> returns fn()
 *   getWebhookContext()                  snapshot {requestId, modality, admitted, finalized, isRoot} | null
 *   markWebhookAdmitted()                explicit admission marker (root-scoped)
 *   captureWebhookFinalizer()            returns finalize(outcome) for the calling scope's ownership
 *   finalizeWebhookRequest(outcome)      once-only terminal for the current root
 *   emitWebhookEvent(type, data)         transient emit; request.failed is gated by root+admission+once
 *
 * outcome = { outcome:"failed"|"completed"|"client_cancelled",
 *             statusCode?, errorClass?, partialResponse?,
 *             provider?, model?, connectionId? }
 *
 * Finalize returns { emitted:boolean, reason:string }.
 * Emit returns { ok:boolean, emitted:boolean, errors? }.
 * `emitted` means handed to the sink, not persisted or delivered.
 *
 * RED is expected until events.js lands. No DB, no network, no body/stream buffering.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  captureWebhookFinalizer,
  emitWebhookEvent,
  finalizeWebhookRequest,
  getWebhookContext,
  markWebhookAdmitted,
  runWithWebhookContext,
  setWebhookSink,
} from "@/lib/webhooks/events.js";

const REQUEST_ID = "req_6f1c2a90-3d4e-4b1a-9c77-2a5e8d0b1f34";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const makeSink = () => {
  const events = [];
  const sink = (event) => {
    events.push(event);
  };
  return { events, sink };
};

const ofType = (events, type) => events.filter((event) => event.type === type);

const finalFailure = (overrides = {}) => ({
  outcome: "failed",
  statusCode: 502,
  errorClass: "upstream_http",
  ...overrides,
});

beforeEach(() => {
  setWebhookSink(null);
});

afterEach(() => {
  setWebhookSink(null);
});

describe("webhook events: sink DI", () => {
  it("routes emitted envelopes to the injected sink and never touches a DB", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    const returned = runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      finalizeWebhookRequest(finalFailure());
      return "ok";
    });

    expect(returned).toBe("ok");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("request.failed");
  });

  it("drops emit silently when no sink is configured and does not throw", () => {
    setWebhookSink(null);
    expect(() => runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      return finalizeWebhookRequest(finalFailure());
    })).not.toThrow();
  });

  it("replaces a previous sink with the new one", () => {
    const first = makeSink();
    const second = makeSink();
    setWebhookSink(first.sink);
    setWebhookSink(second.sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      finalizeWebhookRequest(finalFailure());
    });

    expect(first.events).toHaveLength(0);
    expect(second.events).toHaveLength(1);
  });
});

describe("webhook events: root context and isolation", () => {
  it("exposes root context during the run and clears it afterwards", () => {
    setWebhookSink(makeSink().sink);
    expect(getWebhookContext()).toBeNull();

    let inside = null;
    runWithWebhookContext({ requestId: REQUEST_ID, modality: "embeddings" }, () => {
      inside = getWebhookContext();
    });

    expect(inside).not.toBeNull();
    expect(inside.requestId).toBe(REQUEST_ID);
    expect(inside.modality).toBe("embeddings");
    expect(inside.isRoot).toBe(true);
    expect(inside.admitted).toBe(false);
    expect(inside.finalized).toBe(false);
    expect(getWebhookContext()).toBeNull();
  });

  it("flips admitted once the explicit marker runs", () => {
    setWebhookSink(makeSink().sink);
    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      expect(getWebhookContext().admitted).toBe(false);
      markWebhookAdmitted();
      expect(getWebhookContext().admitted).toBe(true);
    });
  });

  it("isolates concurrent roots by requestId via AsyncLocalStorage", async () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    const first = "req_aaaaaaaa-1111-4111-8111-111111111111";
    const second = "req_bbbbbbbb-2222-4222-8222-222222222222";
    const seen = {};

    await Promise.all([
      runWithWebhookContext({ requestId: first, modality: "chat" }, async () => {
        markWebhookAdmitted();
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.first = getWebhookContext().requestId;
        captureWebhookFinalizer()(finalFailure());
      }),
      runWithWebhookContext({ requestId: second, modality: "tts" }, async () => {
        markWebhookAdmitted();
        seen.second = getWebhookContext().requestId;
        captureWebhookFinalizer()(finalFailure());
      }),
    ]);

    expect(seen.first).toBe(first);
    expect(seen.second).toBe(second);
    expect(ofType(events, "request.failed")).toHaveLength(2);
    expect(events.map((event) => event.data.requestId).sort()).toEqual([first, second].sort());
  });

  it("returns the root function result unchanged", async () => {
    setWebhookSink(makeSink().sink);
    const payload = { status: 200, body: "hello" };
    const returned = await runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, async () => payload);
    expect(returned).toBe(payload);
  });
});

describe("webhook events: nested contexts share the root", () => {
  it("nested run reuses the root requestId and is not itself a root", () => {
    setWebhookSink(makeSink().sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      const outer = getWebhookContext();
      runWithWebhookContext({ requestId: "req_ignored-0000-4000-8000-000000000000", modality: "chat" }, () => {
        const nested = getWebhookContext();
        expect(nested.requestId).toBe(outer.requestId);
        expect(nested.isRoot).toBe(false);
      });
      expect(getWebhookContext().requestId).toBe(REQUEST_ID);
    });
  });

  it("ignores a nested finalize so only the root owns the terminal", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      runWithWebhookContext({ requestId: "req_ignored-0000-4000-8000-000000000000", modality: "chat" }, () => {
        const nestedResult = finalizeWebhookRequest(finalFailure());
        expect(nestedResult.emitted).toBe(false);
      });
      return "recovered";
    });

    expect(ofType(events, "request.failed")).toHaveLength(0);
  });

  it("does not hand out root privilege when capture runs inside a nested context", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    let nestedFinalizer = null;
    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      runWithWebhookContext({ requestId: "req_ignored-0000-4000-8000-000000000000", modality: "chat" }, () => {
        nestedFinalizer = captureWebhookFinalizer();
      });
      return "recovered";
    });

    expect(typeof nestedFinalizer).toBe("function");
    expect(nestedFinalizer(finalFailure()).emitted).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("recovered fallback emits no final when the root completes", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      runWithWebhookContext({ requestId: "req_inner-0000-4000-8000-000000000000", modality: "chat" }, () => {
        finalizeWebhookRequest(finalFailure());
      });
      return finalizeWebhookRequest({ outcome: "completed" });
    });

    expect(events).toHaveLength(0);
  });
});

describe("webhook events: admission gating", () => {
  it("emits nothing for a failed root that was never admitted", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      return finalizeWebhookRequest(finalFailure({ statusCode: 400, errorClass: "internal" }));
    });

    expect(events).toHaveLength(0);
  });

  it("excludes a client abort even after admission", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      return finalizeWebhookRequest({ outcome: "client_cancelled" });
    });

    expect(events).toHaveLength(0);
  });

  it("distinguishes an internal timeout from a client abort", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      return finalizeWebhookRequest(finalFailure({ errorClass: "upstream_timeout", statusCode: 504 }));
    });

    expect(events).toHaveLength(1);
    expect(events[0].data.errorClass).toBe("upstream_timeout");
    expect(events[0].data.statusCode).toBe(504);
  });

  it("emits exactly one final for an exhausted root", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      return finalizeWebhookRequest(finalFailure({ errorClass: "all_unavailable", statusCode: 503 }));
    });

    expect(ofType(events, "request.failed")).toHaveLength(1);
  });
});

describe("webhook events: terminal once-only semantics", () => {
  it("treats completed as terminal without emitting", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      return finalizeWebhookRequest({ outcome: "completed" });
    });

    expect(events).toHaveLength(0);
  });

  it("ignores a duplicate final", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      const first = finalizeWebhookRequest(finalFailure());
      const second = finalizeWebhookRequest(finalFailure());
      expect(first.emitted).toBe(true);
      expect(second.emitted).toBe(false);
    });

    expect(ofType(events, "request.failed")).toHaveLength(1);
  });

  it("correlates a terminal callback fired after the root returns, without duplicate", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    let finalize = null;
    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      finalize = captureWebhookFinalizer();
      return "response-already-sent";
    });

    // The root has exited; a later stream observer still owns the final decision.
    expect(getWebhookContext()).toBeNull();
    finalize(finalFailure({ errorClass: "stream_failed", statusCode: 200, partialResponse: true }));
    finalize(finalFailure({ errorClass: "stream_failed", statusCode: 200, partialResponse: true }));

    expect(ofType(events, "request.failed")).toHaveLength(1);
    expect(events[0].data.requestId).toBe(REQUEST_ID);
    expect(events[0].data.errorClass).toBe("stream_failed");
    expect(events[0].data.partialResponse).toBe(true);
  });

  it("makes a captured finalizer a safe no-op outside any context", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);
    const orphan = captureWebhookFinalizer();
    expect(() => orphan(finalFailure())).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

describe("webhook events: transient emits are separate from finals", () => {
  it("emits a transient event without admitting or finalizing", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      const result = emitWebhookEvent("account.unavailable", {
        provider: "claude",
        connectionId: "conn_1",
      });
      expect(result.ok).toBe(true);
      expect(getWebhookContext().finalized).toBe(false);
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("account.unavailable");
    expect(ofType(events, "request.failed")).toHaveLength(0);
  });

  it("emits transient then final as two independent events", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      emitWebhookEvent("token.refresh_failed", { provider: "codex", connectionId: "conn_2" });
      finalizeWebhookRequest(finalFailure({ errorClass: "all_unavailable", statusCode: 503 }));
    });

    expect(ofType(events, "token.refresh_failed")).toHaveLength(1);
    expect(ofType(events, "request.failed")).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  it("supports a background transient emit outside any request context", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    const result = emitWebhookEvent("account.unavailable", {
      provider: "gemini-cli",
      connectionId: "conn_bg",
    });

    expect(result.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].data.connectionId).toBe("conn_bg");
  });

  it("builds a validator-compatible envelope with catalog severity", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      emitWebhookEvent("account.unavailable", { provider: "claude" });
      finalizeWebhookRequest({ outcome: "failed", statusCode: 502, errorClass: "upstream_http" });
    });

    const transient = events[0];
    const final = events[1];
    expect(transient.schema_version).toBe(1);
    expect(transient.severity).toBe("warning");
    expect(final.severity).toBe("error");
    expect(UUID_RE.test(transient.id)).toBe(true);
    expect(Number.isFinite(Date.parse(transient.occurred_at))).toBe(true);
  });
});

describe("webhook events: direct final emits cannot bypass the root", () => {
  it("rejects a direct request.failed emit outside any context", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    const result = emitWebhookEvent("request.failed", { provider: "claude" });

    expect(result.ok).toBe(false);
    expect(result.emitted).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("rejects a direct request.failed emit before admission", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      const result = emitWebhookEvent("request.failed", { provider: "claude" });
      expect(result.ok).toBe(false);
      expect(getWebhookContext().finalized).toBe(false);
    });

    expect(events).toHaveLength(0);
  });

  it("rejects a direct request.failed emit from a nested context", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      runWithWebhookContext({ requestId: "req_ignored-0000-4000-8000-000000000000", modality: "chat" }, () => {
        const result = emitWebhookEvent("request.failed", { provider: "claude" });
        expect(result.ok).toBe(false);
      });
    });

    expect(events).toHaveLength(0);
  });

  it("allows exactly one admitted direct final and then blocks duplicates", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      const first = emitWebhookEvent("request.failed", { errorClass: "upstream_http", statusCode: 502 });
      const second = emitWebhookEvent("request.failed", { errorClass: "upstream_http", statusCode: 502 });
      expect(first.ok).toBe(true);
      expect(first.emitted).toBe(true);
      expect(second.ok).toBe(false);

      const late = finalizeWebhookRequest({ outcome: "failed", errorClass: "internal" });
      expect(late.emitted).toBe(false);
      expect(late.reason).toBe("duplicate");
    });

    expect(ofType(events, "request.failed")).toHaveLength(1);
  });
});

describe("webhook events: metadata allowlist safety", () => {
  it("drops unknown and secret-bearing fields before the sink", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      emitWebhookEvent("account.unavailable", {
        requestId: "req_supplied_override",
        provider: "claude",
        model: "claude-opus-4-7",
        statusCode: 502,
        errorClass: "upstream_http",
        prompt: "do not leak this prompt",
        completion: "do not leak this completion",
        authorization: "Bearer secret-token",
        url: "https://hooks.example.com/secret?token=abc",
        stack: "Error: boom\n  at secret.js:1",
      });
    });

    expect(events).toHaveLength(1);
    const keys = Object.keys(events[0].data);
    expect(keys.sort()).toEqual(["errorClass", "model", "provider", "requestId", "statusCode"].sort());
    expect(events[0].data.requestId).toBe(REQUEST_ID);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain("do not leak");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("hooks.example.com");
  });

  it("rejects an invalid metadata type instead of emitting", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    const result = emitWebhookEvent("account.unavailable", { requestId: REQUEST_ID, statusCode: "502" });

    expect(result.ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("rejects an unknown event type", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    const result = emitWebhookEvent("provider.down", { provider: "claude" });

    expect(result.ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("keeps allowed scalar metadata intact", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      emitWebhookEvent("account.unavailable", {
        requestId: REQUEST_ID,
        modality: "chat",
        provider: "claude",
        model: "claude-opus-4-7",
        connectionId: "conn_1",
        statusCode: 429,
        errorClass: "upstream_http",
        partialResponse: false,
      });
    });

    expect(events[0].data).toEqual({
      requestId: REQUEST_ID,
      modality: "chat",
      provider: "claude",
      model: "claude-opus-4-7",
      connectionId: "conn_1",
      statusCode: 429,
      errorClass: "upstream_http",
      partialResponse: false,
    });
  });

  it("uses the context requestId over a supplied override on the final event", () => {
    const { events, sink } = makeSink();
    setWebhookSink(sink);

    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      finalizeWebhookRequest({
        outcome: "failed",
        errorClass: "internal",
        requestId: "req_supplied_override",
      });
    });

    expect(events).toHaveLength(1);
    expect(events[0].data.requestId).toBe(REQUEST_ID);
  });
});

describe("webhook events: sink failures never affect the request", () => {
  it("isolates a rejected sink promise from the root result", () => {
    setWebhookSink(() => Promise.reject(new Error("sink io down")));

    const response = { status: 200, body: "provider response" };
    const returned = runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      finalizeWebhookRequest(finalFailure());
      return response;
    });

    expect(returned).toBe(response);
  });

  it("isolates a synchronously throwing sink", () => {
    setWebhookSink(() => {
      throw new Error("sink exploded");
    });

    let finalize = null;
    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      finalize = captureWebhookFinalizer();
      return "ok";
    });

    expect(() => finalize(finalFailure())).not.toThrow();
  });

  it("still reports emitted even when the sink later rejects", async () => {
    setWebhookSink(() => Promise.reject(new Error("late io failure")));

    let result = null;
    runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () => {
      markWebhookAdmitted();
      result = finalizeWebhookRequest(finalFailure());
    });

    expect(result.emitted).toBe(true);
    // Let the rejected sink promise settle; a missing internal catch would surface
    // here as an unhandled rejection and fail the suite.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("webhook events: static invariants", () => {
  const sourceUrl = new URL("../../src/lib/webhooks/events.js", import.meta.url);
  const readSource = () => readFileSync(sourceUrl, "utf8");

  it("does not import the engine or any DB module", () => {
    const source = readSource();
    expect(source).not.toMatch(/from\s+["']open-sse/);
    expect(source).not.toMatch(/@\/lib\/db/);
    expect(source).not.toMatch(/localDb/);
    expect(source).not.toMatch(/better-sqlite3/);
  });

  it("does not buffer or replay streams or bodies", () => {
    const source = readSource();
    expect(source).not.toMatch(/\.tee\(/);
    expect(source).not.toMatch(/arrayBuffer\s*\(/);
    expect(source).not.toMatch(/Buffer\.concat/);
  });
});
