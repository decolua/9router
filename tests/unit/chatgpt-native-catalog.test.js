import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fetchNativeCatalog, nativeCatalog, mergeCatalog } from "../../public/9router-codex.mjs";

const oldModel = { slug: "gpt-5.6-sol", visibility: "list", priority: 0 };
const newModel = { slug: "gpt-6.1-sol", display_name: "GPT-6.1-Sol", visibility: "list", supported_reasoning_levels: [{ effort: "high" }] };
const auth = { auth_mode: "chatgpt", tokens: { access_token: "native-secret", account_id: "native-account" } };
const cached = { client_version: "0.154.0", models: [oldModel] };
const run = vi.fn(async () => ({ stdout: "codex-cli 0.155.0-alpha.16\n" }));
const read = async filename => structuredClone(filename.endsWith("auth.json") ? auth : cached);

describe("native Codex catalog refresh", () => {
  it("discovers newly released models despite a populated, stale cache", async () => {
    const fetchCatalog = vi.fn(async () => ({ models: [newModel, oldModel] }));
    const models = await nativeCatalog("/codex", { read, run, fetchCatalog, proxyEnv: { HTTPS_PROXY: "http://proxy.test:3128" } });
    expect(models).toEqual([newModel, oldModel]);
    expect(fetchCatalog).toHaveBeenCalledWith(auth, "0.155.0-alpha.16", { proxyEnv: { HTTPS_PROXY: "http://proxy.test:3128" } });
    expect(run).toHaveBeenCalledWith("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", ["--version"], expect.any(Object));
    expect(run).not.toHaveBeenCalledWith("codex", expect.anything(), expect.anything());
    const merged = mergeCatalog(models, { version: 1, models: [{ id: "external", slug: "9router/external" }] });
    expect(merged.models.find(m => m.slug === newModel.slug)).toEqual(newModel);
    expect(JSON.stringify(merged)).not.toContain("native-secret");
  });

  it("treats the account catalog as authoritative and cannot shadow router entries", async () => {
    const models = await nativeCatalog("/codex", { read, run, fetchCatalog: async () => ({ models: [newModel, { slug: "9router/injected", visibility: "list" }] }) });
    expect(models).toEqual([newModel]);
  });

  it.each(["expired", "offline", "empty", "malformed"])("retains the existing catalog on %s refresh and warns without exposing credentials", async mode => {
    const warn = vi.fn();
    const models = await nativeCatalog("/codex", { read, run, warn, fetchCatalog: async () => {
      if (mode === "empty") return { models: [] };
      if (mode === "malformed") return { models: "invalid" };
      throw new Error(`failure ${auth.tokens.access_token}`);
    } });
    expect(models).toEqual([oldModel]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().join()).not.toContain(auth.tokens.access_token);
  });

  it("uses the local cache without sending credentials for a missing or unreadable login", async () => {
    const fetchCatalog = vi.fn();
    const models = await nativeCatalog("/codex", { run, fetchCatalog, read: async filename => {
      if (filename.endsWith("auth.json")) throw new Error("unreadable");
      return cached;
    } });
    expect(models).toEqual([oldModel]);
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it("keeps the newer merged native catalog when OpenAI is offline instead of reverting to models_cache.json", async () => {
    const models = await nativeCatalog("/codex", { run, warn: vi.fn(), fetchCatalog: async () => { throw new Error("offline"); }, read: async filename => {
      if (filename.endsWith("auth.json")) return auth;
      if (filename.endsWith("/9router-chatgpt/catalog.json")) return { models: [newModel, { slug: "9router/external", visibility: "list" }] };
      return cached;
    } });
    expect(models).toEqual([newModel]);
  });

  it("still discovers the desktop CLI in an older app layout before the PATH CLI", async () => {
    const legacyRun = vi.fn(async executable => {
      if (executable.endsWith("/codex-cli/bin/codex")) throw new Error("ENOENT");
      if (executable === "codex") return { stdout: "codex-cli 0.144.1\n" };
      return { stdout: "codex-cli 0.159.2\n" };
    });
    const fetchCatalog = vi.fn(async () => ({ models: [newModel] }));
    await nativeCatalog("/codex", { read, run: legacyRun, fetchCatalog });
    expect(fetchCatalog).toHaveBeenCalledWith(auth, "0.159.2", { proxyEnv: {} });
    expect(legacyRun).not.toHaveBeenCalledWith("codex", expect.anything(), expect.anything());
  });

  it("supports the bundled catalog in the current ChatGPT desktop installation", async () => {
    const bundledRun = vi.fn(async () => ({ stdout: JSON.stringify({ models: [newModel] }) }));
    expect(await nativeCatalog("/codex", { read: async () => null, run: bundledRun })).toEqual([newModel]);
    expect(bundledRun).toHaveBeenCalledWith("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", ["debug", "models", "--bundled"], expect.any(Object));
  });
});

describe("native catalog credentials boundary", () => {
  function transport(status, body) {
    return vi.fn((_url, _options, callback) => {
      const request = new EventEmitter();
      queueMicrotask(() => {
        const response = Readable.from([Buffer.from(JSON.stringify(body))]);
        response.statusCode = status;
        callback(response);
      });
      return request;
    });
  }

  it("sends the native token only to the fixed OpenAI catalog endpoint", async () => {
    const get = transport(200, { models: [newModel] });
    expect(await fetchNativeCatalog(auth, "0.155.0-alpha.16", { get })).toEqual({ models: [newModel] });
    const [url, options] = get.mock.calls[0];
    expect(url.href).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.155.0-alpha.16");
    expect(options.headers.authorization).toBe("Bearer native-secret");
    expect(options.headers["chatgpt-account-id"]).toBe("native-account");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not follow a redirect or include an upstream error body in diagnostics", async () => {
    const get = transport(302, { error: auth.tokens.access_token, location: "https://untrusted.test" });
    await expect(fetchNativeCatalog(auth, "0.155.0", { get })).rejects.toThrow("Native catalog refresh failed.");
    expect(get).toHaveBeenCalledOnce();
  });
});
