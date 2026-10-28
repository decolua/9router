/**
 * RED tests for the operational webhook adapters (plan task 5).
 *
 * Future module: src/lib/webhooks/adapters.js  (does not exist yet, RED expected)
 *
 * Locked API contract — three builders + one response classifier. Not a plugin
 * framework, no new dependency: node:crypto only.
 *
 *   buildDiscordPayload(event, options?) -> { body, headers, query }
 *     body  = JSON string: { content, allowed_mentions: { parse: [] }, embeds: [{ title, description }] }
 *     query = { wait: "true" }
 *   buildSlackPayload(event, options?) -> { body, headers, query }
 *     body  = JSON string: { text }
 *     query = {}
 *   buildGenericPayload(event, options) -> { body, headers, query }
 *     body    = exact canonical JSON envelope { id, type, schema_version, occurred_at, severity, data }
 *               (envelope + data allowlists only; extra fields dropped, never raw upstream error/prompt/credential)
 *     headers = { "content-type", "webhook-id", "webhook-timestamp", "webhook-signature" }
 *               Standard Webhooks: HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`,
 *               key = base64-decoded body of a `whsec_`-prefixed secret, header value `v1,<base64>`.
 *     options = { signingSecret, webhookId = event.id, timestamp = current epoch seconds }
 *   classifyResponse(kind, response, options?) -> { outcome, reason, retryAfterSeconds? }
 *     kind = "discord" | "slack" | "generic"; response = { status, headers, body }
 *     outcome = "delivered" | "retry" | "terminal"; options = { now = Date.now() }
 *
 * All builders bound untrusted strings by code point (surrogate-safe),
 * neutralize Discord/Slack mentions, and never echo secrets, prompts or raw upstream errors.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildDiscordPayload,
  buildGenericPayload,
  buildSlackPayload,
  classifyResponse,
} from "@/lib/webhooks/adapters.js";

const EVENT_ID = "0f0f0f0f-1111-4222-8333-444455556666";
const GENERIC_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const GENERIC_WEBHOOK_ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const GENERIC_TIMESTAMP = 1614265330;

const baseEvent = (dataOverrides = {}, envelopeOverrides = {}) => ({
  id: EVENT_ID,
  type: "request.failed",
  schema_version: 1,
  occurred_at: "2026-10-18T03:00:00.000Z",
  severity: "error",
  data: {
    requestId: "req_dummy_1",
    modality: "chat",
    provider: "cx",
    model: "gpt-5.5",
    connectionId: "conn_dummy",
    statusCode: 502,
    errorClass: "upstream_http",
    partialResponse: false,
    ...dataOverrides,
  },
  ...envelopeOverrides,
});

const parseBody = (result) => JSON.parse(result.body);
const codePoints = (value) => Array.from(value).length;
const hasLoneSurrogate = (value) => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

// Independent verifier: mirrors the Standard Webhooks spec, not the adapter code.
const expectedSignature = (body, { webhookId, timestamp, secret }) => {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(raw, "base64");
  const digest = createHmac("sha256", key)
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
};

const response = (status, body = "", headers = {}) => ({ status, headers, body });

const LEAK_COPY = "SECRET_UPSTREAM_BODY";
const LEAK_PROMPT = "SECRET_PROMPT_TEXT";
const LEAK_TOKEN = "SECRET_BEARER_TOKEN";

const leakedEvent = () => {
  const event = baseEvent(
    { rawUpstreamError: LEAK_COPY, prompt: LEAK_PROMPT, authorization: LEAK_TOKEN },
    { rawUpstreamError: LEAK_COPY, prompt: LEAK_PROMPT },
  );
  return event;
};

const assertNoLeak = (body) => {
  expect(body).not.toContain(LEAK_COPY);
  expect(body).not.toContain(LEAK_PROMPT);
  expect(body).not.toContain(LEAK_TOKEN);
};

describe("discord adapter", () => {
  it("builds content + embeds with wait=true and suppressed mentions", () => {
    const result = buildDiscordPayload(baseEvent());
    const body = parseBody(result);

    expect(result.query).toEqual({ wait: "true" });
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(typeof body.content).toBe("string");
    expect(body.content.length).toBeGreaterThan(0);
    expect(Array.isArray(body.embeds)).toBe(true);
    expect(typeof body.embeds[0].title).toBe("string");
    expect(typeof body.embeds[0].description).toBe("string");
    expect(result.headers["content-type"]).toBe("application/json");
  });

  it("neutralizes mentions built from untrusted event data", () => {
    const event = baseEvent({ provider: "@everyone <!channel> <@123> @here" });
    const { content, embeds } = parseBody(buildDiscordPayload(event));
    const rendered = `${content}\n${embeds[0].title}\n${embeds[0].description}`;

    expect(rendered).not.toContain("@everyone");
    expect(rendered).not.toContain("@here");
    expect(rendered).not.toContain("<@");
    expect(rendered).not.toContain("<!");
  });

  it("truncates oversized unicode by code point without splitting surrogates", () => {
    const event = baseEvent({ requestId: "\u{1F600}".repeat(5000) });
    const { content, embeds } = parseBody(buildDiscordPayload(event));

    expect(codePoints(content)).toBeLessThanOrEqual(2000);
    expect(codePoints(embeds[0].description)).toBeLessThanOrEqual(4096);
    expect(codePoints(embeds[0].title)).toBeLessThanOrEqual(256);
    expect(embeds[0].title.length + embeds[0].description.length).toBeLessThanOrEqual(6000);
    expect(hasLoneSurrogate(content)).toBe(false);
    expect(hasLoneSurrogate(embeds[0].description)).toBe(false);
    expect(Buffer.byteLength(buildDiscordPayload(event).body, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("never echoes raw upstream error, prompt or credential", () => {
    assertNoLeak(buildDiscordPayload(leakedEvent()).body);
  });
});

describe("slack adapter", () => {
  it("builds a minimal valid text-only payload", () => {
    const result = buildSlackPayload(baseEvent());
    const body = parseBody(result);

    expect(Object.keys(body)).toEqual(["text"]);
    expect(typeof body.text).toBe("string");
    expect(body.text.trim().length).toBeGreaterThan(0);
    expect(result.query).toEqual({});
    expect(result.headers["content-type"]).toBe("application/json");
  });

  it("neutralizes mentions built from untrusted event data", () => {
    const event = baseEvent({ model: "<!channel> @everyone <@U123>" });
    const body = parseBody(buildSlackPayload(event));

    expect(body.text).not.toContain("@everyone");
    expect(body.text).not.toContain("@here");
    expect(body.text).not.toContain("<@");
    expect(body.text).not.toContain("<!");
  });

  it("truncates oversized unicode by code point without splitting surrogates", () => {
    const event = baseEvent({ requestId: "\u{1F600}".repeat(5000) });
    const body = parseBody(buildSlackPayload(event));

    expect(codePoints(body.text)).toBeLessThanOrEqual(3000);
    expect(hasLoneSurrogate(body.text)).toBe(false);
    expect(Buffer.byteLength(buildSlackPayload(event).body, "utf8")).toBeLessThanOrEqual(16 * 1024);
  });

  it("never echoes raw upstream error, prompt or credential", () => {
    assertNoLeak(buildSlackPayload(leakedEvent()).body);
  });
});

describe("generic signed-JSON adapter", () => {
  const goldenBody =
    '{"id":"0f0f0f0f-1111-4222-8333-444455556666","type":"request.failed","schema_version":1,"occurred_at":"2026-10-18T03:00:00.000Z","severity":"error","data":{"requestId":"req_dummy_1","modality":"chat","provider":"cx","model":"gpt-5.5","connectionId":"conn_dummy","statusCode":502,"errorClass":"upstream_http","partialResponse":false}}';

  it("serializes the exact canonical envelope", () => {
    const result = buildGenericPayload(baseEvent(), { signingSecret: GENERIC_SECRET });

    expect(result.body).toBe(goldenBody);
    expect(result.query).toEqual({});
  });

  it("emits Standard Webhooks headers matching an independent golden vector", () => {
    const result = buildGenericPayload(baseEvent(), {
      signingSecret: GENERIC_SECRET,
      webhookId: GENERIC_WEBHOOK_ID,
      timestamp: GENERIC_TIMESTAMP,
    });

    expect(result.headers["webhook-id"]).toBe(GENERIC_WEBHOOK_ID);
    expect(result.headers["webhook-timestamp"]).toBe(String(GENERIC_TIMESTAMP));
    expect(result.headers["webhook-signature"]).toBe(
      "v1,QCiKo2cY1ZxqQuK4VH25UTHtas2Z7E0F26KdROyKo/U=",
    );
    expect(result.headers["webhook-signature"]).toBe(
      expectedSignature(result.body, {
        webhookId: GENERIC_WEBHOOK_ID,
        timestamp: GENERIC_TIMESTAMP,
        secret: GENERIC_SECRET,
      }),
    );
  });

  it("keeps webhook-id equal to the event id and uses a fresh timestamp per attempt", () => {
    const first = buildGenericPayload(baseEvent(), {
      signingSecret: GENERIC_SECRET,
      timestamp: GENERIC_TIMESTAMP,
    });
    const second = buildGenericPayload(baseEvent(), {
      signingSecret: GENERIC_SECRET,
      timestamp: GENERIC_TIMESTAMP + 1,
    });

    expect(first.headers["webhook-id"]).toBe(EVENT_ID);
    expect(second.headers["webhook-id"]).toBe(EVENT_ID);
    expect(first.body).toBe(second.body);
    expect(second.headers["webhook-timestamp"]).toBe(String(GENERIC_TIMESTAMP + 1));
    expect(second.headers["webhook-signature"]).not.toBe(first.headers["webhook-signature"]);
  });

  it("defaults webhook-id to the event id and timestamp to integer epoch seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = buildGenericPayload(baseEvent(), { signingSecret: GENERIC_SECRET });
    const after = Math.floor(Date.now() / 1000);

    expect(result.headers["webhook-id"]).toBe(EVENT_ID);
    const timestamp = Number(result.headers["webhook-timestamp"]);
    expect(Number.isInteger(timestamp)).toBe(true);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("detects a tampered body against the signed header", () => {
    const result = buildGenericPayload(baseEvent(), {
      signingSecret: GENERIC_SECRET,
      webhookId: GENERIC_WEBHOOK_ID,
      timestamp: GENERIC_TIMESTAMP,
    });
    const tampered = result.body.replace('"statusCode":502', '"statusCode":503');

    expect(tampered).not.toBe(result.body);
    expect(result.headers["webhook-signature"]).not.toBe(
      expectedSignature(tampered, {
        webhookId: GENERIC_WEBHOOK_ID,
        timestamp: GENERIC_TIMESTAMP,
        secret: GENERIC_SECRET,
      }),
    );
  });

  it("drops extra envelope and data fields so no secret is serialized", () => {
    const result = buildGenericPayload(leakedEvent(), { signingSecret: GENERIC_SECRET });

    assertNoLeak(result.body);
    expect(result.body).not.toContain("rawUpstreamError");
    expect(result.body).not.toContain("authorization");
    expect(result.body).toBe(goldenBody);
  });

  it("rejects a missing or empty signing secret", () => {
    expect(() => buildGenericPayload(baseEvent(), {})).toThrow(TypeError);
    expect(() => buildGenericPayload(baseEvent(), { signingSecret: "" })).toThrow(TypeError);
  });

  it("signs explicit non-prefixed secrets as raw UTF-8 and rejects malformed whsec_", () => {
    const secret = "dummy-raw-secret";
    const result = buildGenericPayload(baseEvent(), {
      signingSecret: secret,
      webhookId: GENERIC_WEBHOOK_ID,
      timestamp: GENERIC_TIMESTAMP,
    });
    const expected = `v1,${createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`${GENERIC_WEBHOOK_ID}.${GENERIC_TIMESTAMP}.${result.body}`)
      .digest("base64")}`;

    expect(result.headers["webhook-signature"]).toBe(expected);
    expect(() => buildGenericPayload(baseEvent(), { signingSecret: "whsec_not*base64" })).toThrow(TypeError);
  });
});

describe("response classifier", () => {
  const now = Date.parse("2026-10-18T03:00:00.000Z");

  it("treats any generic 2xx as delivered without echoing the body", () => {
    expect(classifyResponse("generic", response(200, "ok"))).toEqual({ outcome: "delivered", reason: "delivered" });
    expect(classifyResponse("generic", response(204)).outcome).toBe("delivered");
    expect(classifyResponse("generic", response(299, "SECRET_BODY"))).not.toHaveProperty("body");
  });

  it("requires a valid Discord wait acknowledgement", () => {
    expect(classifyResponse("discord", response(200, JSON.stringify({ id: "msg_1" }))).outcome).toBe("delivered");
    expect(classifyResponse("discord", response(200, JSON.stringify({ message: "no id" })))).toEqual({
      outcome: "terminal",
      reason: "invalid_ack",
    });
    expect(classifyResponse("discord", response(200, "<html>"))).toEqual({ outcome: "terminal", reason: "invalid_ack" });
    expect(classifyResponse("discord", response(204)).outcome).toBe("terminal");
  });

  it("requires a Slack 200 ok acknowledgement", () => {
    expect(classifyResponse("slack", response(200, "ok\n")).outcome).toBe("delivered");
    expect(classifyResponse("slack", response(200, "invalid_payload"))).toEqual({
      outcome: "terminal",
      reason: "invalid_ack",
    });
    expect(classifyResponse("slack", response(204)).outcome).toBe("terminal");
  });

  it("uses the transport acknowledged boolean for production acknowledgements", () => {
    expect(classifyResponse("discord", { status: 200, headers: {}, acknowledged: true })).toEqual({
      outcome: "delivered",
      reason: "delivered",
    });
    expect(classifyResponse("discord", { status: 200, headers: {}, acknowledged: false })).toEqual({
      outcome: "terminal",
      reason: "invalid_ack",
    });
    expect(classifyResponse("slack", { status: 200, headers: {}, acknowledged: true }).outcome).toBe("delivered");
    expect(classifyResponse("slack", { status: 200, headers: {}, acknowledged: false }).outcome).toBe("terminal");
  });

  it("retries 429 and honors Retry-After delta or date", () => {
    const delta = classifyResponse("generic", response(429, "", { "retry-after": "120" }), { now });
    expect(delta).toEqual({ outcome: "retry", reason: "rate_limited", retryAfterSeconds: 120 });

    const date = classifyResponse(
      "discord",
      response(429, "", { "Retry-After": "Sun, 18 Oct 2026 03:02:00 GMT" }),
      { now },
    );
    expect(date.retryAfterSeconds).toBe(120);

    const invalid = classifyResponse("slack", response(429, "", { "retry-after": "soon" }), { now });
    expect(invalid.outcome).toBe("retry");
    expect(invalid.retryAfterSeconds).toBeUndefined();
  });

  it("retries timeout and server errors but not redirects or other 4xx", () => {
    expect(classifyResponse("generic", response(408))).toEqual({ outcome: "retry", reason: "timeout" });
    expect(classifyResponse("generic", response(503))).toEqual({ outcome: "retry", reason: "server_error" });
    expect(classifyResponse("generic", response(301))).toEqual({ outcome: "terminal", reason: "http_error" });
    expect(classifyResponse("generic", response(404))).toEqual({ outcome: "terminal", reason: "http_error" });
  });

  it("treats a malformed response as deterministic terminal, not an infinite retry", () => {
    expect(classifyResponse("generic", { status: "200", headers: {}, body: "" })).toEqual({
      outcome: "terminal",
      reason: "invalid_response",
    });
    expect(classifyResponse("generic", undefined)).toEqual({ outcome: "terminal", reason: "invalid_response" });
  });

  it("never leaks an upstream error body or credential through classification", () => {
    const result = classifyResponse("generic", response(500, LEAK_COPY, { "retry-after": LEAK_TOKEN }));
    expect(JSON.stringify(result)).not.toContain(LEAK_COPY);
    expect(JSON.stringify(result)).not.toContain(LEAK_TOKEN);
  });
});
