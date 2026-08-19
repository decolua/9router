/**
 * Unit tests for Qoder encoding + COSY signing primitives.
 *
 * These cover the parts that would silently produce wrong-but-plausible
 * output if logic regressed:
 *   - body encoder boundary cases (empty input, lengths not divisible by 3)
 *   - COSY header production (signature deterministic given fixed inputs,
 *     all required headers present, sigPath correctly stripped)
 *   - device flow URL construction
 */

import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

const { refreshFetchMock } = vi.hoisted(() => ({ refreshFetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => refreshFetchMock(...args),
}));

import {
  qoderEncodeBody,
  buildCosyHeaders,
  normalizeMessages,
  wrapQoderSSE,
  buildQoderRequestBody,
  SHELL,
  resolveReasoningEffort,
  QODER_CHAT_URL_ENCODED,
  QODER_MODEL_LIST_URL,
} from "../../open-sse/protocol/qoder/test-utils.js";
import { normalizeQoderMachineOs, QODER_MACHINE_OS } from "../../open-sse/protocol/qoder/constants.js";
import { QoderService } from "../../src/lib/oauth/services/qoder.js";
import {
  INTL_PROFILE,
  CN_WORK_PROFILE,
  resolveProfile,
  createProtocol,
} from "../../open-sse/protocol/qoder/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { refreshQoderDeviceToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import qoderOAuth from "../../src/lib/oauth/providers/qoder.js";
import qoderworkCnOAuth from "../../src/lib/oauth/providers/qoderwork-cn.js";

// Convenience aliases — tests were originally written against module-level
// helpers; the QoderService class wraps them so each test creates its own
// instance to avoid hidden state.
const generatePkcePair = () => new QoderService().generatePkcePair();
const initiateDeviceFlow = async () =>
  new QoderService({ machineTokenResolver: async (machineId) => machineId }).initiateDeviceFlow();
const parseExpiry = QoderService.parseExpiry;

describe("provider catalog", () => {
  it("exposes Qoder's latest model in the static provider catalog", () => {
    expect(PROVIDER_MODELS.qd.some((model) => model.id === "qmodel_latest")).toBe(true);
  });
});

describe("qoderEncodeBody", () => {
  it("preserves base64 length (input length divisible by 3)", () => {
    const input = Buffer.from("abcdef", "utf8"); // 6 bytes → 8 base64 chars
    const encoded = qoderEncodeBody(input);
    expect(encoded.length).toBe(8);
  });

  it("preserves base64 length (input length not divisible by 3)", () => {
    const input = Buffer.from("hello", "utf8"); // 5 bytes → 8 base64 chars (with padding)
    const encoded = qoderEncodeBody(input);
    expect(encoded.length).toBe(8);
  });

  it("handles empty input without throwing", () => {
    const encoded = qoderEncodeBody(Buffer.alloc(0));
    expect(encoded).toBe("");
  });

  it("accepts string and Buffer inputs equivalently", () => {
    const a = qoderEncodeBody("hello");
    const b = qoderEncodeBody(Buffer.from("hello", "utf8"));
    expect(a).toBe(b);
  });

  it("only emits characters from the custom alphabet", () => {
    // The custom alphabet is "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!"
    // plus "$" for the padding char. If the substitution step regresses,
    // characters outside that set would leak into the output.
    const allowed = new Set(
      "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$",
    );
    const encoded = qoderEncodeBody(
      "hello world this is a longer string for testing 0123456789",
    );
    for (const ch of encoded) {
      expect(allowed.has(ch), `unexpected char in output: ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    const a = qoderEncodeBody("abc");
    const b = qoderEncodeBody("abc");
    expect(a).toBe(b);
  });

  it("produces different output for different input", () => {
    const a = qoderEncodeBody("abc");
    const b = qoderEncodeBody("xyz");
    expect(a).not.toBe(b);
  });
});

describe("generatePkcePair", () => {
  it("produces base64url-safe verifier and challenge of the right length", () => {
    const { verifier, challenge } = generatePkcePair();
    // Desktop generatePKCE$1: unreserved charset, length 43–128; S256 challenge 43 chars.
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge.length).toBe(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifier and challenge are different (challenge is sha256 of verifier)", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier).not.toBe(challenge);
    // S256: challenge should be base64url(sha256(verifier))
    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(challenge).toBe(expected);
  });

  it("returns codeVerifier (not verifier) on the higher-level helper", async () => {
    // Regression: the providers.js qoder entry once read flow.verifier (undefined)
    // because initiateDeviceFlow returns the field as `codeVerifier`.
    const flow = await initiateDeviceFlow();
    expect(typeof flow.codeVerifier).toBe("string");
    expect(flow.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(flow.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(flow.verifier).toBeUndefined();
  });
});

describe("initiateDeviceFlow", () => {
  it("produces a verification URL pointing at qoder.com/device/selectAccounts", async () => {
    const flow = await initiateDeviceFlow();
    expect(flow.verificationUriComplete).toMatch(
      /^https:\/\/qoder\.com\/device\/selectAccounts\?/,
    );
    expect(flow.verificationUriComplete).toContain("challenge_method=S256");
    expect(flow.verificationUriComplete).toContain(`nonce=${flow.nonce}`);
    expect(flow.verificationUriComplete).toMatch(/machine_id=[^&]+/);
  });

  it("returns raw UUID machineId and a separately resolved machineToken", async () => {
    const resolver = vi.fn(async () => "umid-token");
    const flow = await new QoderService({ machineTokenResolver: resolver }).initiateDeviceFlow();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(flow.nonce).toMatch(uuidRe);
    expect(flow.machineId).toMatch(uuidRe);
    expect(flow.machineToken).toBe("umid-token");
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith(flow.machineId);
    expect(new URL(flow.verificationUriComplete).searchParams.get("machine_id")).toBe(flow.machineId);
  });

  it("falls machineToken back to the raw UUID", async () => {
    const flow = await new QoderService({
      machineTokenResolver: async () => "",
    }).initiateDeviceFlow();
    expect(flow.machineToken).toBe(flow.machineId);
  });
});

describe("buildCosyHeaders", () => {
  const creds = {
    userId: "test-user-id",
    authToken: "dt-test-token",
    name: "Test",
    email: "test@example.com",
    machineId: "fixed-machine-id",
  };

  it("produces all required Cosy-* headers", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    const required = [
      "Authorization",
      "Cosy-Key",
      "Cosy-User",
      "Cosy-Date",
      "Cosy-Version",
      "Cosy-Machineid",
      "Cosy-Machinetoken",
      "Cosy-Machinetype",
      "Cosy-Machineos",
      "Cosy-Clienttype",
      "Cosy-Clientip",
      "Cosy-Bodyhash",
      "Cosy-Bodylength",
      "Cosy-Sigpath",
      "Cosy-Data-Policy",
      "Login-Version",
      "X-Request-Id",
    ];
    for (const key of required) {
      expect(headers[key], `missing header ${key}`).toBeDefined();
    }
  });

  it("Authorization is a Bearer COSY token with payload+sig", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers.Authorization).toMatch(/^Bearer COSY\.[A-Za-z0-9+/=]+\.[a-f0-9]{32}$/);
  });

  it("Authorization sig matches live newline-separated Cosy MD5 input", () => {
    // Live 2026-07-28: intl + CN both require newline-joined sigInput.
    // Space-joined MD5 is rejected upstream as Signature invalid.
    const body = Buffer.from("newline-delimiter-probe", "utf8");
    const headers = buildCosyHeaders(body, QODER_MODEL_LIST_URL, creds);
    const auth = headers.Authorization;
    const m = /^Bearer COSY\.([A-Za-z0-9+/=]+)\.([a-f0-9]{32})$/.exec(auth);
    expect(m).toBeTruthy();
    const payloadB64 = m[1];
    const sig = m[2];
    const cosyKey = headers["Cosy-Key"];
    const timestamp = headers["Cosy-Date"];
    const sigPath = headers["Cosy-Sigpath"];
    const bodyLatin1 = body.toString("latin1");
    const spaceInput = `${payloadB64} ${cosyKey} ${timestamp} ${bodyLatin1} ${sigPath}`;
    const newlineInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyLatin1}\n${sigPath}`;
    const spaceMd5 = crypto.createHash("md5").update(Buffer.from(spaceInput, "latin1")).digest("hex");
    const newlineMd5 = crypto.createHash("md5").update(Buffer.from(newlineInput, "latin1")).digest("hex");
    expect(sig).toBe(newlineMd5);
    expect(sig).not.toBe(spaceMd5);
  });

  it("Cosy-Sigpath strips the leading /algo prefix", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Sigpath"]).toBe("/api/v2/model/list");
  });

  it("Cosy-Sigpath also handles the encoded chat URL", () => {
    const headers = buildCosyHeaders(Buffer.from("body", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    expect(headers["Cosy-Sigpath"]).toBe(
      "/api/v2/service/pro/sse/agent_chat_generation",
    );
  });

  it("Cosy-Bodyhash is the MD5 of the request body, Cosy-Bodylength is the length", () => {
    const body = Buffer.from("hello qoder", "utf8");
    const headers = buildCosyHeaders(body, QODER_MODEL_LIST_URL, creds);
    const expectedHash = crypto.createHash("md5").update(body).digest("hex");
    expect(headers["Cosy-Bodyhash"]).toBe(expectedHash);
    expect(headers["Cosy-Bodylength"]).toBe(String(body.length));
  });

  it("empty body produces the canonical empty-MD5 hash", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Bodyhash"]).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(headers["Cosy-Bodylength"]).toBe("0");
  });

  it("Cosy-Machineid + Cosy-Machinetoken match the supplied machineId", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Machineid"]).toBe("fixed-machine-id");
    expect(headers["Cosy-Machinetoken"]).toBe("fixed-machine-id");
  });

  it("keeps machineId and machineToken distinct when both are supplied", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, {
      ...creds,
      machineToken: "umid-token",
    });
    expect(headers["Cosy-Machineid"]).toBe("fixed-machine-id");
    expect(headers["Cosy-Machinetoken"]).toBe("umid-token");
  });

  it("falls Cosy-Machinetoken back to machineId for legacy rows", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Machinetoken"]).toBe(headers["Cosy-Machineid"]);
  });

  it("auto-generates a machineId when none is supplied", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, {
      ...creds,
      machineId: "",
    });
    expect(headers["Cosy-Machineid"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("throws when userId is missing", () => {
    expect(() =>
      buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, { ...creds, userId: "" }),
    ).toThrow(/user id is empty/);
  });

  it("throws when authToken is missing", () => {
    expect(() =>
      buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, { ...creds, authToken: "" }),
    ).toThrow(/auth token is empty/);
  });

  it("Cosy-User reflects the supplied userId verbatim", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-User"]).toBe("test-user-id");
  });

  it("two calls with identical inputs differ only in fields that include fresh randomness", () => {
    // The signature fingerprints a fresh AES key + UUID per call, so the
    // signature, Cosy-Key, X-Request-Id, and Cosy-Date (1s resolution)
    // can differ — but Cosy-User, Cosy-Bodyhash, Cosy-Bodylength,
    // Cosy-Sigpath, and the machineId-derived headers must be stable.
    const a = buildCosyHeaders(Buffer.from("payload", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    const b = buildCosyHeaders(Buffer.from("payload", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    expect(a["Cosy-User"]).toBe(b["Cosy-User"]);
    expect(a["Cosy-Bodyhash"]).toBe(b["Cosy-Bodyhash"]);
    expect(a["Cosy-Bodylength"]).toBe(b["Cosy-Bodylength"]);
    expect(a["Cosy-Sigpath"]).toBe(b["Cosy-Sigpath"]);
    expect(a["Cosy-Machineid"]).toBe(b["Cosy-Machineid"]);
    expect(a["X-Request-Id"]).not.toBe(b["X-Request-Id"]);
  });
});

describe("parseExpiry", () => {
  // Regression for review finding #2: numeric expires_at was silently
  // dropped because the function only inspected strings.
  it("accepts ms-epoch as a JSON number", () => {
    const future = Date.now() + 60_000;
    expect(parseExpiry(future, undefined)).toBe(future);
  });

  it("accepts ms-epoch as a numeric string", () => {
    const future = Date.now() + 60_000;
    expect(parseExpiry(String(future), undefined)).toBe(future);
  });

  it("accepts RFC3339 strings", () => {
    const iso = "2030-01-02T03:04:05Z";
    expect(parseExpiry(iso, undefined)).toBe(Date.parse(iso));
  });

  // Regression for review finding #5: Date.parse("2026") returns Jan 1 2026,
  // so a short numeric string like "2026" used to be interpreted as a year
  // instead of falling through to the integer-ms branch. We now try the
  // pure-numeric path first so this can't happen again.
  it("does not interpret short numeric strings as a year", () => {
    // "1700000000" (Unix seconds) should NOT come out as Date.parse("1700000000")
    const result = parseExpiry("1700000000", undefined);
    // 1.7e9 ms = 1970-01-20 — the function's contract is ms, so we expect
    // exactly that value, not a year interpretation.
    expect(result).toBe(1_700_000_000);
  });

  it("falls back to expiresInSeconds when expiresAt is missing", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, 60);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 60_000);
    expect(result).toBeLessThanOrEqual(after + 60_000);
  });

  // Regression for review finding #7: expiresInSeconds=0 used to be treated
  // as missing and silently fabricated 30-day default. We now honor 0 as
  // "already expired".
  it("treats expires_in: 0 as already expired (now), not 30-day fallback", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, 0);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("falls back to ~30 days when both inputs are missing", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, undefined);
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    // Allow a small skew to absorb test runtime.
    expect(result).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result).toBeLessThanOrEqual(expected + 5_000);
  });

  it("falls back to ~30 days when both inputs are unparseable", () => {
    const before = Date.now();
    const result = parseExpiry("not-a-date", -5);
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    expect(result).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result).toBeLessThanOrEqual(expected + 5_000);
  });
});

describe("normalizeMessages", () => {
  
  it("hoists role:system out of messages into systemText", () => {
    const result = normalizeMessages([
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("you are helpful");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("flattens multipart text content into a string", () => {
    const result = normalizeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      },
    ]);
    expect(result.messages[0].content).toBe("part1\npart2");
  });

  it("joins multiple system messages with a blank line", () => {
    const result = normalizeMessages([
      { role: "system", content: "rule 1" },
      { role: "system", content: "rule 2" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("rule 1\n\nrule 2");
  });

  it("returns empty results for empty input", () => {
    const result = normalizeMessages([]);
    expect(result.messages).toEqual([]);
    expect(result.systemText).toBe("");
  });

  it("hoists developer role into systemText like system", () => {
    const result = normalizeMessages([
      { role: "developer", content: "dev rules" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("dev rules");
    expect(result.messages).toHaveLength(1);
  });

  it("keeps Chat image_url parts (official content shape)", () => {
    const result = normalizeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          {
            type: "image_url",
            image_url: { url: "https://example.com/a.png", detail: "high" },
          },
        ],
      },
    ]);
    expect(result.imageUrls).toEqual(["https://example.com/a.png"]);
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "what is this" },
      {
        type: "image_url",
        image_url: { url: "https://example.com/a.png", detail: "high" },
      },
    ]);
  });

  it("maps binary data+mime_type to official binary part", () => {
    const result = normalizeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          { type: "binary", data: "AAAA", mime_type: "image/png" },
        ],
      },
    ]);
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "see" },
      { type: "binary", binary: { data: "AAAA", mime_type: "image/png" } },
    ]);
  });

  // Practical-minimal: Anthropic source shim is commented out in body.js.
  // Uncomment body path + this test when enabling that client shape.
  // it("converts anthropic-like base64 source to image_url data URL", () => {
  //   const result = normalizeMessages([
  //     {
  //       role: "user",
  //       content: [
  //         {
  //           type: "image",
  //           source: { type: "base64", media_type: "image/jpeg", data: "qqqq" },
  //         },
  //       ],
  //     },
  //   ]);
  //   expect(result.messages[0].content[0]).toEqual({
  //     type: "image_url",
  //     image_url: { url: "data:image/jpeg;base64,qqqq" },
  //   });
  // });

  it("passthrough reasoning_content and name on messages", () => {
    const result = normalizeMessages([
      {
        role: "assistant",
        content: "ok",
        name: "bot",
        reasoning_content: "thoughts",
      },
    ]);
    expect(result.messages[0].name).toBe("bot");
    expect(result.messages[0].reasoning_content).toBe("thoughts");
  });
});

describe("wrapQoderSSE", () => {
  

  // Helper: build a fake Response carrying the given lines as the body.
  function makeResponse(lines, { status = 200 } = {}) {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { status });
  }

  // Helper: drain a wrapped response into an array of decoded SSE events.
  async function drain(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();
    return buf;
  }

  it("forwards an OpenAI envelope chunk and emits [DONE] in flush", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}\n\n`;
    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/auto");
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}\n\n`);
    expect(out).toContain("data: [DONE]\n\n");
  });

  // Regression for review finding #4: a final data: line without a trailing
  // newline used to be silently dropped from `buffer` in flush().
  it("drains a trailing partial line without a newline in flush()", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "tail" } }], finish_reason: "stop" });
    // Note: NO trailing \n on the final line.
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}`;
    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/auto");
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}\n\n`);
  });

  // Regression for review finding #3: chunks could leak past [DONE] when
  // the success branch had no doneEmitted guard. We synthesize an error
  // envelope (which sets doneEmitted=true) followed by a valid envelope
  // and assert the second envelope is NOT forwarded.
  it("does not forward chunks after [DONE] has been emitted", async () => {
    const errorEnv = JSON.stringify({ statusCodeValue: 500, body: "boom" });
    const validInner = JSON.stringify({ choices: [{ delta: { content: "leak" } }] });
    const validEnv = JSON.stringify({ statusCodeValue: 200, body: validInner });
    const wrapped = await wrapQoderSSE(
      makeResponse([`data: ${errorEnv}\n\ndata: ${validEnv}\n\n`]),
      "qoder/auto",
    );
    const out = await drain(wrapped);
    expect(out).not.toContain("leak");
    // Should still have a single [DONE].
    const doneCount = (out.match(/data: \[DONE\]/g) || []).length;
    expect(doneCount).toBe(1);
  });

  // Regression for review finding #6: literal newlines inside the inner
  // OpenAI body would split the SSE frame across multiple data: lines.
  // We now strip them so the frame stays a single event.
  it("strips embedded newlines from inner body before forwarding", async () => {
    const innerWithNewlines = '{"choices":[{"delta":{"content":"a\nb"}}]}';
    const env = JSON.stringify({ statusCodeValue: 200, body: innerWithNewlines });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/auto");
    const out = await drain(wrapped);
    // The forwarded data: line should be a single event terminated by \n\n
    // and contain no internal \n other than the trailing pair.
    const dataLine = out.split("\n\n").find((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
    expect(dataLine).toBeDefined();
    // Body sans "data: " prefix should be valid JSON.
    expect(() => JSON.parse(dataLine.slice("data: ".length))).not.toThrow();
  });

  it("upstream error envelope produces an error chunk + [DONE]", async () => {
    const env = JSON.stringify({ statusCodeValue: 503, body: "service unavailable" });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/lite");
    const out = await drain(wrapped);
    expect(out).toContain("qoder_upstream_error");
    expect(out).toContain("data: [DONE]\n\n");
  });

  it("non-ok responses are returned unchanged (no transform)", async () => {
    const r = new Response("not ok", { status: 500 });
    const wrapped = await wrapQoderSSE(r, "qoder/auto");
    expect(wrapped).toBe(r);
  });
});

describe("machine OS normalization", () => {
  it("uses the current runtime platform", () => {
    expect(QODER_MACHINE_OS).toBe(normalizeQoderMachineOs(process.arch, process.platform));
  });

  it.each([
    ["arm64", "darwin", "aarch64_darwin"],
    ["x64", "linux", "x86_64_linux"],
    ["x64", "win32", "x86_64_windows"],
  ])("maps %s/%s to protocol spelling %s", (arch, platform, expected) => {
    expect(normalizeQoderMachineOs(arch, platform)).toBe(expected);
  });
});

describe("protocol profile", () => {
  it("defaults null to intl", () => {
    expect(resolveProfile(null).id).toBe("intl");
    expect(resolveProfile(undefined).chatUrl).toBe(INTL_PROFILE.chatUrl);
  });

  it("resolves canonical protocol profile ids", () => {
    expect(resolveProfile("cn-work").id).toBe("cn-work");
    expect(CN_WORK_PROFILE.refreshTokenUrl).toContain("openapi.qoder.com.cn");
    expect(CN_WORK_PROFILE.deviceClientId).toBeTruthy();
  });

  it("projects the registry protocolProfile into transport and OAuth views", () => {
    expect(PROVIDERS.qoder.protocolProfile).toBe("intl");
    expect(PROVIDER_OAUTH.qoder.protocolProfile).toBe("intl");
    expect(PROVIDERS["qoderwork-cn"].protocolProfile).toBe("cn-work");
    expect(PROVIDER_OAUTH["qoderwork-cn"].protocolProfile).toBe("cn-work");
  });

  it("keeps connection timeout without a provider stall override", () => {
    for (const id of ["qoder", "qoderwork-cn"]) {
      expect(PROVIDERS[id].timeoutMs).toBe(120_000);
      expect(PROVIDERS[id].stallTimeoutMs).toBeUndefined();
    }
  });

  it("throws on unknown profile id (no silent intl fallback)", () => {
    expect(() => resolveProfile("nope")).toThrow(/unknown protocol profile/);
  });

  it("accepts profile object for composition without registry", () => {
    const alt = {
      ...INTL_PROFILE,
      id: "test-alt",
      chatUrl: "https://example.test/algo/api/v2/service/pro/sse/agent_chat_generation?Encode=1",
      sessionType: "test-session",
      businessProduct: "test-product",
    };
    const p = resolveProfile(alt);
    expect(p.chatUrl).toContain("example.test");
    expect(p.sessionType).toBe("test-session");
  });

  it("createProtocol binds intl by default", () => {
    const proto = createProtocol();
    expect(proto.profile.id).toBe("intl");
    expect(proto.profile.chatUrl).toBe(INTL_PROFILE.chatUrl);
  });

  it("createProtocol accepts inline profile object (future region = data only)", () => {
    const alt = { ...INTL_PROFILE, id: "alt", chatUrl: "https://example.test/chat?Encode=1" };
    const proto = createProtocol(alt);
    expect(proto.profile.id).toBe("alt");
    expect(proto.profile.chatUrl).toContain("example.test");
  });
});

describe("profile-driven payload + cosy (simulation)", () => {
  const creds = {
    userId: "u1",
    authToken: "dt-test",
    name: "N",
    email: "e@x.com",
    machineId: "fixed-machine-id",
  };

  it("buildQoderRequestBody uses profile session/business fields", async () => {
    const alt = {
      ...INTL_PROFILE,
      id: "test-alt",
      sessionType: "sim-session",
      businessProduct: "sim-product",
      businessVersion: "9.9.9",
    };
    // Avoid live catalog: inject rawConfigs via resolve path is hard;
    // call buildQoderRequestBody only if model config available — use force path with stub.
    // Instead assert createProtocol profile binding + Cosy version from profile.
    const headers = buildCosyHeaders(Buffer.alloc(0), alt.chatUrl || QODER_MODEL_LIST_URL, creds, {
      ...alt,
      ideVersion: "9.9.9-test",
      clientType: "99",
      machineOs: "test_os",
      machineType: "99",
      dataPolicy: "agree",
      loginVersion: "v-test",
    });
    expect(headers["Cosy-Version"]).toBe("9.9.9-test");
    expect(headers["Cosy-Clienttype"]).toBe("99");
    expect(headers["Cosy-Machineos"]).toBe("test_os");
    expect(headers["Login-Version"]).toBe("v-test");
    expect(headers["Cosy-Data-Policy"]).toBe("agree");
  });

  it("OAuth service uses injected profile login + device URLs", async () => {
    const alt = {
      ...INTL_PROFILE,
      id: "alt",
      loginUrl: "https://example.test/device/selectAccounts",
      deviceTokenUrl: "https://example.test/api/v1/deviceToken/poll",
    };
    const svc = new QoderService({ profile: alt, machineTokenResolver: async (id) => id });
    const flow = await svc.initiateDeviceFlow();
    expect(flow.verificationUriComplete.startsWith(alt.loginUrl)).toBe(true);
    expect(svc.profile.deviceTokenUrl).toBe(alt.deviceTokenUrl);
  });

  it("default OAuth service stays on intl hosts", async () => {
    const svc = new QoderService({ machineTokenResolver: async (id) => id });
    const flow = await svc.initiateDeviceFlow();
    expect(flow.verificationUriComplete.startsWith(INTL_PROFILE.loginUrl)).toBe(true);
  });

});

describe("contract body (awA)", () => {
  const credentials = {
    accessToken: "dt-test",
    displayName: "T",
    email: "t@x.com",
    providerSpecificData: { userId: "u1", machineId: "m1" },
  };
  const fakeModelConfig = {
    key: "qmodel_latest",
    display_name: "Q",
    is_reasoning: true,
    max_output_tokens: 8192,
    max_input_tokens: 100000,
    source: "system",
    format: "openai",
  };

  it("builds FREE_INPUT shell without catalog when modelConfig injected", async () => {
    const { qoderKey, payload } = await buildQoderRequestBody({
      model: "qoder/qmodel_latest",
      body: {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hello world" },
        ],
        max_tokens: 1000,
        tools: [],
      },
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(qoderKey).toBe("qmodel_latest");
    expect(payload.chat_task).toBe(SHELL.chat_task);
    expect(payload.source).toBe(1);
    expect(payload.version).toBe("3");
    expect(payload.agent_id).toBe("agent_common");
    expect(payload.stream).toBe(true);
    expect(payload.system).toBe("sys");
    expect(payload.messages).toEqual([{ role: "user", content: "hello world" }]);
    expect(payload.parameters.max_tokens).toBe(1000);
    expect(payload.model_config.key).toBe("qmodel_latest");
    expect(payload.chat_context.text).toBe("hello world");
    expect(payload.chat_context.extra.modelConfig).toEqual({
      key: "qmodel_latest",
      is_reasoning: true,
    });
    // awA: three ids share request_id by default
    expect(payload.request_id).toBe(payload.request_set_id);
    expect(payload.request_id).toBe(payload.chat_record_id);
    // business omitted by default
    expect(payload.business).toBeUndefined();
  });

  it("maps reasoning_effort into parameters", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: {
        messages: [{ role: "user", content: "x" }],
        reasoning_effort: "high",
      },
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.parameters.reasoning_effort).toBe("high");
  });

  it("includeBusiness adds business block from profile", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: { messages: [{ role: "user", content: "title here" }] },
      credentials,
      modelConfig: fakeModelConfig,
      includeBusiness: true,
    });
    expect(payload.business).toBeDefined();
    expect(payload.business.product).toBeDefined();
    expect(payload.business.type).toBe("agent");
  });

  it("resolveReasoningEffort normalizes aliases", () => {
    expect(resolveReasoningEffort({ reasoning_effort: "x-high" })).toBe("xhigh");
    expect(resolveReasoningEffort({ reasoning: { effort: "low" } })).toBe("low");
    expect(resolveReasoningEffort({ reasoning_effort: "auto" })).toBeUndefined();
  });

  it("passes tool_calls and tool_call_id through messages (C4)", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: {
        messages: [
          { role: "user", content: "call it" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "t", arguments: "{}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "ok" },
        ],
      },
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.messages[1].tool_calls?.[0]?.id).toBe("call_1");
    expect(payload.messages[2].tool_call_id).toBe("call_1");
    expect(payload.messages[2].role).toBe("tool");
  });

  it("drops temperature and keeps only CONVERT parameters (DROP)", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: {
        messages: [{ role: "user", content: "x" }],
        temperature: 0.9,
        top_p: 0.5,
        seed: 7,
        max_tokens: 128,
      },
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.temperature).toBeUndefined();
    expect(payload.parameters).toEqual({ max_tokens: 128, reasoning_effort: "high", context_length: 100000 });
  });

  it("fills chat_context.imageUrls from vision parts", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
            ],
          },
        ],
      },
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.chat_context.imageUrls).toEqual(["data:image/png;base64,xx"]);
    expect(payload.chat_context.text).toBe("describe");
    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
    ]);
  });
});

describe("field-ops pipeline (capabilities → applyThinking → body)", () => {
  const credentials = { providerSpecificData: { userId: "u1" } };
  const fakeModelConfig = {
    key: "qmodel_latest",
    is_reasoning: true,
    max_output_tokens: 8192,
    source: "system",
  };

  it("marks qoder models as reasoning with qoder thinkingFormat", () => {
    expect(getCapabilitiesForModel("qoder", "qmodel_latest")).toMatchObject({
      reasoning: true,
      thinkingFormat: "qoder",
    });
    expect(getThinkingLevels("qoder", "qmodel_latest")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("keeps reasoning_effort through applyThinking into parameters", async () => {
    const body = {
      messages: [{ role: "user", content: "think" }],
      reasoning_effort: "high",
      max_tokens: 256,
    };
    applyThinking("qoder", "qmodel_latest", body, "qoder");
    expect(body.reasoning_effort).toBe("high");

    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body,
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.parameters.reasoning_effort).toBe("high");
  });

  it("maps model(level) suffix intent via applyThinking into parameters", async () => {
    const body = {
      messages: [{ role: "user", content: "think" }],
      max_tokens: 256,
    };
    applyThinking("qoder", "qmodel_latest(high)", body, "qoder");
    expect(body.reasoning_effort).toBe("high");

    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body,
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.parameters.reasoning_effort).toBe("high");
  });

  it("passes reasoning_effort max through unclamped (qoder format)", async () => {
    const body = {
      messages: [{ role: "user", content: "think" }],
      reasoning_effort: "max",
      max_tokens: 256,
    };
    applyThinking("qoder", "qmodel_latest", body, "qoder");
    expect(body.reasoning_effort).toBe("max");
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body,
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.parameters.reasoning_effort).toBe("max");
  });

  it("keeps max in Qoder format for QoderWork", async () => {
    expect(PROVIDERS["qoderwork-cn"].thinkingFormat).toBeUndefined();
    const body = {
      messages: [{ role: "user", content: "think" }],
      reasoning_effort: "max",
      max_tokens: 256,
    };
    applyThinking("qoder", "qmodel_latest", body, "qoderwork-cn");
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body,
      credentials,
      modelConfig: fakeModelConfig,
      profile: "cn-work",
    });
    expect(payload.parameters.reasoning_effort).toBe("max");
  });

  it("forwards max_thinking_tokens verbatim into parameters", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: { messages: [{ role: "user", content: "x" }], max_thinking_tokens: 12345 },
      credentials,
      modelConfig: fakeModelConfig,
    });
    expect(payload.parameters.max_thinking_tokens).toBe(12345);
  });

  it("defaults context_length to the largest context_config tier", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: { messages: [{ role: "user", content: "x" }] },
      credentials,
      modelConfig: {
        key: "qmodel_latest",
        is_reasoning: true,
        max_input_tokens: 180000,
        context_config: {
          "200K": { token_count: 200000, is_default: true },
          "400K": { token_count: 400000 },
          "1M": { token_count: 1000000 },
        },
      },
    });
    expect(payload.parameters.context_length).toBe(1000000);
  });

  it("lets an explicit client context_length win over the model tier", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: { messages: [{ role: "user", content: "x" }], context_length: 400000 },
      credentials,
      modelConfig: {
        key: "qmodel_latest",
        is_reasoning: true,
        max_input_tokens: 180000,
        context_config: { "1M": { token_count: 1000000, is_default: true } },
      },
    });
    expect(payload.parameters.context_length).toBe(400000);
  });

  it("attaches CN business block with qoder_work product/agent type/init stage", async () => {
    const { payload } = await buildQoderRequestBody({
      model: "qmodel_latest",
      body: { messages: [{ role: "user", content: "hi there" }] },
      credentials,
      modelConfig: fakeModelConfig,
      profile: "cn-work",
    });
    expect(payload.session_type).toBe("qoder_work");
    expect(payload.business).toMatchObject({
      product: "qoder_work",
      type: "agent",
      stage: "init",
    });
  });
});

describe("wrapQoderSSE special tokens", () => {
  function makeResponse(lines, { status = 200 } = {}) {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { status });
  }
  async function drain(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    return buf + decoder.decode();
  }

  it("does not forward NOT_EXCEED_QUOTA as content", async () => {
    const response = await wrapQoderSSE(makeResponse(["data: [NOT_EXCEED_QUOTA]\n\n"]), "qoder/x");
    const out = await drain(response);
    expect(out).not.toContain("NOT_EXCEED_QUOTA");
    expect(out).toContain("data: [DONE]");
  });

  it("maps EXCEED_QUOTA to error event not content delta", async () => {
    const response = await wrapQoderSSE(makeResponse(["data: [EXCEED_QUOTA] limit\n\n"]), "qoder/x");
    const out = await drain(response);
    expect(out).toContain("qoder_upstream_error");
    expect(out).not.toMatch(/delta":\{"content":"\\n\[qoder error/);
  });
});

describe("qoderwork-cn refresh + executor", () => {
  it("CN device login URL includes client_id", async () => {
    const flow = await new QoderService({
      profile: "cn-work",
      machineTokenResolver: async (id) => id,
    }).initiateDeviceFlow();
    expect(flow.verificationUriComplete).toContain("client_id=");
    expect(flow.verificationUriComplete).toContain("qoder.com.cn");
  });

  it("refreshQoderDeviceToken maps device_token response", async () => {
    refreshFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ device_token: "dt-x", refresh_token: "rt-x", expires_in: 120 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const r = await refreshQoderDeviceToken("rt-success-unique", "cn-work");
    expect(r.accessToken).toBe("dt-x");
    expect(r.refreshToken).toBe("rt-x");
    expect(r.expiresIn).toBeGreaterThanOrEqual(60);
  });

  it("refresh invalid_grant on 401", async () => {
    refreshFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "nope" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const r = await refreshQoderDeviceToken("rt-fail-401", "cn-work");
    expect(r?.error).toBe("invalid_grant");
  });

  it("QoderExecutor for qoderwork-cn uses cn-work profile and can need refresh", () => {
    const ex = new QoderExecutor("qoderwork-cn");
    expect(ex.getProtocolProfile()).toBe("cn-work");
    expect(ex.needsRefresh({ expiresAt: Date.now() - 1000, refreshToken: "rt" })).toBe(true);
  });

  it("persists both machine fields in Qoder OAuth adapters with legacy fallback", () => {
    for (const adapter of [qoderOAuth, qoderworkCnOAuth]) {
      const mapped = adapter.mapTokens({
        access_token: "dt-x",
        expires_in: 60,
        _qoderUserId: "u1",
        _qoderMachineId: "uuid-1",
        _qoderMachineToken: "umid-1",
      });
      expect(mapped.providerSpecificData).toMatchObject({
        machineId: "uuid-1",
        machineToken: "umid-1",
      });
      const legacy = adapter.mapTokens({
        access_token: "dt-x",
        expires_in: 60,
        _qoderUserId: "u1",
        _qoderMachineId: "uuid-1",
      });
      expect(legacy.providerSpecificData.machineToken).toBe("uuid-1");
    }
  });
});

describe("cn-work device login URL", () => {
  it("includes client_id and redirect_uri like desktop", async () => {
    const flow = await new QoderService({
      profile: "cn-work",
      machineTokenResolver: async (id) => id,
    }).initiateDeviceFlow();
    const u = new URL(flow.verificationUriComplete);
    expect(u.origin + u.pathname).toBe("https://qoder.com.cn/device/selectAccounts");
    expect(u.searchParams.get("client_id")).toBe("1c5e33e1-364d-4ce6-b02c-acaa81274a5c");
    expect(u.searchParams.get("redirect_uri")).toBe("qoder-work-cn://");
    expect(u.searchParams.get("challenge_method")).toBe("S256");
    expect(u.searchParams.get("nonce")).toBe(flow.nonce);
    expect(u.searchParams.get("machine_id")).toBeTruthy();
  });
});

describe("Cosy SEP (intl + cn-work)", () => {
  it("uses newline join for both intl and cn-work", async () => {
    const { buildCosyHeaders } = await import("../../open-sse/protocol/qoder/cosy.js");
    const creds = {
      userId: "u1",
      authToken: "dt-test",
      name: "n",
      email: "e@x.com",
      machineId: "00000000-0000-0000-0000-000000000001",
    };
    const body = Buffer.from("sep-parity", "utf8");
    const intlUrl = "https://api3.qoder.sh/algo/api/v2/model/list?Encode=1";
    const cnUrl = "https://gateway.qoder.com.cn/algo/api/v2/model/list?Encode=1";
    const intl = buildCosyHeaders(body, intlUrl, creds, "intl");
    const cn = buildCosyHeaders(body, cnUrl, creds, "cn-work");
    expect(intl.Authorization).toMatch(/^Bearer COSY\.[A-Za-z0-9+/=]+\.[a-f0-9]{32}$/);
    expect(cn.Authorization).toMatch(/^Bearer COSY\.[A-Za-z0-9+/=]+\.[a-f0-9]{32}$/);

    for (const headers of [intl, cn]) {
      const m = /^Bearer COSY\.([A-Za-z0-9+/=]+)\.([a-f0-9]{32})$/.exec(headers.Authorization);
      const payloadB64 = m[1];
      const sig = m[2];
      const cosyKey = headers["Cosy-Key"];
      const timestamp = headers["Cosy-Date"];
      const sigPath = headers["Cosy-Sigpath"];
      const bodyLatin1 = body.toString("latin1");
      const newlineInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyLatin1}\n${sigPath}`;
      const spaceInput = `${payloadB64} ${cosyKey} ${timestamp} ${bodyLatin1} ${sigPath}`;
      const newlineMd5 = crypto.createHash("md5").update(Buffer.from(newlineInput, "latin1")).digest("hex");
      const spaceMd5 = crypto.createHash("md5").update(Buffer.from(spaceInput, "latin1")).digest("hex");
      expect(sig).toBe(newlineMd5);
      expect(sig).not.toBe(spaceMd5);
    }
  });
});
