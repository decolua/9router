import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-commandcode-zdr-"));
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

  const { POST } = await import("@/app/api/providers/route.js");
  const { PUT } = await import("@/app/api/providers/[id]/route.js");
  const { getProviderConnectionById } = await import("@/models/index.js");
  return { POST, PUT, getProviderConnectionById, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

function createRequest() {
  return new Request("http://9router.local/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "commandcode",
      apiKey: "test-key",
      name: "ZDR connection",
      providerSpecificData: { zdrEnabled: true },
    }),
  });
}

function updateRequest(zdrEnabled) {
  return new Request("http://9router.local/api/providers/id", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerSpecificData: { zdrEnabled } }),
  });
}

afterEach(() => {
  vi.doUnmock("next/server");
  vi.resetModules();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Command Code ZDR connection persistence", () => {
  it("persists the strict boolean policy at creation and updates it without replacing other connection data", async () => {
    const ctx = await setup();
    try {
      const createResponse = await ctx.POST(createRequest());
      const created = await createResponse.json();
      const id = created.connection.id;

      expect(createResponse.status).toBe(201);
      expect((await ctx.getProviderConnectionById(id)).providerSpecificData).toMatchObject({ zdrEnabled: true });

      const updateResponse = await ctx.PUT(updateRequest(false), { params: Promise.resolve({ id }) });
      expect(updateResponse.status).toBe(200);
      expect((await ctx.getProviderConnectionById(id)).providerSpecificData).toMatchObject({
        zdrEnabled: false,
        connectionProxyEnabled: false,
      });
    } finally {
      ctx.cleanup();
    }
  });
});
