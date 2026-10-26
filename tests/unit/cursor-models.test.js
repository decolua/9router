import { EventEmitter } from "node:events";
import http2 from "http2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

/** Emits the response frame from a microtask so listeners attached before `req.end()` receive it. */
function installH2Transport({ status, payload }) {
  const transport = { authority: null, requests: [], ends: [], closes: 0 };
  const client = new EventEmitter();

  client.request = (options) => {
    transport.requests.push(options);
    const req = new EventEmitter();
    req.end = (body) => {
      transport.ends.push(body);
      queueMicrotask(() => {
        req.emit("response", { ":status": String(status) });
        if (payload) req.emit("data", Buffer.from(payload));
        req.emit("end");
      });
    };
    return req;
  };
  client.close = () => {
    transport.closes += 1;
  };

  transport.connectSpy = vi.spyOn(http2, "connect").mockImplementation((authority) => {
    transport.authority = authority;
    return client;
  });
  return transport;
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    const transport = installH2Transport({ status: 200, payload });
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(transport.connectSpy).toHaveBeenCalledTimes(1);
    expect(transport.authority).toBe("https://agent.api5.cursor.sh");
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      ":method": "POST",
      ":path": "/agent.v1.AgentService/GetUsableModels",
      ":authority": "agent.api5.cursor.sh",
      ":scheme": "https",
      accept: "application/proto",
      "content-type": "application/proto",
      authorization: "Bearer cursor-token",
    });
    expect(transport.requests[0]["connect-accept-encoding"]).toBeUndefined();
    expect(transport.requests[0]["connect-protocol-version"]).toBeUndefined();
    expect(transport.ends).toHaveLength(1);
    expect(transport.ends[0]).toBeUndefined();
    expect(transport.closes).toBe(1);
  });

  it("fails open when the Cursor catalog request fails", async () => {
    const transport = installH2Transport({ status: 403, payload: text("no") });

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();

    expect(transport.connectSpy).toHaveBeenCalledTimes(1);
    expect(transport.requests).toHaveLength(1);
    expect(transport.closes).toBe(1);
  });
});
