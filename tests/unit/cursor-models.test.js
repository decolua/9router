import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";
import { resolveOutboundProxyUrl } from "../../open-sse/utils/proxyFetch.js";
import { buildHttpConnectRequest, isSocksProxyUrl } from "../../open-sse/utils/http2Connect.js";

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
    const http2Post = vi.fn().mockResolvedValue({ status: 200, body: payload });
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials, { http2Post })).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials, { http2Post })).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(http2Post).toHaveBeenCalledTimes(1);
    expect(http2Post).toHaveBeenCalledWith(
      "https://agent.api5.cursor.sh/agent.v1.AgentService/GetUsableModels",
      expect.objectContaining({
        "content-type": "application/proto",
        accept: "application/proto",
      }),
      expect.any(Uint8Array),
      undefined,
    );
  });

  it("fails open when the Cursor catalog request fails", async () => {
    const http2Post = vi.fn().mockResolvedValue({ status: 403, body: Buffer.from("no") });

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    }, { http2Post })).resolves.toBeNull();
  });
});

describe("HTTP/2 proxy tunnel helpers", () => {
  const envKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
  const saved = {};

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("builds an HTTP CONNECT request for mixed-port proxies", () => {
    expect(buildHttpConnectRequest("agent.api5.cursor.sh", 443, "http://127.0.0.1:10808"))
      .toBe("CONNECT agent.api5.cursor.sh:443 HTTP/1.1\r\nHost: agent.api5.cursor.sh:443\r\n\r\n");
  });

  it("detects SOCKS proxy URLs", () => {
    expect(isSocksProxyUrl("socks5://127.0.0.1:10808")).toBe(true);
    expect(isSocksProxyUrl("http://127.0.0.1:10808")).toBe(false);
  });

  it("prefers a bound connection proxy over env proxy", () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    expect(resolveOutboundProxyUrl("https://agent.api5.cursor.sh/models", {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:10808",
    })).toBe("http://127.0.0.1:10808");
  });

  it("falls back to HTTPS_PROXY when no connection proxy is bound", () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:10808";
    expect(resolveOutboundProxyUrl("https://agent.api5.cursor.sh/models", null))
      .toBe("http://127.0.0.1:10808");
  });
});
