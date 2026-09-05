import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let adapter;

async function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-custom-headers-api-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  const { POST: POST_CONN } = await import("@/app/api/providers/route.js");
  const { PUT } = await import("@/app/api/provider-nodes/[id]/route.js");
  const { createProviderNode, getProviderConnections, getProviderNodeById } =
    await import("@/models/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
  return {
    POST_CONN, PUT, createProviderNode, getProviderConnections, getProviderNodeById,
    cleanup() { fs.rmSync(tempDir, { recursive: true, force: true }); },
  };
}

let cleanup = () => {};
afterEach(() => {
  try {
    if (adapter?.close) adapter.close();
    if (adapter?.dispose) adapter.dispose();
    adapter = null;
  } catch { /* best effort */ }
  // driver.js caches the adapter on globalThis; resetModules() alone doesn't
  // clear it, so without this the next test would reuse a closed database.
  try { globalThis._dbAdapter = { instance: null, initPromise: null, logged: false }; } catch {}
  vi.doUnmock("next/server");
  vi.resetModules();
  vi.clearAllMocks();
  cleanup(); cleanup = () => {};
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function connReq(provider) {
  return new Request("https://9router.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey: "k", name: "C1" }),
  });
}
function putReq(body) {
  return new Request("https://9router.local/api/provider-nodes/x", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("customHeaders propagation", () => {
  it("new connection inherits node.customHeaders", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const node = await ctx.createProviderNode({
      id: "openai-compatible-chat-t1", type: "openai-compatible",
      name: "N", prefix: "n1", apiType: "chat", baseUrl: "https://x/v1",
      customHeaders: [{ name: "X-A", value: "v" }],
    });
    const res = await ctx.POST_CONN(connReq(node.id));
    expect(res.status).toBe(201);
    const conns = await ctx.getProviderConnections({ provider: node.id });
    expect(conns[0].providerSpecificData.customHeaders).toEqual([{ name: "X-A", value: "v" }]);
  });

  it("PUT stores customHeaders on node and fans out to existing connections", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const node = await ctx.createProviderNode({
      id: "openai-compatible-chat-t2", type: "openai-compatible",
      name: "N", prefix: "n2", apiType: "chat", baseUrl: "https://x/v1",
    });
    await ctx.POST_CONN(connReq(node.id)); // create a connection first (no headers yet)

    const res = await ctx.PUT(putReq({
      name: "N", prefix: "n2", apiType: "chat", baseUrl: "https://x/v1",
      customHeaders: [{ name: "User-Agent", value: "chrome" }],
    }), { params: Promise.resolve({ id: node.id }) });
    expect(res.status).toBe(200);

    const stored = await ctx.getProviderNodeById(node.id);
    expect(stored.customHeaders).toEqual([{ name: "User-Agent", value: "chrome", ttlMinutes: null }]);

    const conns = await ctx.getProviderConnections({ provider: node.id });
    expect(conns[0].providerSpecificData.customHeaders).toEqual([{ name: "User-Agent", value: "chrome", ttlMinutes: null }]);
  });

  it("PUT with invalid header name → 400", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const node = await ctx.createProviderNode({
      id: "openai-compatible-chat-t3", type: "openai-compatible",
      name: "N", prefix: "n3", apiType: "chat", baseUrl: "https://x/v1",
    });
    const res = await ctx.PUT(putReq({
      name: "N", prefix: "n3", apiType: "chat", baseUrl: "https://x/v1",
      customHeaders: [{ name: "Bad Header", value: "v" }],
    }), { params: Promise.resolve({ id: node.id }) });
    expect(res.status).toBe(400);
  });
});
