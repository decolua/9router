import { describe, it, expect, vi, beforeEach } from "vitest";
import { zstdCompressSync } from "node:zlib";
const { handleChat } = vi.hoisted(() => ({ handleChat: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));
import { POST } from "../../src/app/api/v1/responses/compact/route.js";

describe("compact compressed JSON", () => {
  beforeEach(() => { handleChat.mockReset(); });
  it("decodes zstd and removes stale representation headers", async () => {
    const bytes = zstdCompressSync(JSON.stringify({ model: "test" }));
    handleChat.mockImplementation(async (request) => {
      expect(request.headers.get("content-encoding")).toBeNull();
      expect(request.headers.get("content-length")).toBeNull();
      expect(request.headers.get("authorization")).toBe("Bearer test");
      expect(await request.json()).toEqual({ model: "test", _compact: true });
      return new Response("OK");
    });
    const response = await POST(new Request("http://localhost/v1/responses/compact", {
      method: "POST", body: bytes,
      headers: { "content-encoding": "zstd", "content-length": String(bytes.length), authorization: "Bearer test" },
    }));
    expect(await response.text()).toBe("OK");
    expect(handleChat).toHaveBeenCalledOnce();
  });
  it("rejects malformed compressed bodies before dispatch", async () => {
    const response = await POST(new Request("http://localhost/v1/responses/compact", {
      method: "POST", body: "broken", headers: { "content-encoding": "zstd" },
    }));
    expect(response.status).toBe(400);
    expect(handleChat).not.toHaveBeenCalled();
  });
});
