import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const leaderboardHtml =
  '<script>self.__next_f.push([1,"[{\\"slug\\":\\"gpt-6-astra\\",\\"name\\":\\"GPT-6 Astra\\",\\"intelligenceIndex\\":52.67,\\"modelCreatorName\\":\\"OpenAI\\"}],\\"messages\\""]);</script>';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch({ body = leaderboardHtml, contentLength = null } = {}) {
  const fn = vi.fn(async () => ({
    ok: true,
    headers: { get: () => (contentLength === null ? null : String(contentLength)) },
    body: null,
    text: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("leaderboard fetch hardening", () => {
  it("rate-limits repeated forced refreshes by serving the cache within the cooldown", async () => {
    const fetchMock = stubFetch();
    const { fetchLeaderboardModels } = await import("../../src/lib/services/artificialAnalysis.js");

    const first = await fetchLeaderboardModels({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual([expect.objectContaining({ slug: "gpt-6-astra", intelligenceIndex: 52.67 })]);

    const second = await fetchLeaderboardModels({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("rejects an oversized declared response before reading the body", async () => {
    const fetchMock = stubFetch({ contentLength: 100 * 1024 * 1024 });
    const { fetchLeaderboardModels } = await import("../../src/lib/services/artificialAnalysis.js");

    await expect(fetchLeaderboardModels({ forceRefresh: true })).rejects.toThrow(
      "Failed to fetch Artificial Analysis leaderboard"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces a request timeout via AbortSignal", async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, headers: { get: () => null }, body: null, text: async () => leaderboardHtml };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchLeaderboardModels } = await import("../../src/lib/services/artificialAnalysis.js");

    await fetchLeaderboardModels({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
