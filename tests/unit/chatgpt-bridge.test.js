import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { once } from "node:events";
import {
  activateIntegration, deactivateIntegration, createBridge, enableConfig, disableConfig, mergeCatalog,
  rootSettings, validateRouterUrl, validateManifest, resolveApiKey, stopService,
} from "../../public/9router-codex.mjs";

const native = [{ slug: "native-codex", visibility: "list", priority: 0, base_instructions: "Native instructions", service_tiers: [{ id: "priority" }] }];
const manifest = { version: 1, models: [{ id: "Coding", slug: "9router/Coding", contextWindow: 128000, imageInput: true }] };
const endpoint = "http://127.0.0.1:20129/token/v1";

describe("Codex config restoration", () => {
  const original = '# User settings\nmodel = "native-codex"\nmodel_reasoning_effort = "high"\ninstructions = """\n[not.a.table]\nopenai_base_url = "example inside text"\n"""\n[features]\nfoo = true\n';
  it("preserves multiline TOML and unrelated edits through enable/disable", () => {
    const result = enableConfig(original, endpoint, "/tmp/catalog.json", native);
    expect(rootSettings(result.text).openai_base_url.raw).toContain(endpoint);
    const updated = result.text.replace("foo = true", "foo = false").replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "low"');
    const restored = disableConfig(updated, { ...result, active: true });
    expect(restored).toBe(original.replace("foo = true", "foo = false").replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "low"'));
  });
  it("restores an existing provider and its selected model after repeated enable", () => {
    const input = 'model_provider = "custom"\nopenai_base_url = "http://old/v1"\nmodel_catalog_json = "/old.json"\nmodel = "glm/glm-5.3"\n[model_providers.custom]\nbase_url = "http://old"\n';
    const first = enableConfig(input, endpoint, "/tmp/catalog.json", native);
    const second = enableConfig(first.text, endpoint, "/tmp/catalog.json", native, { ...first, active: true });
    expect(second.text).toBe(first.text);
    const restored = rootSettings(disableConfig(second.text, second));
    for (const [key, value] of Object.entries(rootSettings(input))) expect(restored[key].raw).toBe(value.raw);
  });
  it("keeps the native model chosen after enable and recovers from a router model on disable", () => {
    const result = enableConfig(original, endpoint, "/tmp/catalog.json", native);
    const otherNative = result.text.replace('model = "native-codex"', 'model = "native-other"');
    expect(disableConfig(otherNative, result)).toContain('model = "native-other"');
    const routed = result.text.replace('model = "native-codex"', 'model = "9router/Coding"');
    expect(disableConfig(routed, result)).toContain('model = "native-codex"');
  });
  it("refuses to overwrite a route changed by another app", () => {
    const result = enableConfig(original, endpoint, "/tmp/catalog.json", native);
    const changed = result.text.replace(endpoint, "http://127.0.0.1:11434/api/codex/v1");
    expect(() => disableConfig(changed, result)).toThrow("changed by another app");
    expect(() => enableConfig(changed, endpoint, "/tmp/catalog.json", native, { ...result, active: true })).toThrow("changed by another app");
  });
  it("handles comments, quoted keys, arrays and strings containing hashes", () => {
    const input = '"model_provider" = \'custom\' # previous provider\nmodel = "native-codex"\narray = [\n"[hello]", "#hash"\n]\n[table]\nmodel_provider = "keep"\n';
    const enabled = enableConfig(input, endpoint, "/tmp/hash#catalog.json", native);
    expect(disableConfig(enabled.text, enabled)).toContain(input);
  });
});

describe("catalog and endpoint validation", () => {
  it("exposes supported reasoning and default without changing native metadata", () => {
    const routed = { ...manifest.models[0], reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "high" };
    const combined = mergeCatalog(native, { ...manifest, models: [routed] });
    expect(combined.models[0].supported_reasoning_levels.map(level => level.effort)).toEqual(["low", "high", "max"]);
    expect(combined.models[0].default_reasoning_level).toBe("high");
    expect(combined.models[1]).toEqual(native[0]);
    expect(mergeCatalog(native, manifest).models[0].supported_reasoning_levels).toEqual([]);
  });
  it.each([
    { reasoningLevels: ["thinking"] }, { reasoningLevels: ["high", "high"] },
    { reasoningLevels: "high" }, { reasoningLevels: ["low"], defaultReasoningLevel: "high" },
  ])("rejects malformed reasoning metadata %j", metadata => {
    expect(() => validateManifest({ ...manifest, models: [{ ...manifest.models[0], ...metadata }] })).toThrow();
  });
  it("keeps native model metadata byte-for-byte and namespaces added models", () => {
    const combined = mergeCatalog(native, manifest);
    expect(combined.models[1]).toEqual(native[0]);
    expect(combined.models[0]).toMatchObject({ slug: "9router/Coding", context_window: 128000, input_modalities: ["text", "image"], service_tiers: [], model_messages: null });
    expect(mergeCatalog(combined.models, manifest).models).toEqual(combined.models);
  });
  it.each(["http://example.com/api/chatgpt/v1", "https://user:password@example.com/api/chatgpt/v1", "https://example.com/v1", "https://example.com/api/chatgpt/v1?key=secret"])('rejects unsafe or wrong endpoint %s', url => {
    expect(() => validateRouterUrl(url)).toThrow();
  });
  it("validates manifest namespaces and duplicate models", () => {
    expect(validateManifest(manifest)).toBe(manifest);
    expect(() => validateManifest({ ...manifest, models: [{ ...manifest.models[0], slug: "native-codex" }] })).toThrow();
    expect(() => validateManifest({ ...manifest, models: [manifest.models[0], manifest.models[0]] })).toThrow();
  });
});

describe("API key selection", () => {
  const routerUrl = "https://router.example/api/chatgpt/v1";
  const previous = { routerUrl, apiKey: "saved-key" };
  it("reports an environment key without prompting", async () => {
    const prompt = vi.fn();
    expect(await resolveApiKey(previous, routerUrl, { env: { ROUTER9_API_KEY: " env-key " }, prompt })).toEqual({ apiKey: "env-key", source: "ROUTER9_API_KEY" });
    expect(prompt).not.toHaveBeenCalled();
  });
  it("reuses a saved key only for the same endpoint", async () => {
    const prompt = vi.fn(async () => "entered-key");
    expect(await resolveApiKey(previous, routerUrl, { env: {}, prompt })).toEqual({ apiKey: "saved-key", source: "saved helper settings" });
    expect(prompt).not.toHaveBeenCalled();
    expect((await resolveApiKey(previous, "https://other.example/api/chatgpt/v1", { env: {}, prompt })).apiKey).toBe("entered-key");
  });
  it("allows explicit key entry to override both saved and environment keys", async () => {
    const prompt = vi.fn(async () => "entered-key");
    expect(await resolveApiKey(previous, routerUrl, { env: { ROUTER9_API_KEY: "env-key" }, ask: true, prompt })).toEqual({ apiKey: "entered-key", source: "terminal prompt" });
    expect(prompt).toHaveBeenCalledOnce();
  });
});

describe("bridge on real HTTP sockets", () => {
  const servers = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }))); });
  async function listen(server) { servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; }
  async function setup(upstreamHandler) {
    const captured = [];
    const upstream = await listen(http.createServer(upstreamHandler));
    const bridge = createBridge({ token: "local-token", routerUrl: `${upstream}/api/chatgpt/v1`, apiKey: "router-key" }, {
      getManifest: async () => manifest,
      requestUpstream: (url, init, callback) => {
        captured.push({ url: url.href, ...init });
        return http.request(`${upstream}${url.pathname}`, init, callback);
      },
    });
    const origin = await listen(bridge);
    return { origin, url: `${origin}/local-token/v1`, captured };
  }
  const nativeHeaders = { authorization: "Bearer native-secret", "chatgpt-account-id": "native-account", cookie: "private-cookie", "x-codex-session-id": "session", "content-type": "application/json" };
  it("preserves native auxiliary endpoints, compressed bodies and credentials independently of router models", async () => {
    let received;
    const payload = zlib.gzipSync('{"query":"test"}');
    const { url, captured } = await setup(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      received = Buffer.concat(chunks);
      res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
    });
    const response = await fetch(`${url}/tools/search?client_version=0.154`, { method: "POST", headers: { ...nativeHeaders, "content-encoding": "gzip" }, body: payload });
    expect(response.status).toBe(200);
    expect(received).toEqual(payload);
    expect(captured[0].url).toBe("https://chatgpt.com/backend-api/codex/tools/search?client_version=0.154");
    expect(captured[0].headers.authorization).toBe("Bearer native-secret");
    expect(captured[0].headers["chatgpt-account-id"]).toBe("native-account");
    expect(captured[0].headers.cookie).toBeUndefined();
    expect((await fetch(`${url}/tools/search`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(captured).toHaveLength(1);
  });
  it.each(["identity", "gzip", ...(zlib.zstdCompressSync ? ["zstd"] : [])])("routes %s native and external bodies with distinct credentials", async encoding => {
    const bodies = [];
    const { url, captured } = await setup(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      bodies.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: response.output_text.delta\ndata: {"delta":"hello"}\n\n');
      res.end('event: response.completed\ndata: {"response":{"status":"completed"}}\n\n');
    });
    const encode = value => encoding === "gzip" ? zlib.gzipSync(value) : encoding === "zstd" ? zlib.zstdCompressSync(value) : value;
    const originalBody = Buffer.from(JSON.stringify({ model: "native-codex", input: [], stream: true }));
    const nativeResponse = await fetch(`${url}/responses`, { method: "POST", headers: { ...nativeHeaders, "content-encoding": encoding }, body: encode(originalBody) });
    expect(await nativeResponse.text()).toContain("response.completed");
    expect(captured[0].url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(captured[0].headers.authorization).toBe("Bearer native-secret");
    expect(captured[0].headers["chatgpt-account-id"]).toBe("native-account");
    expect(bodies[0]).toEqual(encode(originalBody));
    const routedBody = Buffer.from(JSON.stringify({ model: "9router/Coding", input: [], stream: true }));
    const response = await fetch(`${url}/responses?key=must-not-leak`, { method: "POST", headers: { ...nativeHeaders, "content-encoding": encoding }, body: encode(routedBody) });
    expect(await response.text()).toContain('"delta":"hello"');
    expect(captured[1].headers.authorization).toBe("Bearer router-key");
    expect(captured[1].headers).not.toHaveProperty("chatgpt-account-id");
    expect(captured[1].headers).not.toHaveProperty("cookie");
    expect(captured[1].headers).not.toHaveProperty("content-encoding");
    expect(captured[1].url).not.toContain("key=");
    expect(bodies[1]).toEqual(routedBody);
  });
  it("native requests continue when the router catalog is unavailable; OpenAI API key route remains supported", async () => {
    const captured = [];
    const upstream = await listen(http.createServer((_req, res) => res.end("ok")));
    const bridge = createBridge({ token: "token", routerUrl: `${upstream}/api/chatgpt/v1`, apiKey: "router-key" }, {
      getManifest: async () => { throw new Error("router offline"); },
      requestUpstream: (url, init, cb) => { captured.push(url.href); return http.request(upstream, init, cb); },
    });
    const origin = await listen(bridge);
    const response = await fetch(`${origin}/token/v1/responses/compact`, { method: "POST", headers: { authorization: "Bearer api-key" }, body: '{"model":"native-codex"}' });
    expect(await response.text()).toBe("ok");
    expect(captured).toEqual(["https://api.openai.com/v1/responses/compact"]);
  });
  it("rejects unknown models, browser origins and missing local capability without contacting upstream", async () => {
    const { url, origin, captured } = await setup((_req, res) => res.end("unexpected"));
    const init = { method: "POST", headers: nativeHeaders, body: '{"model":"9router/disabled"}' };
    expect((await fetch(`${url}/responses`, init)).status).toBe(404);
    expect((await fetch(`${url}/responses`, { ...init, headers: { ...nativeHeaders, origin: "https://attacker.example" } })).status).toBe(403);
    expect((await fetch(`${origin}/wrong/v1/responses`, init)).status).toBe(404);
    expect(captured).toHaveLength(0);
  });
  it("cancels the upstream SSE socket when Codex disconnects", async () => {
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    const { url } = await setup((_req, res) => {
      res.on("close", resolveClosed);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
    });
    const controller = new AbortController();
    const response = await fetch(`${url}/responses`, { method: "POST", headers: nativeHeaders, body: '{"model":"native-codex"}', signal: controller.signal });
    const reader = response.body.getReader();
    expect((await reader.read()).value.length).toBeGreaterThan(0);
    controller.abort();
    await closed;
  });
  it("uses the saved HTTP proxy for router requests", async () => {
    let target;
    const proxy = await listen(http.createServer((req, res) => {
      target = req.url;
      expect(req.headers.authorization).toBe("Bearer router-key");
      res.end("proxy-ok");
    }));
    const bridge = createBridge({ token: "token", routerUrl: "http://127.0.0.1:1/api/chatgpt/v1", apiKey: "router-key", proxyEnv: { HTTP_PROXY: proxy } }, { getManifest: async () => manifest });
    const origin = await listen(bridge);
    const response = await fetch(`${origin}/token/v1/responses`, { method: "POST", headers: nativeHeaders, body: '{"model":"9router/Coding"}' });
    expect(await response.text()).toBe("proxy-ok");
    expect(target).toBe("http://127.0.0.1:1/api/chatgpt/v1/responses");
  });
  it("uses HTTPS CONNECT for native requests without exposing OAuth in proxy headers", async () => {
    let target;
    const proxyServer = http.createServer();
    proxyServer.on("connect", (req, socket) => {
      target = req.url;
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers["chatgpt-account-id"]).toBeUndefined();
      socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    });
    const proxy = await listen(proxyServer);
    const bridge = createBridge({ token: "token", proxyEnv: { HTTPS_PROXY: proxy } });
    const origin = await listen(bridge);
    const response = await fetch(`${origin}/token/v1/responses`, { method: "POST", headers: nativeHeaders, body: '{"model":"native-codex"}' });
    expect(response.status).toBe(502);
    expect(target).toBe("chatgpt.com:443");
  });
});

describe("installation rollback", () => {
  let directory;
  afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });
  it("restores old artifacts and running service when reinstallation fails", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "9router-install-test-"));
    const configPath = path.join(directory, "config.toml");
    const statePath = path.join(directory, "state.json");
    const catalogPath = path.join(directory, "catalog.json");
    await fs.writeFile(configPath, "original config");
    await fs.writeFile(statePath, "old state");
    await fs.writeFile(catalogPath, "old catalog");
    const previous = { active: true, id: "old" };
    const next = { id: "new" };
    const start = vi.fn(async state => { if (state.id === "new") throw new Error("launch failed"); });
    const stop = vi.fn();
    await expect(activateIntegration(next, previous, configPath, "original config", "new config", [[statePath, "new state"], [catalogPath, "new catalog"]], { start, stop })).rejects.toThrow("launch failed");
    expect(await fs.readFile(configPath, "utf8")).toBe("original config");
    expect(await fs.readFile(statePath, "utf8")).toBe("old state");
    expect(await fs.readFile(catalogPath, "utf8")).toBe("old catalog");
    expect(start.mock.calls.map(([value]) => value.id)).toEqual(["new", "old"]);
  });
  it("preserves a concurrent Codex config edit during setup", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "9router-install-test-"));
    const configPath = path.join(directory, "config.toml");
    const statePath = path.join(directory, "state.json");
    await fs.writeFile(configPath, "original config");
    await expect(activateIntegration({ plist: path.join(directory, "test.plist") }, null, configPath, "original config", "new config", [[statePath, "new state"]], {
      start: async () => fs.writeFile(configPath, "edited by Codex"), stop: vi.fn(), ready: async () => true,
    })).rejects.toThrow("changed during setup");
    expect(await fs.readFile(configPath, "utf8")).toBe("edited by Codex");
    await expect(fs.stat(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps disabling retryable if launchctl cannot stop the agent", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "9router-install-test-"));
    const configPath = path.join(directory, "config.toml");
    const statePath = path.join(directory, "state.json");
    const installed = enableConfig('model = "native-codex"\n', endpoint, "/tmp/catalog.json", native);
    await fs.writeFile(configPath, installed.text);
    await fs.writeFile(statePath, "old state");
    await expect(deactivateIntegration(installed, configPath, statePath, {
      stop: async () => { throw new Error("stop denied"); }, start: vi.fn(),
    })).rejects.toThrow("stop denied");
    expect(await fs.readFile(configPath, "utf8")).toBe(installed.text);
    expect(await fs.readFile(statePath, "utf8")).toBe("old state");
  });
});

describe("launch agent shutdown", () => {
  it("waits for asynchronous launchd removal before allowing a restart", async () => {
    let remaining = 2;
    const run = vi.fn(async (_command, [action]) => {
      if (action === "print" && remaining-- <= 0) throw new Error("service not found");
    });
    const wait = vi.fn(async () => {});
    await stopService({ label: "test" }, { run, wait });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([, args]) => args[0])).toEqual(["bootout", "print", "print", "print"]);
  });
  it("does not treat a still registered service as stopped", async () => {
    const run = vi.fn(async () => {});
    await expect(stopService({ label: "test" }, { run, wait: async () => {} })).rejects.toThrow("still stopping");
  });
  it("allows an absent service but refuses a denied stop of a registered service", async () => {
    await stopService({ label: "test" }, { run: async () => { throw new Error("not found"); } });
    await expect(stopService({ label: "test" }, {
      run: async (_command, [action]) => { if (action === "bootout") throw new Error("denied"); },
    })).rejects.toThrow("Could not stop");
  });
});
