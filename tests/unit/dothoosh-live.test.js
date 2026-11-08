import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelSupportedFormats, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import {
  buildDotHooshLive,
  clearDotHooshLive,
  getDotHooshLive,
  setDotHooshLive,
} from "../../open-sse/providers/models/dothooshLive.js";
import { refreshDotHooshLive, resetDotHooshSync } from "../../src/lib/modelCatalog/dothoosh.js";

// The real GET /v1/models and GET /anthropic/v1/models payloads of the public mirror
// (policy blocks removed), so the mapping runs against the live shape.
const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const liveOpenAI = read("dothoosh-live-openai.json");
const liveAnthropic = read("dothoosh-live-anthropic.json");

const OPENAI_URL = "https://www.dothoosh.com/gateway/v1/models";
const ANTHROPIC_URL = "https://www.dothoosh.com/gateway/anthropic/v1/models";

afterEach(() => {
  clearDotHooshLive();
  resetDotHooshSync();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the live catalog drives lanes, wire format and capabilities", () => {
  const live = () => buildDotHooshLive({ openai: liveOpenAI.data, anthropic: liveAnthropic.data });

  it("derives supported lanes from protocols[], not from the model name", () => {
    const table = live();
    expect(table["claude-haiku-5-5"]).toMatchObject({ supportedFormats: ["claude"], targetFormat: "claude" });
    expect(table["deepseek-flash"].supportedFormats).toEqual(["openai", "claude"]);
    expect(table["deepseek-flash"].targetFormat).toBeUndefined();
    expect(table["gpt-6-luna"]).toMatchObject({
      supportedFormats: ["openai", "openai-responses"],
      targetFormat: "openai-responses",
    });
    expect(table["kimi-k3"].supportedFormats).toEqual(["openai"]);
  });

  it("carries live limits and vision", () => {
    const table = live();
    expect(table["gpt-6-luna"]).toMatchObject({ contextWindow: 1050000, maxOutput: 128000, vision: false });
    expect(table["kimi-k3"]).toMatchObject({ contextWindow: 1048576, vision: false });
    expect(table["kimi-k3"].maxOutput).toBeUndefined();
  });

  it("serves lanes and wire format from the live table, thinking suffix included", () => {
    setDotHooshLive(live());
    expect(getModelSupportedFormats("dothoosh", "gpt-6-luna")).toEqual(["openai", "openai-responses"]);
    expect(getModelTargetFormat("dothoosh", "gpt-6-luna")).toBe("openai-responses");
    expect(getModelSupportedFormats("dh", "gpt-6-luna(high)")).toEqual(["openai", "openai-responses"]);
    expect(getModelTargetFormat("dothoosh", "claude-sonnet-5-5")).toBe("claude");
  });

  it("lets the live listing win over the name-based family", () => {
    setDotHooshLive(
      buildDotHooshLive({
        openai: [{ id: "claude-served-on-chat", protocols: [{ protocol: "openai-chat-completions" }] }],
        anthropic: [],
      }),
    );
    expect(getModelSupportedFormats("dothoosh", "claude-served-on-chat")).toEqual(["openai"]);
    expect(getModelTargetFormat("dothoosh", "claude-served-on-chat")).toBeFalsy();
  });

  it("falls back to the name-based family only for ids the listing does not know", () => {
    setDotHooshLive(live());
    expect(getModelSupportedFormats("dothoosh", "claude-future-9")).toEqual(["claude"]);
    expect(getModelSupportedFormats("dothoosh", "brand-new-model")).toEqual(["openai"]);
  });

  it("treats a row without protocols as OpenAI-only, or both lanes when the Anthropic listing has it too", () => {
    const table = buildDotHooshLive({
      openai: [{ id: "plain" }, { id: "both" }],
      anthropic: [{ id: "both" }, { id: "claude-only" }],
    });
    expect(table.plain.supportedFormats).toEqual(["openai"]);
    expect(table.both.supportedFormats).toEqual(["openai", "claude"]);
    expect(table["claude-only"].supportedFormats).toEqual(["claude"]);
  });

  it("applies live limits and vision over the static tables", () => {
    const before = getCapabilitiesForModel("dothoosh", "claude-opus-5-5");
    expect(before.vision).toBe(true);

    setDotHooshLive(live());
    const claude = getCapabilitiesForModel("dothoosh", "claude-opus-5-5");
    expect(claude).toMatchObject({ vision: false, contextWindow: 1000000, maxOutput: 128000 });
    expect(getCapabilitiesForModel("dh", "gpt-6-luna")).toMatchObject({
      contextWindow: 1050000,
      maxOutput: 128000,
      vision: false,
    });
  });

  it("never lets a static output cap exceed the live window", () => {
    setDotHooshLive(
      buildDotHooshLive({
        openai: [{ id: "claude-opus-5-5", context_length: 50000, architecture: { input_modalities: ["text"] } }],
        anthropic: [],
      }),
    );
    const caps = getCapabilitiesForModel("dothoosh", "claude-opus-5-5");
    expect(caps.contextWindow).toBe(50000);
    expect(caps.maxOutput).toBeLessThanOrEqual(50000);
  });

  it("ignores zero, negative and non-numeric live limits", () => {
    const before = getCapabilitiesForModel("dothoosh", "claude-opus-5-5");
    setDotHooshLive(
      buildDotHooshLive({
        openai: [
          {
            id: "claude-opus-5-5",
            context_length: "lots",
            top_provider: { context_length: -1, max_completion_tokens: 0 },
          },
        ],
        anthropic: [],
      }),
    );
    const after = getCapabilitiesForModel("dothoosh", "claude-opus-5-5");
    expect(after.contextWindow).toBe(before.contextWindow);
    expect(after.maxOutput).toBe(before.maxOutput);
  });

  it("does not touch other providers", () => {
    const before = getCapabilitiesForModel("claude", "claude-opus-5-5");
    setDotHooshLive(live());
    expect(getCapabilitiesForModel("claude", "claude-opus-5-5")).toEqual(before);
  });

  it("looks a model up without its thinking suffix or case", () => {
    setDotHooshLive(live());
    expect(getDotHooshLive("GPT-6-Luna(high)")).toMatchObject({ contextWindow: 1050000 });
    expect(getDotHooshLive("nope")).toBeNull();
  });
});

describe("refreshing the live catalog from the public mirror", () => {
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const gateway = (state) => {
    const fn = vi.fn(async (url) => (url === ANTHROPIC_URL ? state.anthropic() : state.openai()));
    return fn;
  };
  const good = () => ({ openai: () => json(liveOpenAI), anthropic: () => json(liveAnthropic) });

  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("reads both mirror listings without credentials and with a timeout", async () => {
    const fetchImpl = gateway(good());
    await refreshDotHooshLive(fetchImpl);

    expect(fetchImpl.mock.calls.map(([url]) => url).sort()).toEqual([ANTHROPIC_URL, OPENAI_URL].sort());
    for (const [, init] of fetchImpl.mock.calls) {
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization|x-api-key/i);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(getDotHooshLive("claude-haiku-5-5")).toMatchObject({ supportedFormats: ["claude"] });
    expect(getDotHooshLive("gpt-6-luna").targetFormat).toBe("openai-responses");
  });

  it.each([
    ["an HTTP error", () => json({}, 503)],
    ["an empty list", () => json({ data: [] })],
    ["an error envelope", () => json({ error: { message: "down" } })],
    ["a paginated listing", () => json({ ...liveOpenAI, has_more: true })],
    ["a non-JSON body", () => ({ ok: true, json: async () => { throw new Error("x"); } })],
  ])("keeps the previous OpenAI listing after %s and still applies the Anthropic one", async (_n, bad) => {
    await refreshDotHooshLive(gateway(good()));
    await refreshDotHooshLive(gateway({ ...good(), openai: bad }));

    expect(getDotHooshLive("gpt-6-luna")).toMatchObject({ contextWindow: 1050000 });
  });

  it("keeps the previous Anthropic listing when only that one fails", async () => {
    await refreshDotHooshLive(gateway(good()));
    await refreshDotHooshLive(gateway({ ...good(), anthropic: () => json({}, 503) }));

    expect(getDotHooshLive("claude-haiku-5-5")).toMatchObject({ supportedFormats: ["claude"] });
    expect(getDotHooshLive("gpt-6-luna")).not.toBeNull();
  });

  it("does not drop the OpenAI models when the first Anthropic listing fails", async () => {
    await refreshDotHooshLive(gateway({ ...good(), anthropic: () => json({}, 503) }));

    expect(getDotHooshLive("gpt-6-luna")).not.toBeNull();
    expect(getDotHooshLive("claude-haiku-5-5")).toBeNull();
  });

  it("replaces the table with a valid, shrunk listing", async () => {
    await refreshDotHooshLive(gateway(good()));
    await refreshDotHooshLive(gateway({ ...good(), openai: () => json({ data: [{ id: "only-model" }] }) }));

    expect(getDotHooshLive("only-model")).not.toBeNull();
    expect(getDotHooshLive("gpt-6-luna")).toBeNull();
  });
});
