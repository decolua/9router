import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The route uses `getCliToken()` (machine-derived) for auth and the real
// `createProviderConnection` (SQLite) for persistence. Mock only next/server
// so we can invoke the handler directly; keep the DB real with a temp DATA_DIR.
//
// DATA_DIR + the DB adapter are captured at module-import time and survive
// across files in the same Vitest worker, so we use a UNIQUE temp dir per file
// and reset the module registry + adapter singleton before importing.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

let POST;
let getCliToken;
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `cli-codex-${Date.now()}-${Math.random().toString(36).slice(2)}-`)
);

beforeAll(async () => {
  vi.resetModules();
  process.env.DATA_DIR = tempDir;
  globalThis._dbAdapter = { instance: null, initPromise: null, logged: false };

  const routeModule = await import(
    "../../src/app/api/cli/providers/codex/route.js"
  );
  POST = routeModule.POST;
  getCliToken = (await import("@/lib/oauth/cliCredentials")).getCliToken;
});

describe("POST /api/cli/providers/codex (#796 CLI persistence)", () => {
  function makeRequest(token, body) {
    return {
      headers: {
        get: (k) =>
          k.toLowerCase() === "x-9r-cli-token" ? token : null,
      },
      json: async () => body,
    };
  }

  it("rejects requests with no CLI token (401)", async () => {
    const res = await POST(makeRequest(null, { accessToken: "tok-abc" }));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("rejects requests with a wrong CLI token (401)", async () => {
    const res = await POST(
      makeRequest("wrong-token", { accessToken: "tok-abc" })
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing accessToken (400)", async () => {
    const token = await getCliToken();
    const res = await POST(makeRequest(token, {}));
    expect(res.status).toBe(400);
  });

  it("persists a Codex connection when authenticated (200) and it appears in the list", async () => {
    const { getProviderConnections } = await import("@/models");
    const before = (await getProviderConnections("codex")).length;
    const token = await getCliToken();
    const res = await POST(
      makeRequest(token, {
        accessToken: "sk-codex-token-1",
        refreshToken: "sk-refresh-1",
        expiresIn: 3600,
        lastRefreshAt: new Date().toISOString(),
      })
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.connection.provider).toBe("codex");

    const all = await getProviderConnections("codex");
    expect(all.map((c) => c.id)).toContain(res.body.connection.id);
    expect(all.length).toBe(before + 1);
  });

  it("persists a SECOND Codex connection (no silent overwrite) — #796 regression", async () => {
    const { getProviderConnections } = await import("@/models");
    const before = (await getProviderConnections("codex")).length;
    const token = await getCliToken();
    const first = await POST(
      makeRequest(token, { accessToken: "sk-codex-token-A" })
    );
    const second = await POST(
      makeRequest(token, { accessToken: "sk-codex-token-B" })
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.connection.id).not.toBe(second.body.connection.id);

    const all = await getProviderConnections("codex");
    expect(all.length).toBe(before + 2);
  });
});
