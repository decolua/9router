// RED phase: route file doesn't exist yet
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-ts-route-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function loadRoute() {
  return await import("../../src/app/api/token-saver/stats/route.js");
}

async function loadDb() {
  return await import("@/lib/db/index.js");
}

describe("GET /api/token-saver/stats", () => {
  it("returns 400 for invalid period", async () => {
    const route = await loadRoute();
    const req = new Request("http://localhost/api/token-saver/stats?period=bogus");
    const res = await route.GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 with body shape for valid periods", async () => {
    const db = await loadDb();
    await db.recordTokenSaverEvent({ requestsObserved: 2, headroomState: "disabled" });
    const route = await loadRoute();

    for (const period of ["today", "24h", "7d", "30d", "60d", "365d"]) {
      const req = new Request(`http://localhost/api/token-saver/stats?period=${period}`);
      const res = await route.GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.requestsObserved).toBe(2);
      expect(body.rtk).toBeDefined();
      expect(body.headroom).toBeDefined();
      expect(body.totals).toBeDefined();
    }
  });

  it("defaults to 7d when no period provided", async () => {
    const db = await loadDb();
    await db.recordTokenSaverEvent({ requestsObserved: 1, headroomState: "disabled" });
    const route = await loadRoute();
    const req = new Request("http://localhost/api/token-saver/stats");
    const res = await route.GET(req);
    expect(res.status).toBe(200);
  });
});
