import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir = "";

async function setupRoutes() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-prefix-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const collection = await import("@/app/api/provider-nodes/route.js");
  const item = await import("@/app/api/provider-nodes/[id]/route.js");
  return { ...collection, ...item };
}

function request(body) {
  return new Request("http://localhost/api/provider-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("custom provider prefix validation", () => {
  it("rejects a reserved built-in prefix on creation with an actionable error", async () => {
    const { POST } = await setupRoutes();
    const response = await POST(request({
      name: "Custom OpenAI",
      prefix: "openai",
      type: "openai-compatible",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Choose a unique prefix");
  });

  it("accepts a unique prefix and rejects changing it to a reserved alias", async () => {
    const { POST, PUT } = await setupRoutes();
    const created = await POST(request({
      name: "Custom OpenAI",
      prefix: "openai-acme",
      type: "openai-compatible",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    }));
    expect(created.status).toBe(201);
    const { node } = await created.json();

    const update = new Request(`http://localhost/api/provider-nodes/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: node.name,
        prefix: "openai",
        apiType: "chat",
        baseUrl: "https://compatible.test/v1",
      }),
    });
    const response = await PUT(update, { params: Promise.resolve({ id: node.id }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Choose a unique prefix");
  });
});
