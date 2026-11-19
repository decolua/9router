/**
 * Unit tests for the Qoder model-queue helpers.
 *
 * The payloads below are the real ones Qoder returns (2026-10-19) for a queued
 * model: a `{statusCodeValue, body}` SSE envelope whose body nests the queue
 * object inside two more JSON strings. Everything is matched on content, never
 * on exact byte shape, because the nesting depth varies by endpoint.
 */

import { describe, it, expect } from "vitest";
import {
  QODER_QUEUE_CODE,
  computeQoderQueueDelayMs,
  isQoderQueuedBody,
  parseQoderQueueInfo,
  parseQoderQueueStatus,
  qoderQueueMaxWaitMs,
  qoderQueueStatusUrl,
} from "../../open-sse/shared/qoder/queue.js";

const QUEUE_OBJECT = {
  isQueued: true,
  modelKey: "auto",
  queueCount: 0,
  queueType: "p3",
  retryAfterSeconds: 30,
  serviceAvailable: false,
  subCode: "RESOURCE_LIMIT",
  waitTime: 30,
};

/** Encode the queue object the way upstream does: inside nested JSON strings. */
function nestQueue(depth = 2) {
  let payload = JSON.stringify(QUEUE_OBJECT);
  for (let i = 0; i < depth; i++) {
    payload = JSON.stringify({ code: i === 0 ? QODER_QUEUE_CODE : "403", message: payload, subCode: "RESOURCE_LIMIT" });
  }
  return payload;
}

describe("parseQoderQueueInfo", () => {
  it("parses a doubly-nested queue payload", () => {
    const info = parseQoderQueueInfo(nestQueue(2));
    expect(info).not.toBeNull();
    expect(info.isQueued).toBe(true);
    expect(info.modelKey).toBe("auto");
    expect(info.queueType).toBe("p3");
    expect(info.retryAfterSeconds).toBe(30);
    expect(info.serviceAvailable).toBe(false);
    expect(info.subCode).toBe("RESOURCE_LIMIT");
  });

  it("parses a triply-nested queue payload", () => {
    const info = parseQoderQueueInfo(nestQueue(3));
    expect(info?.isQueued).toBe(true);
    expect(info?.modelKey).toBe("auto");
  });

  it("parses the envelope shape wrapQoderSSE sees", () => {
    const envelope = JSON.stringify({
      headers: { "Content-Type": ["application/json"] },
      body: nestQueue(2),
      statusCodeValue: 403,
      statusCode: "FORBIDDEN",
    });
    expect(parseQoderQueueInfo(envelope)?.isQueued).toBe(true);
  });

  it("accepts an already-parsed object", () => {
    expect(parseQoderQueueInfo({ error: { message: nestQueue(1) } })?.queueType).toBe("p3");
  });

  it("returns null for a billing block (code 112)", () => {
    expect(parseQoderQueueInfo('{"code":"112","message":"Quota exhausted","pricingUrl":"x"}')).toBeNull();
  });

  it("returns null for an ordinary error", () => {
    expect(parseQoderQueueInfo('{"code":"500","message":"Internal error"}')).toBeNull();
  });

  it("returns null for empty and non-JSON input", () => {
    expect(parseQoderQueueInfo("")).toBeNull();
    expect(parseQoderQueueInfo("not json")).toBeNull();
    expect(parseQoderQueueInfo(null)).toBeNull();
    expect(parseQoderQueueInfo(undefined)).toBeNull();
  });

  it("still flags a bare 10605 code without the inner object", () => {
    // The code alone is the signal; upstream has been seen to omit the detail.
    expect(parseQoderQueueInfo('{"code":"10605"}')?.code).toBe("10605");
  });
});

describe("isQoderQueuedBody", () => {
  it("is true for a queued payload", () => {
    expect(isQoderQueuedBody(nestQueue(2))).toBe(true);
  });

  it("is false for a billing block", () => {
    expect(isQoderQueuedBody('{"code":"112","message":"Quota exhausted"}')).toBe(false);
  });

  it("is false for a normal completion chunk", () => {
    const chunk = JSON.stringify({ choices: [{ delta: { content: "hi" } }], statusCodeValue: 200 });
    expect(isQoderQueuedBody(chunk)).toBe(false);
  });
});

describe("computeQoderQueueDelayMs", () => {
  it("honours retryAfterSeconds from the inference refusal", () => {
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 30 })).toBe(30_000);
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 20 })).toBe(20_000);
  });

  it("falls back to waitTime when retryAfterSeconds is absent", () => {
    expect(computeQoderQueueDelayMs({ waitTime: 25 })).toBe(25_000);
  });

  it("never replays faster than 15s, even on a tiny hint", () => {
    // Qoder answers retryAfterSeconds:2 while still refusing; replaying that
    // fast makes the throttle worse.
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 0 })).toBe(15_000);
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 2 })).toBe(15_000);
  });

  it("clamps the upper bound to 60s", () => {
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 600 })).toBe(60_000);
  });

  it("uses a 30s default when no hint is present", () => {
    expect(computeQoderQueueDelayMs(null)).toBe(30_000);
    expect(computeQoderQueueDelayMs({})).toBe(30_000);
  });

  it("raises a status-derived hint to 30s", () => {
    // The queue-status endpoint has reported isQueued:false with
    // retryAfterSeconds:2 while the inference call was still refused, so its
    // hint is not trusted below one full interval.
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 2 }, { fromStatus: true })).toBe(30_000);
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 45 }, { fromStatus: true })).toBe(45_000);
  });
});

describe("qoderQueueStatusUrl", () => {
  it("carries both required parameters", () => {
    const url = qoderQueueStatusUrl("https://api2.qoder.sh", { requestSetId: "abc-123", modelKey: "auto" });
    expect(url).toBe(
      "https://api2.qoder.sh/algo/api/v2/service/ask/queue/status?requestSetId=abc-123&modelKey=auto",
    );
  });

  it("adds queueType when known", () => {
    const url = qoderQueueStatusUrl("https://api2.qoder.sh", {
      requestSetId: "abc",
      modelKey: "auto",
      queueType: "p3",
    });
    expect(url).toContain("queueType=p3");
  });

  it("omits parameters it was not given", () => {
    expect(qoderQueueStatusUrl("https://api2.qoder.sh", {})).toBe(
      "https://api2.qoder.sh/algo/api/v2/service/ask/queue/status?",
    );
  });
});

describe("parseQoderQueueStatus", () => {
  it("parses the ready shape", () => {
    const info = parseQoderQueueStatus(
      '{"isQueued":false,"modelKey":"auto","queueType":"p3","queueCount":0,"waitTime":0,"retryAfterSeconds":2,"serviceAvailable":true}',
    );
    expect(info).toEqual({
      isQueued: false,
      serviceAvailable: true,
      modelKey: "auto",
      queueType: "p3",
      queueCount: 0,
      retryAfterSeconds: 2,
      waitTime: 0,
    });
  });

  it("parses the still-queued shape", () => {
    const info = parseQoderQueueStatus(
      '{"subCode":"RESOURCE_LIMIT","isQueued":true,"modelKey":"auto","queueType":"p3","queueCount":0,"waitTime":30,"retryAfterSeconds":30,"serviceAvailable":false}',
    );
    expect(info?.isQueued).toBe(true);
    expect(info?.waitTime).toBe(30);
  });

  it("returns null when isQueued is missing (unknown endpoint shape)", () => {
    expect(parseQoderQueueStatus('{"status":"ok"}')).toBeNull();
    expect(parseQoderQueueStatus("")).toBeNull();
    expect(parseQoderQueueStatus("not json")).toBeNull();
  });
});

describe("qoderQueueMaxWaitMs", () => {
  it("defaults to 10 minutes", () => {
    const prev = process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
    delete process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
    expect(qoderQueueMaxWaitMs()).toBe(600_000);
    if (prev !== undefined) process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS = prev;
  });

  it("honours the env override", () => {
    const prev = process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
    process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS = "5000";
    expect(qoderQueueMaxWaitMs()).toBe(5000);
    if (prev === undefined) delete process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
    else process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS = prev;
  });

  it("ignores a nonsensical override", () => {
    const prev = process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
    process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS = "not-a-number";
    expect(qoderQueueMaxWaitMs()).toBe(600_000);
    if (prev === undefined) delete process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
    else process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS = prev;
  });
});
