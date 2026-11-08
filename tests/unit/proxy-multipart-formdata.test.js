// Issue #5525: STT multipart uploads break after 0.5.116 because the patched
// fetch routes through the `undici` package, which does not serialize Node's
// global FormData as multipart. proxyFetch must rebuild the body with the
// undici FormData class so upstreams receive multipart/form-data.
import { describe, it, expect, beforeEach } from "vitest";
import http from "node:http";

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("proxyAwareFetch multipart FormData (issue #5525)", () => {
  beforeEach(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
  });

  it("sends Node FormData as multipart/form-data to the upstream", async () => {
    const seen = {};
    await withServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.contentType = req.headers["content-type"] || "";
        seen.body = Buffer.concat(chunks).toString("latin1");
        res.end(JSON.stringify({ ok: true }));
      });
    }, async (port) => {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      const fd = new FormData();
      fd.append("file", new Blob(["fake wav bytes"], { type: "audio/wav" }), "clip.wav");
      fd.append("model", "test-model");
      const res = await proxyAwareFetch(`http://127.0.0.1:${port}/v1/audio/transcriptions`, {
        method: "POST",
        body: fd,
      });
      expect(res.ok).toBe(true);
    });

    expect(seen.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen.body).toContain('name="file"');
    expect(seen.body).toContain("fake wav bytes");
    expect(seen.body).toContain('name="model"');
  });
});
