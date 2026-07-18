import { describe, expect, it } from "vitest";
import { gzipSync, zstdCompressSync } from "node:zlib";

import { decodeBody, parseJsonBody } from "../../src/shared/utils/parseJsonBody.js";

function makeRequest(body, headers = {}) {
  return new Request("http://localhost/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("parseJsonBody Content-Encoding", () => {
  it("parses plain JSON without Content-Encoding", async () => {
    const payload = { model: "gpt-5.6-sol", stream: true };
    const body = await parseJsonBody(makeRequest(JSON.stringify(payload)));
    expect(body).toEqual(payload);
  });

  it("parses gzip-compressed JSON", async () => {
    const payload = { model: "gpt-5.6-sol", input: "hi" };
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const body = await parseJsonBody(
      makeRequest(compressed, { "content-encoding": "gzip" })
    );
    expect(body).toEqual(payload);
  });

  it("parses zstd-compressed JSON (Codex official OpenAI path)", async () => {
    if (typeof zstdCompressSync !== "function") {
      // Node < 22.15 — skip; production Codex path requires modern Node
      return;
    }
    const payload = { model: "gpt-5.6-sol", stream: true, store: false };
    const compressed = zstdCompressSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const body = await parseJsonBody(
      makeRequest(compressed, { "content-encoding": "zstd" })
    );
    expect(body).toEqual(payload);
  });

  it("decodeBody handles gzip", () => {
    const raw = Buffer.from('{"a":1}', "utf8");
    const gz = gzipSync(raw);
    expect(decodeBody(gz, "gzip").toString("utf8")).toBe('{"a":1}');
  });
});
