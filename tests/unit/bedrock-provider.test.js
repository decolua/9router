import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { signRequest } from "../../open-sse/utils/awsSigv4.js";
import { drainFrames } from "../../open-sse/utils/awsEventStream.js";
import { eventToSSE, BedrockExecutor } from "../../open-sse/executors/bedrock.js";
import { getExecutor } from "../../open-sse/executors/index.js";

// AWS's published SigV4 test suite, case `get-vanilla`.
const VECTOR = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
  date: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
  expected:
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
    "SignedHeaders=host;x-amz-date, " +
    "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
};

/** Build one AWS EventStream frame around a JSON payload. */
function frame(headers, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const parts = [];
  for (const [name, value] of Object.entries(headers)) {
    const n = Buffer.from(name, "utf8");
    const v = Buffer.from(value, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(v.length, 0);
    parts.push(Buffer.concat([Buffer.from([n.length]), n, Buffer.from([7]), len, v]));
  }
  const headerBytes = Buffer.concat(parts);
  const total = 16 + headerBytes.length + payload.length;
  const prelude = Buffer.alloc(8);
  prelude.writeUInt32BE(total, 0);
  prelude.writeUInt32BE(headerBytes.length, 4);
  // crc32 of the prelude, then of everything before the trailing checksum.
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const preludeCrc = Buffer.alloc(4);
  preludeCrc.writeUInt32BE(crc(prelude), 0);
  const head = Buffer.concat([prelude, preludeCrc, headerBytes, payload]);
  const messageCrc = Buffer.alloc(4);
  messageCrc.writeUInt32BE(crc(head), 0);
  return new Uint8Array(Buffer.concat([head, messageCrc]));
}

function chunkFrame(claudeEvent) {
  return frame(
    { ":event-type": "chunk", ":message-type": "event", ":content-type": "application/json" },
    { bytes: Buffer.from(JSON.stringify(claudeEvent), "utf8").toString("base64") },
  );
}

describe("AWS SigV4 signer", () => {
  it("matches the AWS get-vanilla test vector", () => {
    const headers = signRequest({
      url: "https://example.amazonaws.com/",
      method: "GET",
      headers: {},
      body: "",
      region: VECTOR.region,
      service: VECTOR.service,
      accessKeyId: VECTOR.accessKeyId,
      secretAccessKey: VECTOR.secretAccessKey,
      date: VECTOR.date,
    });
    expect(headers.Authorization).toBe(VECTOR.expected);
    expect(headers["X-Amz-Date"]).toBe("20150830T123600Z");
  });

  it("signs ':' in the path unescaped — Bedrock model ids end in ':0'", () => {
    // Encoding the colon would sign a path different from the one fetch sends (403).
    const url =
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/" +
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0/invoke-with-response-stream";
    const withColon = signRequest({
      url, body: "{}", region: "us-east-1",
      accessKeyId: VECTOR.accessKeyId, secretAccessKey: VECTOR.secretAccessKey, date: VECTOR.date,
    });
    const encoded = signRequest({
      url: url.replace(":0", "%3A0"), body: "{}", region: "us-east-1",
      accessKeyId: VECTOR.accessKeyId, secretAccessKey: VECTOR.secretAccessKey, date: VECTOR.date,
    });
    expect(withColon.Authorization).not.toBe(encoded.Authorization);
  });

  it("includes the session token in the signed headers when present", () => {
    const headers = signRequest({
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/m/invoke",
      body: "{}", region: "us-east-1", accessKeyId: VECTOR.accessKeyId,
      secretAccessKey: VECTOR.secretAccessKey, sessionToken: "tok", date: VECTOR.date,
    });
    expect(headers["X-Amz-Security-Token"]).toBe("tok");
    expect(headers.Authorization).toContain("x-amz-security-token");
  });
});

describe("Bedrock EventStream → Claude SSE", () => {
  it("decodes a chunk frame into a named Claude SSE event", () => {
    const { events, rest } = drainFrames(
      chunkFrame({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }),
    );
    expect(events).toHaveLength(1);
    expect(rest.byteLength).toBe(0);
    const out = eventToSSE(events[0]);
    expect(out.sse).toBe(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
    );
  });

  it("folds amazon-bedrock-invocationMetrics into Claude's usage shape", () => {
    const { events } = drainFrames(
      chunkFrame({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        "amazon-bedrock-invocationMetrics": {
          inputTokenCount: 12, outputTokenCount: 34, cacheReadInputTokenCount: 5,
        },
      }),
    );
    const payload = JSON.parse(eventToSSE(events[0]).sse.split("data: ")[1]);
    expect(payload.usage).toEqual({
      input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 5,
    });
    expect(payload["amazon-bedrock-invocationMetrics"]).toBeUndefined();
  });

  it("surfaces exception frames as errors", () => {
    const f = frame(
      { ":message-type": "exception", ":exception-type": "throttlingException" },
      { message: "Too many requests" },
    );
    const { events } = drainFrames(f);
    expect(eventToSSE(events[0]).error).toBe("throttlingException: Too many requests");
  });

  it("holds a partial frame back until the rest of it arrives", () => {
    const full = chunkFrame({ type: "message_stop" });
    const first = drainFrames(full.slice(0, full.length - 5));
    expect(first.events).toHaveLength(0);
    const joined = new Uint8Array([...first.rest, ...full.slice(full.length - 5)]);
    expect(drainFrames(joined).events).toHaveLength(1);
  });
});

describe("Bedrock provider registration", () => {
  const entry = REGISTRY.find((e) => e.id === "bedrock");

  it("is registered as an apikey provider speaking the Claude format", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.hasProviderSpecificData).toBe(true);
    expect(PROVIDERS.bedrock.format).toBe("claude");
  });

  it("lists only inference-profile-prefixed model ids", () => {
    // Bedrock rejects Anthropic base model ids for on-demand throughput.
    for (const m of entry.models) {
      expect(m.id).toMatch(/^(global|us|eu|apac|jp|au)\.anthropic\./);
    }
  });

  it("resolves to the specialized executor", () => {
    expect(getExecutor("bedrock")).toBeInstanceOf(BedrockExecutor);
  });
});

describe("BedrockExecutor request shaping", () => {
  const ex = new BedrockExecutor();
  const creds = {
    apiKey: "secret",
    providerSpecificData: { accessKeyId: "AKIA", region: "eu-west-1" },
  };

  it("puts the model in the path and the region in the host", () => {
    expect(ex.buildUrl("us.anthropic.claude-sonnet-4-5-20250929-v1:0", true, 0, creds)).toBe(
      "https://bedrock-runtime.eu-west-1.amazonaws.com/model/" +
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0/invoke-with-response-stream",
    );
    expect(ex.buildUrl("m", false, 0, creds)).toContain("/invoke");
  });

  it("rejects a model id that would escape the signed path", () => {
    expect(() => ex.buildUrl("../../foo", true, 0, creds)).toThrow(/invalid model id/);
  });

  it("requires both halves of the credential pair", () => {
    expect(() => ex.buildUrl("m", true, 0, { apiKey: "secret" })).toThrow(/access key ID/);
    expect(() => ex.buildUrl("m", true, 0, {
      providerSpecificData: { accessKeyId: "AKIA" },
    })).toThrow(/access key ID/);
  });

  it("adds anthropic_version and drops fields Bedrock rejects in the body", () => {
    const out = ex.transformRequest("m", {
      model: "m", stream: true, anthropic_beta: ["x"], max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect(out).toEqual({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
    });
  });
});
