import { EventEmitter } from "node:events";
import http2 from "node:http2";
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

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
  });

  afterEach(() => {
    clearCursorModelCache();
    vi.restoreAllMocks();
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
    const client = new EventEmitter();
    client.close = vi.fn();
    let capturedHeaders = null;
    client.request = vi.fn((headers) => {
      capturedHeaders = headers;
      const req = new EventEmitter();
      req.end = vi.fn(() => {
        process.nextTick(() => {
          req.emit("response", { ":status": 200 });
          req.emit("data", Buffer.from(payload));
          req.emit("end");
        });
      });
      return req;
    });
    vi.spyOn(http2, "connect").mockReturnValue(client);

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

    expect(http2.connect).toHaveBeenCalledTimes(1);
    expect(http2.connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh");
    expect(capturedHeaders).toEqual(
      expect.objectContaining({
        ":method": "POST",
        ":path": "/agent.v1.AgentService/GetUsableModels",
        "content-type": "application/proto",
        accept: "application/proto",
      }),
    );
  });

  it("fails open when the Cursor catalog request fails", async () => {
    const client = new EventEmitter();
    client.close = vi.fn();
    client.request = vi.fn(() => {
      const req = new EventEmitter();
      req.end = vi.fn(() => {
        process.nextTick(() => {
          req.emit("response", { ":status": 403 });
          req.emit("data", Buffer.from("no"));
          req.emit("end");
        });
      });
      return req;
    });
    vi.spyOn(http2, "connect").mockReturnValue(client);

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
