import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let POST;
let PUT;
let getApiKeyById;
let getApiKeys;
const originalDataDir = process.env.DATA_DIR;

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: async () => "test-machine",
}));

function post(body) {
  return POST(
    new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function put(id, body) {
  return PUT(
    new Request(`http://localhost/api/keys/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-keys-route-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  ({ POST } = await import("../../src/app/api/keys/route.js"));
  ({ PUT } = await import("../../src/app/api/keys/[id]/route.js"));
  ({ getApiKeyById, getApiKeys } = await import("@/lib/db/index.js"));
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("POST /api/keys access handling", () => {
  it("rejects invalid canonical access with 400 and persists nothing", async () => {
    const response = await post({ name: "bad", access: { restricted: "yes", allow: [] } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/access\.restricted must be a boolean/);
    expect(await getApiKeys()).toEqual([]);
  });

  it("persists canonical access and returns the stored row", async () => {
    const response = await post({ name: "canonical", access: { restricted: true, allow: [" Main ", "main"] } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.access).toEqual({ restricted: true, allow: ["Main"] });
    expect(body.allowedModels).toEqual([]);
    expect(body.scopes).toEqual(["manage"]);

    const stored = await getApiKeyById(body.id);
    expect(body).toEqual({ ...stored });
  });

  it.each(["kr/*", ["kr/*", 7]])("rejects malformed legacy allowedModels input %o", async (allowedModels) => {
    const response = await post({ name: "legacy", allowedModels });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("allowedModels must be an array of strings");
    expect(await getApiKeys()).toEqual([]);
  });

  it("converts legacy allowedModels-only input into canonical access in the response", async () => {
    const response = await post({ name: "legacy", allowedModels: ["kr/*"] });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.access).toEqual({ restricted: true, allow: ["kr/*"] });

    const stored = await getApiKeyById(body.id);
    expect(body.access).toEqual(stored.access);
  });

  it("defaults omitted access to unrestricted in the response", async () => {
    const response = await post({ name: "plain" });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.access).toEqual({ restricted: false, allow: [] });

    const stored = await getApiKeyById(body.id);
    expect(body.access).toEqual(stored.access);
  });

  it("does not echo unknown request extras in the response", async () => {
    const response = await post({ name: "extras", type: "router", isAutoProvisioned: true });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).not.toHaveProperty("type");
    expect(body).not.toHaveProperty("isAutoProvisioned");
  });

  it("prefers canonical access over a simultaneously-provided legacy allowedModels", async () => {
    const response = await post({
      name: "both",
      access: { restricted: true, allow: ["a/*"] },
      allowedModels: ["b/*"],
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.access).toEqual({ restricted: true, allow: ["a/*"] });

    const stored = await getApiKeyById(body.id);
    expect(body).toEqual({ ...stored });
  });

  it("normalizes an unrestricted access with a nonempty legacy allow-list to allow: []", async () => {
    const response = await post({ name: "open", access: { restricted: false, allow: ["kr/*"] } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.access).toEqual({ restricted: false, allow: [] });

    const stored = await getApiKeyById(body.id);
    expect(stored.access).toEqual({ restricted: false, allow: [] });
    expect(body).toEqual({ ...stored });
  });

  it("persists and returns a restricted access with an explicit empty allow list", async () => {
    const response = await post({ name: "locked", access: { restricted: true, allow: [] } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.access).toEqual({ restricted: true, allow: [] });

    const stored = await getApiKeyById(body.id);
    expect(stored.access).toEqual({ restricted: true, allow: [] });
    expect(body).toEqual({ ...stored });
  });
});

describe("PUT /api/keys/[id] legacy access handling", () => {
  it.each(["kr/*", ["kr/*", 7]])("rejects malformed allowedModels input %o without changing a restricted key", async (allowedModels) => {
    const created = await post({ name: "restricted", access: { restricted: true, allow: ["kr/*"] } });
    const { id } = await created.json();

    const response = await put(id, { allowedModels });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("allowedModels must be an array of strings");
    expect((await getApiKeyById(id)).access).toEqual({ restricted: true, allow: ["kr/*"] });
  });
});
