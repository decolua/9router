// Decisive repro for issue #796 — add a SECOND Codex account for the SAME
// ChatGPT email (the real user flow). ChatGPT id_tokens frequently lack a
// chatgptAccountId claim, so both rows have providerSpecificData without one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
const RUN = `issue796_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-796-"));
  process.env.DATA_DIR = tempDir;
  db = await import("@/lib/db/index.js");
  await db.initDb();
});
afterAll(async () => {
  await db.deleteProviderConnectionsByProvider("codex").catch(() => {});
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function addCodex(tokenData) {
  return db.createProviderConnection({ provider: "codex", authType: "oauth", ...tokenData, testStatus: "active" });
}
async function listCodex(marker) {
  const all = await db.getProviderConnections({ provider: "codex" });
  return all.filter((c) => (c.email || "").includes(marker) || (JSON.stringify(c.providerSpecificData || "")).includes(marker));
}

describe("issue #796 — same email, second codex account", () => {
  it("D) SAME email, no chatgptAccountId, no username -> TWO rows (no merge)", async () => {
    const m = `D_${RUN}`;
    const email = `same_${m}@x.com`;
    const shape = { authMethod: "oauth" }; // no chatgptAccountId, no username
    await addCodex({ accessToken: `d1_${m}`, refreshToken: `r1_${m}`, email, providerSpecificData: shape });
    await addCodex({ accessToken: `d2_${m}`, refreshToken: `r2_${m}`, email, providerSpecificData: { ...shape } });
    const rows = await listCodex(m);
    expect(rows.length, `expected 2 rows, got ${rows.length}: ${JSON.stringify(rows.map(r => r.email))}`).toBe(2);
  });

  it("E) SAME email, chatgptAccountId on only the SECOND add -> TWO rows (no merge)", async () => {
    const m = `E_${RUN}`;
    const email = `e_${m}@x.com`;
    await addCodex({ accessToken: `e1_${m}`, refreshToken: `r1_${m}`, email, providerSpecificData: { authMethod: "oauth" } });
    await addCodex({ accessToken: `e2_${m}`, refreshToken: `r2_${m}`, email, providerSpecificData: { authMethod: "oauth", chatgptAccountId: `ws-E-${m}` } });
    const rows = await listCodex(m);
    expect(rows.length, `expected 2 rows, got ${rows.length}`).toBe(2);
  });
});
