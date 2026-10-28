import { describe, it, expect } from "vitest";
import * as zlib from "node:zlib";
import { parseJsonBody } from "../../src/shared/utils/parseJsonBody.js";

const value = { model: "gpt-test", input: "hello" };
const json = JSON.stringify(value);
function request(body, encoding) {
  return new Request("http://localhost/v1/responses", {
    method: "POST", body,
    headers: encoding ? { "Content-Encoding": encoding } : {},
  });
}

describe("parseJsonBody", () => {
  it("preserves ordinary JSON", async () => {
    expect(await parseJsonBody(request(json))).toEqual(value);
  });
  it("accepts identity encoding", async () => {
    expect(await parseJsonBody(request(json, "identity"))).toEqual(value);
  });
  for (const [encoding, compress] of [
    ["zstd", zlib.zstdCompressSync], ["gzip", zlib.gzipSync],
    ["br", zlib.brotliCompressSync], ["deflate", zlib.deflateSync],
  ]) {
    it(`decodes ${encoding} before JSON parsing`, async () => {
      expect(await parseJsonBody(request(compress(Buffer.from(json)), encoding))).toEqual(value);
    });
    it(`bounds ${encoding} decompression output`, async () => {
      await expect(parseJsonBody(request(compress(Buffer.from(json)), encoding), 8)).rejects.toThrow();
    });
  }
  it("normalizes encoding whitespace and case", async () => {
    expect(await parseJsonBody(request(zlib.zstdCompressSync(json), " ZSTD "))).toEqual(value);
  });
  it("rejects malformed zstd", async () => {
    await expect(parseJsonBody(request("broken", "zstd"))).rejects.toThrow();
  });
  it("rejects unsupported or stacked encodings", async () => {
    for (const encoding of ["unknown", "gzip, zstd"]) {
      await expect(parseJsonBody(request(json, encoding))).rejects.toThrow();
    }
  });
  it("rejects invalid JSON after decompression", async () => {
    await expect(parseJsonBody(request(zlib.zstdCompressSync("not json"), "zstd"))).rejects.toThrow();
  });
});
