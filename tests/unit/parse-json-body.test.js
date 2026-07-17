import { describe, expect, it } from "vitest";
import { brotliCompressSync, gzipSync, zstdCompressSync } from "node:zlib";

import { decodeBody, parseJsonBody } from "../../src/shared/utils/parseJsonBody.js";

function makeRequest(body, { encoding } = {}) {
  const headers = { "content-type": "application/json" };
  if (encoding) headers["content-encoding"] = encoding;
  return new Request("http://localhost/v1/responses", {
    method: "POST",
    headers,
    body,
  });
}

describe("parseJsonBody", () => {
  const payload = { model: "gpt-5.6-sol", input: "hi" };
  const json = JSON.stringify(payload);

  it("parses plain JSON without Content-Encoding", async () => {
    const body = await parseJsonBody(makeRequest(json));
    expect(body).toEqual(payload);
  });

  it("parses zstd-compressed JSON (Codex OpenAI/ChatGPT mode)", async () => {
    if (typeof zstdCompressSync !== "function") return;
    const compressed = zstdCompressSync(Buffer.from(json));
    const body = await parseJsonBody(makeRequest(compressed, { encoding: "zstd" }));
    expect(body).toEqual(payload);
  });

  it("parses gzip-compressed JSON", async () => {
    const compressed = gzipSync(Buffer.from(json));
    const body = await parseJsonBody(makeRequest(compressed, { encoding: "gzip" }));
    expect(body).toEqual(payload);
  });

  it("parses brotli-compressed JSON", async () => {
    const compressed = brotliCompressSync(Buffer.from(json));
    const body = await parseJsonBody(makeRequest(compressed, { encoding: "br" }));
    expect(body).toEqual(payload);
  });

  it("decodeBody handles zstd primary token", () => {
    if (typeof zstdCompressSync !== "function") return;
    const raw = Buffer.from(json);
    const compressed = zstdCompressSync(raw);
    expect(decodeBody(compressed, "zstd").toString("utf8")).toBe(json);
  });
});
