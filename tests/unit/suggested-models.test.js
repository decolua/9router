import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSuggestedModels } from "../../src/shared/utils/providerModelsFetcher.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

const TTL_MS = 10 * 60 * 1000;
const good = [
  { id: "gpt-6.1-sol", name: "gpt-6.1-sol", contextLength: 400000 },
  { id: "kimi-k3", name: "kimi-k3", contextLength: 262144 },
];

// The proxy route answers 200 with { data: [] } for an upstream outage or a malformed body.
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// Real GET /v1/models and GET /anthropic/v1/models payloads of the public DotHoosh mirror
// (policy blocks removed), so the mapping runs against the live shape.
const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const liveOpenAI = read("dothoosh-live-openai.json");
const liveAnthropic = read("dothoosh-live-anthropic.json");

let seq = 0;
const freshFetcher = () => ({ url: `https://catalog.example/${++seq}/v1/models`, type: "openai" });

describe("suggested models stay put when a refresh fails", () => {
  let fetchMock;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const expire = () => vi.advanceTimersByTime(TTL_MS + 1000);

  it.each([
    ["an empty list", () => reply({ data: [] })],
    ["a 503", () => reply({}, 503)],
    ["a network error", () => Promise.reject(new Error("offline"))],
  ])("keeps the previous list when the refresh returns %s", async (_name, bad) => {
    const fetcher = freshFetcher();
    fetchMock.mockResolvedValueOnce(reply({ data: good }));
    expect(await fetchSuggestedModels(fetcher)).toEqual(good);

    expire();
    fetchMock.mockImplementationOnce(bad);

    expect(await fetchSuggestedModels(fetcher)).toEqual(good);
  });

  it("does not cache an empty answer, so the next call asks again", async () => {
    const fetcher = freshFetcher();
    fetchMock.mockResolvedValueOnce(reply({ data: [] }));
    expect(await fetchSuggestedModels(fetcher)).toEqual([]);

    fetchMock.mockResolvedValueOnce(reply({ data: good }));
    expect(await fetchSuggestedModels(fetcher)).toEqual(good);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still replaces the list with a valid refresh", async () => {
    const fetcher = freshFetcher();
    fetchMock.mockResolvedValueOnce(reply({ data: good }));
    await fetchSuggestedModels(fetcher);

    expire();
    const next = [{ id: "only-model", name: "only-model" }];
    fetchMock.mockResolvedValueOnce(reply({ data: next }));

    expect(await fetchSuggestedModels(fetcher)).toEqual(next);
  });

  it("serves the cached list without asking again inside the TTL", async () => {
    const fetcher = freshFetcher();
    fetchMock.mockResolvedValueOnce(reply({ data: good }));
    await fetchSuggestedModels(fetcher);
    await fetchSuggestedModels(fetcher);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps previous lists per catalog URL", async () => {
    const a = freshFetcher();
    const b = freshFetcher();
    fetchMock.mockResolvedValueOnce(reply({ data: good }));
    await fetchSuggestedModels(a);

    fetchMock.mockResolvedValueOnce(reply({ data: [] }));
    expect(await fetchSuggestedModels(b)).toEqual([]);
  });
});

describe("catalog row mapping with damaged rows", () => {
  it("skips null and non-object rows, and ids that are not non-empty strings", () => {
    const rows = [null, 42, "gpt-5", { id: 7 }, { id: "  " }, { id: "kimi-k3" }];
    expect(FILTERS.openai(rows).map((m) => m.id)).toEqual(["kimi-k3"]);
  });

  it("drops a context length that is not a positive number", () => {
    const rows = [
      { id: "neg", context_length: -5 },
      { id: "text", context_length: "lots" },
      { id: "zero", context_length: 0 },
      { id: "ok", context_length: 1000 },
    ];
    expect(FILTERS.openai(rows)).toEqual([
      { id: "neg", name: "neg" },
      { id: "text", name: "text" },
      { id: "zero", name: "zero" },
      { id: "ok", name: "ok", contextLength: 1000 },
    ]);
  });

  it("prefers the live top_provider context window over the top-level one", () => {
    const rows = [{ id: "m", context_length: 100, top_provider: { context_length: 200 } }];
    expect(FILTERS.openai(rows)).toEqual([{ id: "m", name: "m", contextLength: 200 }]);
  });
});

describe("suggestions carry the live protocols and limits", () => {
  const byId = (rows) => Object.fromEntries(FILTERS.openai(rows).map((row) => [row.id, row]));

  it("passes protocols, output cap and vision through the OpenAI filter", () => {
    const rows = byId(liveOpenAI.data);
    expect(rows["deepseek-flash"]).toEqual({
      id: "deepseek-flash",
      name: "deepseek-flash",
      contextLength: 1048576,
      maxOutput: 393216,
      vision: false,
      protocols: ["anthropic-messages", "openai-chat-completions"],
    });
    expect(rows["gpt-6-luna"].protocols).toEqual(["openai-chat-completions", "openai-responses"]);
    expect(rows["kimi-k3"].maxOutput).toBeUndefined();
  });

  it("reads vision from architecture.input_modalities", () => {
    const rows = byId([
      { id: "seer", architecture: { input_modalities: ["text", "image"] } },
      { id: "blind", architecture: { input_modalities: ["text"] } },
      { id: "unknown" },
    ]);
    expect(rows.seer.vision).toBe(true);
    expect(rows.blind.vision).toBe(false);
    expect(rows.unknown).not.toHaveProperty("vision");
  });

  it("maps the Anthropic listing with its display name and the anthropic protocol", () => {
    const rows = Object.fromEntries(FILTERS.anthropic(liveAnthropic.data).map((row) => [row.id, row]));
    expect(rows["claude-haiku-5-5"]).toMatchObject({
      id: "claude-haiku-5-5",
      name: "claude-haiku-5-5",
      contextLength: 1000000,
      maxOutput: 128000,
      protocols: ["anthropic-messages"],
    });
  });
});

describe("fetchSuggestedModels with several sources", () => {
  const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const sources = () => [
    { url: `https://c.example/${Math.random()}/v1/models`, type: "openai" },
    { url: `https://c.example/${Math.random()}/anthropic/v1/models`, type: "anthropic" },
  ];
  const stub = (answers) => {
    const fn = vi.fn(async (input) => {
      const url = new URL(input, "http://local").searchParams.get("url");
      return answers(url);
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  it("merges the listings, the first source winning a model listed on both", async () => {
    const [a, b] = sources();
    stub((url) =>
      url === a.url
        ? reply({ data: [{ id: "deepseek-flash", name: "deepseek-flash", protocols: ["openai-chat-completions"] }] })
        : reply({
            data: [
              { id: "deepseek-flash", name: "deepseek-flash", protocols: ["anthropic-messages"] },
              { id: "claude-opus-5-5", name: "claude-opus-5-5", protocols: ["anthropic-messages"] },
            ],
          }),
    );

    const models = await fetchSuggestedModels([a, b]);

    expect(models.map((m) => m.id)).toEqual(["deepseek-flash", "claude-opus-5-5"]);
    expect(models[0].protocols).toEqual(["openai-chat-completions"]);
  });

  it("keeps the other source when one fails", async () => {
    const [a, b] = sources();
    stub((url) => (url === a.url ? reply({}, 503) : reply({ data: [{ id: "claude-opus-5-5", name: "x" }] })));

    expect((await fetchSuggestedModels([a, b])).map((m) => m.id)).toEqual(["claude-opus-5-5"]);
  });

  it("still accepts a single source", async () => {
    const [a] = sources();
    stub(() => reply({ data: [{ id: "kimi-k3", name: "kimi-k3" }] }));

    expect((await fetchSuggestedModels(a)).map((m) => m.id)).toEqual(["kimi-k3"]);
  });
});
