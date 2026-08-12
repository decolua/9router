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

  it("fetches the account-specific catalog via http2 and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));

    const mockReq = {
      on: vi.fn((event, cb) => {
        if (event === "response") cb({ ":status": "200" });
        if (event === "data") cb(payload);
        if (event === "end") cb();
        return mockReq;
      }),
      end: vi.fn(),
    };

    const mockClient = {
      request: vi.fn().mockReturnValue(mockReq),
      on: vi.fn(),
      close: vi.fn(),
    };

    vi.doMock("http2", () => ({
      default: {
        connect: vi.fn().mockReturnValue(mockClient),
      },
      connect: vi.fn().mockReturnValue(mockClient),
    }));

    vi.resetModules();
    const { resolveCursorModels: freshResolve } = await import("../../open-sse/services/cursorModels.js");

    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    const result = await freshResolve(credentials);
    expect(result).toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    const result2 = await freshResolve(credentials);
    expect(result2).toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(mockClient.request).toHaveBeenCalledTimes(1);
  }, 15000);

  it("fails open when the Cursor catalog request fails", async () => {
    const mockReq = {
      on: vi.fn((event, cb) => {
        if (event === "error") cb(new Error("connection refused"));
        return mockReq;
      }),
      end: vi.fn(),
    };

    const mockClient = {
      request: vi.fn().mockReturnValue(mockReq),
      on: vi.fn(),
      close: vi.fn(),
    };

    vi.doMock("http2", () => ({
      default: {
        connect: vi.fn().mockReturnValue(mockClient),
      },
      connect: vi.fn().mockReturnValue(mockClient),
    }));

    vi.resetModules();
    const { resolveCursorModels: freshResolve } = await import("../../open-sse/services/cursorModels.js");

    await expect(freshResolve({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
