import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "open-sse/rtk/headroom.js";

const TOKEN_HEADER = "X-Headroom-Proxy-Token";

function mockCompress() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ messages: [{ role: "user", content: "hi" }], tokens_saved: 1 }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function body() {
  return { messages: [{ role: "user", content: "hello world" }] };
}

afterEach(() => vi.unstubAllGlobals());

describe("headroom proxy token", () => {
  it("sends X-Headroom-Proxy-Token when a token is configured", async () => {
    const fetchMock = mockCompress();
    await compressWithHeadroom(body(), {
      enabled: true,
      url: "https://headroom.example.com",
      token: "s3cret",
      model: "gpt-4o",
      format: "openai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers[TOKEN_HEADER]).toBe("s3cret");
  });

  it("omits the header when no token is configured", async () => {
    const fetchMock = mockCompress();
    await compressWithHeadroom(body(), {
      enabled: true,
      url: "http://localhost:8787",
      model: "gpt-4o",
      format: "openai",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(TOKEN_HEADER);
  });
});
