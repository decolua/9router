import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { rankModelsBySpeed, handleComboChat } from "../../open-sse/services/combo.js";
import { recordModelSpeed, getModelSpeed, getSpeedMode, resetModelSpeeds, SPEED_MODE } from "../../open-sse/services/modelSpeed.js";

const { STREAM, JSON: JSON_MODE } = SPEED_MODE;
const log = { info: vi.fn(), warn: vi.fn() };

// Record a streamed reply that ran at exactly `tps` tokens/s.
const setSpeed = (provider, model, tps, mode = STREAM) => recordModelSpeed(provider, model, mode, tps, { ttft: 0, total: 1000 });

const okResponse = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });

describe("model speed tracking", () => {
  beforeEach(() => {
    resetModelSpeeds();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures streamed replies from the first token (total - ttft)", () => {
    recordModelSpeed("openai", "gpt-a", STREAM, 100, { ttft: 500, total: 1500 });
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBe(100);
  });

  it("measures JSON replies over the total time", () => {
    recordModelSpeed("openai", "gpt-a", JSON_MODE, 100, { total: 2000 });
    expect(getModelSpeed("openai", "gpt-a", JSON_MODE)).toBe(50);
  });

  it("keeps streamed and JSON speeds apart", () => {
    // Same timing: 100 tokens, first token at 9s, done at 10s.
    recordModelSpeed("openai", "gpt-a", STREAM, 100, { ttft: 9000, total: 10000 });
    recordModelSpeed("openai", "gpt-a", JSON_MODE, 100, { total: 10000 });
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBe(100);
    expect(getModelSpeed("openai", "gpt-a", JSON_MODE)).toBe(10);
  });

  it("ignores replies that are too short", () => {
    recordModelSpeed("openai", "gpt-a", STREAM, 5, { ttft: 100, total: 1100 });
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBeNull();
  });

  it("skips a stream that arrived all at once instead of mixing in total time", () => {
    recordModelSpeed("openai", "gpt-a", STREAM, 100, { ttft: 1990, total: 2000 });
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBeNull();
  });

  it("skips a stream with no first-token time", () => {
    recordModelSpeed("openai", "gpt-a", STREAM, 100, { total: 2000 });
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBeNull();
  });

  it("keeps a rolling average instead of jumping to the newest sample", () => {
    setSpeed("openai", "gpt-a", 100);
    setSpeed("openai", "gpt-a", 200);
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBeCloseTo(130);
  });

  it("treats old speeds as unmeasured", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    setSpeed("openai", "gpt-a", 100);
    vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
    expect(getModelSpeed("openai", "gpt-a", STREAM)).toBeNull();
  });
});

describe("speed mode of a request", () => {
  it("follows body.stream when it is set", () => {
    expect(getSpeedMode({ stream: true }, { accept: "application/json" })).toBe(STREAM);
    expect(getSpeedMode({ stream: false })).toBe(JSON_MODE);
  });

  it("falls back to the Accept header, then to stream", () => {
    expect(getSpeedMode({}, { accept: "application/json" })).toBe(JSON_MODE);
    expect(getSpeedMode({}, { accept: "application/json, text/event-stream" })).toBe(STREAM);
    expect(getSpeedMode({})).toBe(STREAM);
  });
});

describe("fastest combo strategy", () => {
  beforeEach(() => {
    resetModelSpeeds();
    log.info.mockClear();
  });

  it("orders measured models fastest first", async () => {
    setSpeed("openai", "slow", 50);
    setSpeed("openai", "fast", 200);
    setSpeed("openai", "mid", 100);

    const ranked = await rankModelsBySpeed(["openai/slow", "openai/fast", "openai/mid"]);
    expect(ranked.map((r) => r.model)).toEqual(["openai/fast", "openai/mid", "openai/slow"]);
  });

  it("keeps the combo order when speeds are close", async () => {
    setSpeed("deepseek", "flash", 150);
    setSpeed("glm", "flash", 152);

    const ranked = await rankModelsBySpeed(["deepseek/flash", "glm/flash"]);
    expect(ranked.map((r) => r.model)).toEqual(["deepseek/flash", "glm/flash"]);
  });

  it("lets a clearly faster model jump ahead", async () => {
    setSpeed("deepseek", "flash", 150);
    setSpeed("gemini", "flash", 200);

    const ranked = await rankModelsBySpeed(["deepseek/flash", "gemini/flash"]);
    expect(ranked.map((r) => r.model)).toEqual(["gemini/flash", "deepseek/flash"]);
  });

  it("picks the highest-listed model within the margin of the fastest", async () => {
    setSpeed("deepseek", "flash", 150);
    setSpeed("glm", "flash", 165);
    setSpeed("gemini", "flash", 200);

    // glm (165) is within 20% of gemini (200) and listed higher, so it goes first.
    // Then deepseek (150) is not within 20% of gemini, so gemini is next.
    const ranked = await rankModelsBySpeed(["deepseek/flash", "glm/flash", "gemini/flash"]);
    expect(ranked.map((r) => r.model)).toEqual(["glm/flash", "gemini/flash", "deepseek/flash"]);
  });

  it("tries unmeasured models first and keeps unresolvable ones last", async () => {
    setSpeed("openai", "fast", 200);

    const ranked = await rankModelsBySpeed(["nested-combo", "openai/fast", "openai/new"]);
    expect(ranked.map((r) => r.model)).toEqual(["openai/new", "openai/fast", "nested-combo"]);
  });

  it("uses the given resolver to match combo strings to recorded provider/model", async () => {
    setSpeed("node-123", "llama", 200);
    setSpeed("openai", "gpt-a", 50);
    const resolveModel = async (m) => (m === "mynode/llama" ? { provider: "node-123", model: "llama" } : { provider: "openai", model: "gpt-a" });

    const ranked = await rankModelsBySpeed(["openai/gpt-a", "mynode/llama"], resolveModel);
    expect(ranked.map((r) => r.model)).toEqual(["mynode/llama", "openai/gpt-a"]);
  });

  it("ranks a request only on speeds of its own mode", async () => {
    setSpeed("openai", "a", 50, STREAM);
    setSpeed("openai", "b", 200, STREAM);
    setSpeed("openai", "a", 200, JSON_MODE);
    setSpeed("openai", "b", 50, JSON_MODE);
    const tried = [];
    const run = (stream) => handleComboChat({
      body: { stream, messages: [{ role: "user", content: "hi" }] },
      models: ["openai/a", "openai/b"],
      handleSingleModel: async (_body, modelStr) => { tried.push(modelStr); return okResponse(); },
      log,
      comboName: "speedy",
      comboStrategy: "fastest",
    });

    await run(true);
    await run(false);

    expect(tried).toEqual(["openai/b", "openai/a"]);
  });

  it("handleComboChat calls the fastest model first and still falls back", async () => {
    setSpeed("openai", "slow", 50);
    setSpeed("openai", "fast", 200);

    const tried = [];
    const handleSingleModel = async (_body, modelStr) => {
      tried.push(modelStr);
      if (modelStr === "openai/fast") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
      return okResponse();
    };

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/slow", "openai/fast"],
      handleSingleModel,
      log,
      comboName: "speedy",
      comboStrategy: "fastest",
    });

    expect(res.status).toBe(200);
    expect(tried).toEqual(["openai/fast", "openai/slow"]);
  });

  describe("test turn for unmeasured models", () => {
    const runCombo = (handleSingleModel, models = ["openai/new", "openai/fast"], resolveModel) => handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel,
      log,
      comboName: "speedy",
      comboStrategy: "fastest",
      resolveModel,
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("doesn't keep an unmeasured model in front when its replies are too short to measure", async () => {
      setSpeed("openai", "fast", 200);
      const tried = [];
      // Short replies: nothing is recorded, so "openai/new" stays unmeasured.
      const handleSingleModel = async (_body, modelStr) => { tried.push(modelStr); return okResponse(); };

      for (let i = 0; i < 3; i++) await runCombo(handleSingleModel);

      expect(tried).toEqual(["openai/new", "openai/fast", "openai/fast"]);
    });

    it("doesn't try a failing unmeasured model first on every request", async () => {
      setSpeed("openai", "fast", 200);
      const tried = [];
      const handleSingleModel = async (_body, modelStr) => {
        tried.push(modelStr);
        if (modelStr === "openai/new") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
        return okResponse();
      };

      await runCombo(handleSingleModel);
      await runCombo(handleSingleModel);

      expect(tried).toEqual(["openai/new", "openai/fast", "openai/fast"]);
    });

    it("gives the model another test turn after the stale window", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const tried = [];
      const handleSingleModel = async (_body, modelStr) => {
        tried.push(modelStr);
        if (modelStr === "openai/fast") setSpeed("openai", "fast", 200);
        return okResponse();
      };

      await runCombo(handleSingleModel); // test turn for "new" (short reply)
      await runCombo(handleSingleModel); // test turn for "fast", now measured
      await runCombo(handleSingleModel); // "fast" wins
      vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
      await runCombo(handleSingleModel); // both stale: "new" gets a turn again

      expect(tried).toEqual(["openai/new", "openai/fast", "openai/fast", "openai/new"]);
    });

    const split = (m) => { const [provider, model] = m.split("/"); return { provider, model }; };
    // Lookups that finish together (built-in providers, no DB read) and lookups that
    // take different times per model (getModelInfo reading custom providers from the DB).
    const resolvers = [
      ["instant lookups", async (m) => split(m)],
      ["uneven lookups", async (m) => { await new Promise((r) => setTimeout(r, m.includes("new") ? 1 : 10)); return split(m); }],
    ];

    it.each(resolvers)("gives only one of many parallel requests the test turn (%s)", async (_name, resolveModel) => {
      setSpeed("openai", "fast", 200);
      const tried = [];
      const handleSingleModel = async (_body, modelStr) => { tried.push(modelStr); return okResponse(); };

      await Promise.all(Array.from({ length: 5 }, () => runCombo(handleSingleModel, undefined, resolveModel)));

      expect(tried.filter((m) => m === "openai/new")).toHaveLength(1);
      expect(tried.filter((m) => m === "openai/fast")).toHaveLength(4);
    });

    it.each(resolvers)("lets parallel requests test different untested models (%s)", async (_name, resolveModel) => {
      setSpeed("openai", "fast", 200);
      const tried = [];
      const handleSingleModel = async (_body, modelStr) => { tried.push(modelStr); return okResponse(); };
      const models = ["openai/new-1", "openai/new-2", "openai/fast"];

      await Promise.all(Array.from({ length: 3 }, () => runCombo(handleSingleModel, models, resolveModel)));

      expect([...tried].sort()).toEqual(["openai/fast", "openai/new-1", "openai/new-2"]);
    });
  });
});
