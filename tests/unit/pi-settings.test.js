import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() }));
const db = vi.hoisted(() => ({ getCombos: vi.fn(), getComboByName: vi.fn(), getModelAliases: vi.fn(), getProviderNodes: vi.fn() }));
vi.mock("fs/promises", () => ({ default: io }));
vi.mock("os", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: () => "/test-pi" } };
});
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("@/lib/localDb", () => db);

import { POST } from "@/app/api/cli-tools/pi-settings/route.js";
import { getCapabilitiesForModel, aggregateComboCapabilities } from "open-sse/providers/capabilities.js";

const save = (body) => POST(new Request("http://localhost/api/cli-tools/pi-settings", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseUrl: "http://localhost:20128", ...body }),
}));
const written = () => JSON.parse(io.writeFile.mock.calls[0][1]);
const models = () => written().providers["9router"].models;

beforeEach(() => {
  vi.clearAllMocks();
  io.access.mockResolvedValue(undefined);
  io.readFile.mockResolvedValue("{}");
  io.writeFile.mockResolvedValue(undefined);
  io.mkdir.mockResolvedValue(undefined);
  db.getCombos.mockResolvedValue([]);
  db.getComboByName.mockResolvedValue(null);
  db.getModelAliases.mockResolvedValue({});
  db.getProviderNodes.mockResolvedValue([]);
});

describe("Pi settings POST", () => {
  it("preserves selected model overrides and provider metadata on an ID-only dashboard save", async () => {
    const model = { id: "ag/gemini-3.8-flash", name: "My model", contextWindow: 524288, maxTokens: 32768,
      input: ["text", "image"], reasoning: true, cost: { input: 1, output: 2 }, compat: { supportsStore: false } };
    const config = { extra: true, providers: { other: { baseUrl: "http://other" }, "9router": {
      baseUrl: "http://old/v1", apiKey: "placeholder", api: "openai-completions", authHeader: true,
      headers: { "X-Custom": "test" }, models: [model],
    } } };
    io.readFile.mockResolvedValue(JSON.stringify(config));
    expect((await save({ models: [model.id] })).status).toBe(200);
    expect(models()).toEqual([model]);
    expect(written()).toMatchObject({ extra: true, providers: { other: config.providers.other,
      "9router": { baseUrl: "http://localhost:20128/v1", authHeader: true, headers: { "X-Custom": "test" } } } });
  });

  it("uses registered limits for newly selected provider/model IDs", async () => {
    const caps = getCapabilitiesForModel("antigravity", "gemini-3.8-flash");
    expect((await save({ models: ["ag/gemini-3.8-flash"] })).status).toBe(200);
    expect(models()[0]).toMatchObject({ contextWindow: caps.contextWindow, maxTokens: caps.maxOutput });
  });

  it("uses combo aggregation including nested combos", async () => {
    const lookup = { inner: ["cx/gpt-5.6-sol"], coding: ["inner", "ag/gemini-3.8-flash"] };
    db.getCombos.mockResolvedValue(Object.entries(lookup).map(([name, models]) => ({ name, models })));
    db.getComboByName.mockImplementation(async name => lookup[name] ? { name, models: lookup[name] } : null);
    const caps = aggregateComboCapabilities(lookup.coding, lookup);
    expect((await save({ models: ["coding"] })).status).toBe(200);
    expect(models()[0]).toMatchObject({ contextWindow: caps.contextWindow, maxTokens: caps.maxOutput });
  });

  it("resolves a configured model alias before looking up limits", async () => {
    db.getModelAliases.mockResolvedValue({ fast: "ag/gemini-3.8-flash" });
    const caps = getCapabilitiesForModel("antigravity", "gemini-3.8-flash");
    expect((await save({ models: ["fast"] })).status).toBe(200);
    expect(models()[0]).toMatchObject({ id: "fast", contextWindow: caps.contextWindow, maxTokens: caps.maxOutput });
  });

  it("honors explicit limit changes while retaining unspecified model metadata", async () => {
    io.readFile.mockResolvedValue(JSON.stringify({ providers: { "9router": { models: [
      { id: "custom/model", name: "Custom", contextWindow: 300000, maxTokens: 30000, reasoning: true },
    ] } } }));
    expect((await save({ models: [{ id: "custom/model", contextWindow: 400000 }] })).status).toBe(200);
    expect(models()[0]).toMatchObject({ name: "Custom", contextWindow: 400000, maxTokens: 30000, reasoning: true });
  });

  it("keeps dashboard deselection and selected order authoritative", async () => {
    io.readFile.mockResolvedValue(JSON.stringify({ providers: { "9router": { models: [
      { id: "custom/removed" }, { id: "custom/keep", contextWindow: 500000, maxTokens: 40000 },
    ] } } }));
    expect((await save({ models: ["ag/gemini-3.8-flash", "custom/keep"] })).status).toBe(200);
    expect(models().map(m => m.id)).toEqual(["ag/gemini-3.8-flash", "custom/keep"]);
  });

  it("keeps explicit metadata for the legacy single-model request", async () => {
    io.readFile.mockResolvedValue(JSON.stringify({ providers: { "9router": { models: [
      { id: "custom/keep", contextWindow: 500000, maxTokens: 40000 },
    ] } } }));
    expect((await save({ model: "custom/keep" })).status).toBe(200);
    expect(models()[0]).toMatchObject({ contextWindow: 500000, maxTokens: 40000 });
  });

  it("creates config when models.json does not exist", async () => {
    io.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect((await save({ models: ["ag/gemini-3.8-flash"] })).status).toBe(200);
    expect(io.writeFile).toHaveBeenCalledTimes(1);
  });

  it.each(["malformed", "unreadable"])("does not overwrite an existing %s config", async kind => {
    if (kind === "malformed") io.readFile.mockResolvedValue("{broken");
    else io.readFile.mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    expect((await save({ models: ["ag/gemini-3.8-flash"] })).status).toBe(500);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
});
