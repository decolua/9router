import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let rows;
let fail;
const scope = "freebuff::model";
function entry(poolId, until, version = 1) { return { poolId, scope, until, reason: "reason", version }; }
function safe(operation, secret) { const message = console.warn.mock.calls.find(([value]) => value.includes(`[proxy-fitness] ${operation} failed:`))?.[0]; expect(message).toBeDefined(); expect(message).not.toContain(secret); expect(message).not.toMatch(/https?:|\n|\t/); expect(Buffer.byteLength(message, "utf8")).toBeLessThanOrEqual(512); }
async function service() {
  vi.resetModules(); delete global.__9routerPoolFitness__;
  vi.doMock("@/models", () => ({
    getProxyPoolById: vi.fn(async () => null),
    listProxyPoolFitness: vi.fn(async (poolId) => { if (fail.list) throw fail.list; return rows.filter((row) => poolId == null || row.poolId === poolId); }),
    upsertProxyPoolFitness: vi.fn(async (poolId, itemScope, until, reason) => { if (fail.upsert) throw fail.upsert; const old = rows.find((row) => row.poolId === poolId && row.scope === itemScope); if (old && until < old.until) return old; const next = { poolId, scope: itemScope, until, reason, version: old ? old.version + 1 : 1 }; rows = rows.filter((row) => row !== old).concat(next); return next; }),
    deleteProxyPoolFitness: vi.fn(async (poolId, itemScope) => { if (fail.delete) throw fail.delete; const size = rows.length; rows = rows.filter((row) => row.poolId !== poolId || row.scope !== itemScope); return { changes: size - rows.length }; }),
    deleteProxyPoolFitnessVersion: vi.fn(async (poolId, itemScope, version) => { if (fail.deleteVersion) throw fail.deleteVersion; const size = rows.length; rows = rows.filter((row) => row.poolId !== poolId || row.scope !== itemScope || row.version !== version); return { changes: size - rows.length }; }),
    clearProxyPoolFitness: vi.fn(async () => ({ changes: 0 })),
  }));
  return import("../../open-sse/services/proxyPoolFitness.js");
}
beforeEach(() => { rows = []; fail = {}; vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock("@/models"); delete global.__9routerPoolFitness__; });
describe("proxy-pool fitness degradation", () => {
  it("keeps cache on read failure with byte-safe log", async () => { const now = 1; rows = [entry("cache", now + 1000)]; const api = await service(); await api.loadPoolFitness("cache", now); fail.list = new Error("Bearer read-secret\nhttps://host/a\t🙂".repeat(100)); expect(await api.loadPoolFitness("cache", now)).toBe(false); expect(api.fitPoolIds(["cache"], scope, now)).toEqual([]); safe("load", "read-secret"); });
  it("does not fabricate cache on initial or mark failure", async () => { fail.list = new Error("Bearer initial-secret\nhttps://host/a\t"); const api = await service(); expect(await api.loadPoolFitness("initial", 1)).toBe(false); fail.list = null; fail.upsert = new Error("Bearer mark-secret\nhttps://host/a\t"); expect(await api.markPoolUnfit("mark", scope, 100)).toBeNull(); expect(api.fitPoolIds(["initial", "mark"], scope, 1)).toEqual(["initial", "mark"]); safe("load", "initial-secret"); safe("mark", "mark-secret"); });
  it("keeps cached row after clear miss and failure", async () => { const api = await service(); const marked = await api.markPoolUnfit("clear", scope, 100); fail.deleteVersion = new Error("Bearer clear-secret\nhttps://host/a\t"); expect(await api.clearPoolUnfit("clear", scope, marked.version)).toBe(false); expect(api.fitPoolIds(["clear"], scope, 1)).toEqual([]); safe("clear", "clear-secret"); });
  it("reconciles complete snapshot and reports snapshot read failure", async () => { const api = await service(); await api.markPoolUnfit("snapshot", scope, 100); rows = []; expect(await api.poolFitnessSnapshot(1)).toEqual({}); expect(api.fitPoolIds(["snapshot"], scope, 1)).toEqual(["snapshot"]); fail.list = new Error("Bearer snapshot-secret\nhttps://host/a\t"); expect(await api.poolFitnessSnapshot(1)).toBeNull(); safe("snapshot", "snapshot-secret"); });
  it("counts partial prune and preserves failed persistence", async () => { const now = 10; rows = [entry("a", 1), entry("b", 1)]; const api = await service(); let calls = 0; fail.delete = null; const originalDelete = rows; vi.doMock; const module = await import("@/models"); module.deleteProxyPoolFitness.mockImplementation(async (poolId, itemScope) => { calls += 1; if (calls === 2) throw new Error("Bearer prune-secret\nhttps://host/a\t"); const size = rows.length; rows = rows.filter((row) => row.poolId !== poolId || row.scope !== itemScope); return { changes: size - rows.length }; }); expect(await api.pruneExpired(now)).toBe(1); expect(rows).toMatchObject([{ poolId: "b" }]); safe("prune", "prune-secret"); expect(originalDelete).toBeDefined(); });
  it("retains cache for a conditional delete miss", async () => { const api = await service(); const marked = await api.markPoolUnfit("clear-miss", scope, 100); const module = await import("@/models"); module.deleteProxyPoolFitnessVersion.mockResolvedValue({ changes: 0 }); expect(await api.clearPoolUnfit("clear-miss", scope, marked.version)).toBe(false); expect(api.fitPoolIds(["clear-miss"], scope, 1)).toEqual([]); });
  it("returns zero when prune cannot read persistence", async () => { fail.list = new Error("Bearer prune-read-secret\nhttps://host/a\t"); const api = await service(); expect(await api.pruneExpired(10)).toBe(0); safe("prune", "prune-read-secret"); });
  it("keeps cache when an expired snapshot delete fails", async () => { const api = await service(); rows = [entry("snapshot-delete", 1)]; await api.loadPoolFitness("snapshot-delete", 0); const module = await import("@/models"); module.deleteProxyPoolFitness.mockRejectedValue(new Error("Bearer snapshot-delete-secret\nhttps://host/a\t")); expect(await api.poolFitnessSnapshot(10)).toEqual({}); expect(api.fitPoolIds(["snapshot-delete"], scope, 0)).toEqual([]); safe("snapshot", "snapshot-delete-secret"); });
});
