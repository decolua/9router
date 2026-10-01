import { describe, it, expect } from "vitest";
import {
  resolveWsModelId,
  buildGetChatMessageRequest,
  grpcWebFrame,
  decodeCompletionChunk,
  default as WindsurfExecutor,
} from "open-sse/executors/windsurf.js";
import { PROVIDERS } from "open-sse/config/providers.js";

// ─── Protobuf helpers for building expected wire bytes in tests ──────────────

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}
function encodeLenField(fieldNum, payload) {
  const tag = encodeVarint((fieldNum << 3) | 2);
  const len = encodeVarint(payload.length);
  const out = new Uint8Array(tag.length + len.length + payload.length);
  out.set(tag, 0); out.set(len, tag.length); out.set(payload, tag.length + len.length);
  return out;
}
function encodeStringField(fieldNum, str) {
  return encodeLenField(fieldNum, new TextEncoder().encode(str));
}

describe("windsurf MODEL_ALIAS_MAP", () => {
  it("maps SWE models to snake-case wire names", () => {
    expect(resolveWsModelId("swe-1.6-fast")).toBe("swe-1-6-fast");
    expect(resolveWsModelId("swe-1.5")).toBe("swe-1-5");
  });
  it("maps Claude 4.5 to MODEL_PRIVATE_* aliases", () => {
    expect(resolveWsModelId("claude-sonnet-4.5")).toBe("MODEL_PRIVATE_2");
    expect(resolveWsModelId("claude-opus-4.5")).toBe("MODEL_CLAUDE_4_5_OPUS");
  });
  it("applies default effort level for bare gpt-5.x ids", () => {
    expect(resolveWsModelId("gpt-5.5")).toBe("gpt-5-5-medium");
    expect(resolveWsModelId("gpt-5.4")).toBe("gpt-5-4-medium");
  });
  it("passes through unknown ids as-is", () => {
    expect(resolveWsModelId("custom-model")).toBe("custom-model");
  });
});

describe("grpcWebFrame", () => {
  it("prepends a 5-byte header: 0x00 flag + big-endian length", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = grpcWebFrame(payload);
    expect(frame[0]).toBe(0x00);
    const view = new DataView(frame.buffer);
    expect(view.getUint32(1, false)).toBe(5); // big-endian length
    expect(Array.from(frame.slice(5))).toEqual([1, 2, 3, 4, 5]);
  });
  it("encodes empty payload as a 5-byte frame", () => {
    const frame = grpcWebFrame(new Uint8Array(0));
    expect(frame.length).toBe(5);
    expect(frame[0]).toBe(0x00);
  });
});

describe("buildGetChatMessageRequest", () => {
  it("emits metadata (field 1), cascade_id (2), model (3), messages (4+)", () => {
    const payload = buildGetChatMessageRequest("sk-ws-test", "swe-1.6", [
      { role: "user", content: "hello" },
    ]);
    expect(payload.length).toBeGreaterThan(10);
    // First byte 0x0a = field 1, wire type 2 (length-delimited) → metadata present
    expect(payload[0]).toBe(0x0a);
  });

  it("embeds the apiKey inside the metadata sub-message", () => {
    const payload = buildGetChatMessageRequest("sk-ws-secret", "gpt-5", []);
    // The metadata bytes are the first length-delimited field — should contain the key.
    const asString = new TextDecoder().decode(payload);
    expect(asString).toContain("sk-ws-secret");
    // And the IDE identification fields.
    expect(asString).toContain("windsurf");
    expect(asString).toContain("3.14.0");
  });

  it("appends one field-4 message per chat message", () => {
    // Proper top-level protobuf field counter (byte 0x22 collides with content bytes).
    const countField = (buf, target) => {
      let offset = 0;
      let count = 0;
      while (offset < buf.length) {
        let result = 0, shift = 0;
        while (offset < buf.length) {
          const b = buf[offset++];
          result |= (b & 0x7f) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
        }
        const fieldNum = result >>> 3;
        const wireType = result & 0x07;
        if (wireType === 2) {
          let len = 0, ls = 0;
          while (offset < buf.length) {
            const b = buf[offset++];
            len |= (b & 0x7f) << ls;
            if ((b & 0x80) === 0) break;
            ls += 7;
          }
          if (fieldNum === target) count++;
          offset += len;
        } else if (wireType === 0) {
          while (offset < buf.length) {
            const b = buf[offset++];
            if ((b & 0x80) === 0) break;
          }
        } else if (wireType === 1) {
          offset += 8;
        } else if (wireType === 5) {
          offset += 4;
        } else {
          break;
        }
      }
      return count;
    };
    const one = buildGetChatMessageRequest("k", "m", [{ role: "user", content: "a" }]);
    const two = buildGetChatMessageRequest("k", "m", [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(countField(one, 4)).toBe(1);
    expect(countField(two, 4)).toBe(2);
  });
});

describe("decodeCompletionChunk", () => {
  it("decodes a ContentChunk (field 1 → text)", () => {
    const chunk = encodeLenField(1, encodeStringField(1, "hello world"));
    const decoded = decodeCompletionChunk(chunk);
    expect(decoded).toEqual({ kind: "content", text: "hello world" });
  });

  it("decodes an ErrorChunk (field 4 → message)", () => {
    const chunk = encodeLenField(4, encodeStringField(1, "quota exhausted"));
    const decoded = decodeCompletionChunk(chunk);
    expect(decoded).toEqual({ kind: "error", message: "quota exhausted" });
  });

  it("decodes a DoneChunk (field 3 → UsageStats with prompt/completion tokens)", () => {
    // UsageStats: field 1 = prompt_tokens (varint), field 2 = completion_tokens (varint)
    const usage = new Uint8Array([...encodeVarint((1 << 3) | 0), ...encodeVarint(42), ...encodeVarint((2 << 3) | 0), ...encodeVarint(99)]);
    const doneChunk = encodeLenField(3, encodeLenField(1, usage));
    const decoded = decodeCompletionChunk(doneChunk);
    expect(decoded.kind).toBe("done");
    expect(decoded.promptTokens).toBe(42);
    expect(decoded.completionTokens).toBe(99);
  });

  it("returns { kind: 'unknown' } for empty buffer", () => {
    expect(decodeCompletionChunk(new Uint8Array(0))).toEqual({ kind: "unknown" });
  });
});

describe("WindsurfExecutor class", () => {
  it("constructor wires config from PROVIDERS.windsurf", () => {
    const ex = new WindsurfExecutor();
    expect(ex.provider).toBe("windsurf");
    expect(ex.config).toBeDefined();
    expect(ex.config.baseUrl).toContain("server.self-serve.windsurf.com");
    expect(typeof ex.execute).toBe("function");
  });

  it("buildHeaders emits grpc-web+proto + Bearer token", () => {
    const ex = new WindsurfExecutor();
    const h = ex.buildHeaders({ accessToken: "sk-ws-abc" });
    expect(h["Content-Type"]).toBe("application/grpc-web+proto");
    expect(h.Accept).toBe("application/grpc-web+proto");
    expect(h["X-Grpc-Web"]).toBe("1");
    expect(h.Authorization).toBe("Bearer sk-ws-abc");
    expect(h["User-Agent"]).toMatch(/^windsurf\//);
  });

  it("buildHeaders omits Authorization when no token", () => {
    const ex = new WindsurfExecutor();
    const h = ex.buildHeaders({});
    expect(h.Authorization).toBeUndefined();
  });

  it("buildUrl returns the GetChatMessage endpoint", () => {
    const ex = new WindsurfExecutor();
    expect(ex.buildUrl()).toBe("https://server.self-serve.windsurf.com/exa.language_server_pb.LanguageServerService/GetChatMessage");
  });

  it("PROVIDERS.windsurf baseUrl is the chat endpoint (registry in sync)", () => {
    expect(PROVIDERS.windsurf.baseUrl).toBe(
      "https://server.self-serve.windsurf.com/exa.language_server_pb.LanguageServerService/GetChatMessage"
    );
  });
});
