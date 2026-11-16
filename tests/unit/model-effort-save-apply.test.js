import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The dashboard's save → apply path for the per-model effort, with the real
 * settings route and DB: PATCH /api/settings exactly as page.js sends it, read
 * back the way chat.js reads it (`getSettings().providerThinking[provider]`), and
 * applied the way chatCore applies it. Nothing in between may drop `models`.
 */
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let route;
let applyModelEffort;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-effort-save-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  route = await import("@/app/api/settings/route.js");
  ({ applyModelEffort } = await import("open-sse/services/modelEffort.js"));
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* sqlite still open on Windows */ }
});

const patch = (providerThinking) => route.PATCH(new Request("http://localhost/api/settings", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerThinking }),
}));

describe("per-model effort: saved from the dashboard, applied to a request", () => {
  it("survives the settings route and is applied over the client's effort", async () => {
    const res = await patch({ codex: { models: { "gpt-6-luna": "low", "gpt-6-astra": "high" } } });
    expect(res.status).toBe(200);

    const stored = (await db.getSettings()).providerThinking.codex;
    expect(stored.models).toEqual({ "gpt-6-luna": "low", "gpt-6-astra": "high" });

    const luna = applyModelEffort({ reasoning_effort: "medium" }, "codex", "gpt-6-luna", stored);
    const astra = applyModelEffort({ reasoning_effort: "medium" }, "codex", "gpt-6-astra", stored);
    const sol = applyModelEffort({ reasoning_effort: "medium" }, "codex", "gpt-6-sol", stored);
    expect(luna.reasoning_effort).toBe("low");
    expect(astra.reasoning_effort).toBe("high");
    expect(sol.reasoning_effort).toBe("medium"); // no setting: the client's stays
  });

  it("keeps the provider-wide mode and the per-model map together", async () => {
    await patch({ codex: { mode: "high", models: { "gpt-6-luna": "low" } } });
    const stored = (await db.getSettings()).providerThinking.codex;
    expect(stored).toEqual({ mode: "high", models: { "gpt-6-luna": "low" } });
  });

  it("is gone when the dashboard clears it (auto everywhere)", async () => {
    await patch({});
    const stored = (await db.getSettings()).providerThinking || {};
    expect(stored.codex).toBeUndefined();
    const body = { reasoning_effort: "medium" };
    expect(applyModelEffort(body, "codex", "gpt-6-luna", stored.codex)).toBe(body);
  });
});
