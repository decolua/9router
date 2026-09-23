import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalRequestLogs = process.env.ENABLE_REQUEST_LOGS;
const originalBatchSize = process.env.OBSERVABILITY_BATCH_SIZE;
let tempDir;
let db;
let adapter;
const testDetailId = `redaction-${process.pid}`;

beforeAll(async () => {
  const sharedState = global._dbAdapter;
  try { sharedState?.instance?.close?.(); } catch {}
  if (sharedState) {
    sharedState.instance = null;
    sharedState.initPromise = null;
    sharedState.logged = false;
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-details-redaction-"));
  process.env.DATA_DIR = tempDir;
  process.env.ENABLE_REQUEST_LOGS = "true";
  process.env.OBSERVABILITY_BATCH_SIZE = "1";
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterAll(() => {
  try { adapter?.run?.("DELETE FROM requestDetails WHERE id = ?", [testDetailId]); } catch {}
  try { adapter?.close?.(); } catch {}
  if (global._dbAdapter?.instance === adapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalRequestLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalRequestLogs;
  if (originalBatchSize === undefined) delete process.env.OBSERVABILITY_BATCH_SIZE;
  else process.env.OBSERVABILITY_BATCH_SIZE = originalBatchSize;
});

describe("request detail storage redaction", () => {
  it("does not persist request or provider payload values", async () => {
    await db.saveRequestDetail({
      id: testDetailId,
      provider: "openai",
      model: "gpt-test",
      status: "success",
      request: { messages: [{ role: "user", content: "user-secret" }] },
      providerRequest: { input: "provider-secret" },
      providerResponse: { output: "response-secret" },
      response: { content: "answer-secret" },
    });
    let stored = null;
    for (let attempt = 0; attempt < 20 && !stored; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      stored = await db.getRequestDetailById(testDetailId);
    }

    expect(stored.request).toEqual({ redacted: true });
    expect(stored.providerRequest).toEqual({ redacted: true });
    expect(stored.providerResponse).toEqual({ redacted: true });
    expect(stored.response).toEqual({ redacted: true });
    expect(JSON.stringify(stored)).not.toMatch(/secret/);
  });
});
