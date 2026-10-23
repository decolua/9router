import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ adapter: null }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => current.adapter }));
vi.mock("@/lib/db/index.js", () => ({
  getProviderConnectionById: async (id) => {
    const row = current.adapter.get("SELECT * FROM providerConnections WHERE id = ?", [id]);
    return row ? { ...JSON.parse(row.data), id: row.id, provider: row.provider, authType: row.authType } : null;
  },
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";
import { createMiniMaxResetPending, loadMiniMaxResetState, miniMaxAccountKey, writeMiniMaxResetPending } from "../../src/lib/miniMaxResetState.js";
import { redeemMiniMaxResetCard } from "../../open-sse/services/minimaxCodeUsage.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"fixture-account"}').toString("base64url")}.fixture`;
const card = { cardId: "fixture-card", source_type: "original-source", out_biz_no: "original-business", type: "FULL", expiresAt: "2099-01-01T00:00:00.000Z" };
const account = miniMaxAccountKey(token);
const cleanup = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const item of cleanup.splice(0)) {
    item.adapter.close();
    for (const event of ["beforeExit", "SIGINT", "SIGTERM"]) {
      for (const listener of process.listeners(event)) if (!item.listeners[event].has(listener)) process.removeListener(event, listener);
    }
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
  proxyAwareFetch.mockReset();
});

async function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), "9router-reset-sqljs-"));
  const file = join(directory, "data.sqlite");
  const listeners = Object.fromEntries(["beforeExit", "SIGINT", "SIGTERM"].map((event) => [event, new Set(process.listeners(event))]));
  const adapter = await createSqlJsAdapter(file);
  cleanup.push({ directory, adapter, listeners });
  current.adapter = adapter;
  adapter.exec("CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, authType TEXT, data TEXT, updatedAt TEXT)");
  adapter.run("INSERT INTO providerConnections VALUES (?, ?, ?, ?, ?)", ["fixture", "minimax-code-global", "oauth", JSON.stringify({ accessToken: token, refreshToken: "fixture-refresh", unrelated: { keep: true } }), ""]);
  adapter.flush();
  const SQL = await initSqlJs();
  const onDisk = () => {
    const disk = new SQL.Database(fs.readFileSync(file));
    try { return JSON.parse(disk.exec("SELECT data FROM providerConnections WHERE id = 'fixture'")[0].values[0][0]); }
    finally { disk.close(); }
  };
  return { adapter, file, onDisk };
}

describe("MiniMax recovery with the sql.js fallback", () => {
  it("persists the original journal before redemption and persists final acknowledgment without debounce or close", async () => {
    const { adapter, onDisk } = await fixture();
    const pending = createMiniMaxResetPending(account, card);
    await writeMiniMaxResetPending("fixture", account, null, pending);
    proxyAwareFetch.mockImplementationOnce(async () => {
      expect(onDisk()).toMatchObject({ miniMaxResetPending: pending, unrelated: { keep: true } });
      return new Response(JSON.stringify({ base_resp: { status_code: 0 }, outcome: "SUCCESS" }));
    });
    expect(await redeemMiniMaxResetCard(token, "minimax-code-global", pending.card)).toMatchObject({ ok: true });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const refreshing = { ...pending, state: "refreshing" };
    await writeMiniMaxResetPending("fixture", account, pending, refreshing);
    expect(onDisk().miniMaxResetPending).toEqual(refreshing);
    await writeMiniMaxResetPending("fixture", account, refreshing, null);
    expect(onDisk()).toMatchObject({ miniMaxResetPending: null, unrelated: { keep: true } });
    const write = vi.spyOn(fs, "writeFileSync");
    adapter.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("blocks the outbound POST and later reads when saving fails, then recovers by flushing the same identity", async () => {
    const { file, onDisk } = await fixture();
    const pending = createMiniMaxResetPending(account, card);
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("simulated disk failure"); });
    const redeem = async () => {
      const saved = await writeMiniMaxResetPending("fixture", account, null, pending);
      return redeemMiniMaxResetCard(token, "minimax-code-global", saved.pending.card);
    };
    await expect(redeem()).rejects.toMatchObject({ code: "state_unavailable", status: 503 });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    await expect(loadMiniMaxResetState("fixture", account, pending)).rejects.toMatchObject({ code: "state_unavailable" });
    expect(fs.existsSync(file)).toBe(true);
    expect(onDisk().miniMaxResetPending).toBeUndefined();
    write.mockRestore();
    expect(await loadMiniMaxResetState("fixture", account, pending)).toMatchObject({ pending });
    expect(onDisk().miniMaxResetPending).toEqual(pending);
  });
});
