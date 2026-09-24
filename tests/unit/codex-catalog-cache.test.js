import { afterEach, expect, it, vi } from "vitest";
const oauth = vi.hoisted(() => ({ refresh: vi.fn(), persist: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshCodexToken: oauth.refresh, updateProviderCredentials: oauth.persist,
}));
import { resolveCodexCatalog } from "@/lib/codexModels.js";
it("invalidates old token cache entries when credentials rotate", async () => {
  const conn = connection();
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload));
  await resolveCodexCatalog(conn);
  await resolveCodexCatalog({ ...conn, accessToken: "replacement-token" });
  await resolveCodexCatalog(conn);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("bounds retained catalogs and evicts the oldest entry", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload));
  const first = connection();
  await resolveCodexCatalog(first);
  for (let i = 0; i < 256; i++) await resolveCodexCatalog(connection());
  const calls = fetcher.mock.calls.length;
  await resolveCodexCatalog(first);
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
});
it("retains last-known limits on transient errors with retry backoff and bounded staleness", async () => {
  vi.useFakeTimers();
  const conn = connection();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload));
  const initial = await resolveCodexCatalog(conn);
  vi.advanceTimersByTime(300001);
  fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
  expect(await resolveCodexCatalog(conn)).toEqual(initial);
  expect(warning).toHaveBeenCalled();
  await resolveCodexCatalog(conn);
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(30001);
  await resolveCodexCatalog(conn);
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(3600000);
  expect(await resolveCodexCatalog(conn)).toEqual([]);
});
it("does not retain entitlement after a terminal authorization failure", async () => {
  vi.useFakeTimers();
  const conn = { ...connection(), refreshToken: undefined };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload));
  await resolveCodexCatalog(conn);
  vi.advanceTimersByTime(300001);
  fetcher.mockImplementation(async () => new Response(null, { status: 403 }));
  expect(await resolveCodexCatalog(conn)).toEqual([]);
});
it("does not invent a static context limit when upstream omits it", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ models: [{ slug: "synthetic-model" }] }));
  expect(await resolveCodexCatalog(connection())).toEqual([]);
});
it("drops stale entitlement even when OAuth refresh throws", async () => {
  vi.useFakeTimers();
  const conn = connection();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload));
  await resolveCodexCatalog(conn);
  vi.advanceTimersByTime(300001);
  fetcher.mockImplementation(async () => new Response(null, { status: 401 }));
  oauth.refresh.mockRejectedValue(new Error("synthetic refresh failure"));
  expect(await resolveCodexCatalog(conn)).toEqual([]);
});
it("removes the pre-refresh cache key instead of resurrecting its old catalog", async () => {
  vi.useFakeTimers();
  const conn = connection();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(payload));
  await resolveCodexCatalog(conn);
  vi.advanceTimersByTime(300001);
  oauth.refresh.mockResolvedValue({ accessToken: "refreshed-token" });
  fetcher.mockImplementation(async (_, options) => options.headers.Authorization === "Bearer old-token"
    ? new Response(null, { status: 401 }) : Response.json({ models: [] }));
  expect(await resolveCodexCatalog(conn)).toEqual([]);
  fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
  expect(await resolveCodexCatalog(conn)).toEqual([]);
});
let serial = 0;
const connection = () => ({ id: `synthetic-${++serial}`, accessToken: "old-token", refreshToken: "refresh-token" });
const payload = { models: [{ slug: "synthetic-model", context_window: 12000, max_context_window: 48000 }] };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); oauth.refresh.mockReset(); oauth.persist.mockReset(); });

it("single-flights concurrent discovery and OAuth refresh", async () => {
  const conn = connection();
  oauth.refresh.mockResolvedValue({ accessToken: "new-token", refreshToken: "rotated-refresh", expiresIn: 3600 });
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_, options) =>
    options.headers.Authorization === "Bearer old-token"
      ? new Response(null, { status: 401 }) : Response.json(payload));
  const results = await Promise.all(Array.from({ length: 8 }, () => resolveCodexCatalog({ ...conn })));
  expect(results.every((result) => result[0].capabilities.contextWindow === 12000)).toBe(true);
  expect(oauth.refresh).toHaveBeenCalledTimes(1);
  expect(oauth.persist).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await resolveCodexCatalog({ ...conn, accessToken: "new-token", refreshToken: "rotated-refresh" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
