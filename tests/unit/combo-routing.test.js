import { describe, it, expect, beforeEach } from "vitest";

import { getRotatedModels, resetComboRotation, handleComboChat, resetComboStickySessions, deriveComboSessionKey, requestHasTools } from "../../open-sse/services/combo.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
    resetComboStickySessions();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });

  it("keeps tool requests in priority order even for round-robin combos", async () => {
    const models = ["provider/model-a", "provider/model-b"];
    const tried = [];

    const result = await handleComboChat({
      body: { tools: [{ type: "function", function: { name: "read" } }] },
      models,
      comboName: "code-xhigh",
      comboStrategy: "round-robin",
      comboStickyLimit: 1,
      log: { info() {}, warn() {} },
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return new Response("ok", { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(tried).toEqual(["provider/model-a"]);

    const secondTried = [];
    await handleComboChat({
      body: { tools: [{ type: "function", function: { name: "read" } }] },
      models,
      comboName: "code-xhigh",
      comboStrategy: "round-robin",
      comboStickyLimit: 1,
      log: { info() {}, warn() {} },
      handleSingleModel: async (_body, model) => {
        secondTried.push(model);
        return new Response("ok", { status: 200 });
      },
    });

    expect(secondTried).toEqual(["provider/model-a"]);
  });

  it("falls back through tool requests with the same request body", async () => {
    const body = { tools: [{ type: "function", function: { name: "read" } }], messages: [{ role: "user", content: "hi" }] };
    const bodies = [];
    const tried = [];

    const result = await handleComboChat({
      body,
      models: ["provider/dead", "provider/live"],
      comboName: "code-xhigh",
      comboStrategy: "round-robin",
      log: { info() {}, warn() {} },
      handleSingleModel: async (passedBody, model) => {
        bodies.push(passedBody);
        tried.push(model);
        return model.endsWith("dead")
          ? new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "content-type": "application/json" } })
          : new Response("ok", { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(tried).toEqual(["provider/dead", "provider/live"]);
    expect(bodies).toEqual([body, body]);
  });
});

describe("combo sticky-provider for tool sessions", () => {
  beforeEach(() => {
    resetComboRotation();
    resetComboStickySessions();
  });

  const toolBody = (extra = {}) => ({
    tools: [{ type: "function", function: { name: "read" } }],
    messages: [
      { role: "system", content: "You are a coding agent" },
      { role: "user", content: "fix the bug in foo.js" },
    ],
    ...extra,
  });

  it("sticks subsequent tool turns to the model that last succeeded", async () => {
    const models = ["provider/model-a", "provider/model-b"];

    // First turn: model-a is down, model-b succeeds → model-b becomes sticky.
    const firstTried = [];
    await handleComboChat({
      body: toolBody(),
      models,
      comboName: "code-xhigh",
      comboStrategy: "fallback",
      log: { info() {}, warn() {} },
      handleSingleModel: async (_b, model) => {
        firstTried.push(model);
        return model.endsWith("model-a")
          ? new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "content-type": "application/json" } })
          : new Response("ok", { status: 200 });
      },
    });
    expect(firstTried).toEqual(["provider/model-a", "provider/model-b"]);

    // Second turn of the SAME session: model-b should be tried first now.
    const secondTried = [];
    await handleComboChat({
      body: toolBody({ messages: [
        { role: "system", content: "You are a coding agent" },
        { role: "user", content: "fix the bug in foo.js" },
        { role: "assistant", content: "done" },
        { role: "user", content: "now add a test" },
      ] }),
      models,
      comboName: "code-xhigh",
      comboStrategy: "fallback",
      log: { info() {}, warn() {} },
      handleSingleModel: async (_b, model) => {
        secondTried.push(model);
        return new Response("ok", { status: 200 });
      },
    });
    expect(secondTried).toEqual(["provider/model-b"]);
  });

  it("falls back from the sticky model when it becomes unavailable", async () => {
    const models = ["provider/model-a", "provider/model-b"];

    // Establish model-a as sticky.
    await handleComboChat({
      body: toolBody(),
      models,
      comboName: "code-xhigh",
      comboStrategy: "fallback",
      log: { info() {}, warn() {} },
      handleSingleModel: async () => new Response("ok", { status: 200 }),
    });

    // Next turn: model-a now fails, should fall through to model-b and re-stick.
    const tried = [];
    await handleComboChat({
      body: toolBody({ messages: [
        { role: "system", content: "You are a coding agent" },
        { role: "user", content: "fix the bug in foo.js" },
        { role: "user", content: "continue" },
      ] }),
      models,
      comboName: "code-xhigh",
      comboStrategy: "fallback",
      log: { info() {}, warn() {} },
      handleSingleModel: async (_b, model) => {
        tried.push(model);
        return model.endsWith("model-a")
          ? new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "content-type": "application/json" } })
          : new Response("ok", { status: 200 });
      },
    });
    expect(tried).toEqual(["provider/model-a", "provider/model-b"]);
  });

  it("keeps separate sticky state per combo and per session", async () => {
    const models = ["provider/model-a", "provider/model-b"];

    const keyA = deriveComboSessionKey(toolBody(), "code-xhigh");
    const keyB = deriveComboSessionKey(toolBody({ messages: [
      { role: "system", content: "different agent" },
      { role: "user", content: "another task" },
    ] }), "code-xhigh");
    const keyC = deriveComboSessionKey(toolBody(), "code-high");

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    expect(keyA).toBe(deriveComboSessionKey(toolBody(), "code-xhigh"));
  });

  it("does not apply sticky routing to non-tool requests", () => {
    expect(requestHasTools({ messages: [] })).toBe(false);
    expect(requestHasTools({ tools: [] })).toBe(false);
    expect(requestHasTools({ tools: [{ type: "function" }] })).toBe(true);
  });

  it("returns null session key when there is no stable anchor text", () => {
    expect(deriveComboSessionKey({ tools: [] }, "code-xhigh")).toBeNull();
    expect(deriveComboSessionKey({ messages: [] }, "code-xhigh")).toBeNull();
  });
});
