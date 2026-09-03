import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  agents: [],
  executorExecute: vi.fn(),
  lookup: vi.fn(),
  proxyAgents: [],
}));

vi.mock("node:dns/promises", () => ({
  lookup: (...args) => harness.lookup(...args),
}));
vi.mock("undici", () => ({
  Agent: class Agent {
    constructor(options) {
      this.options = options;
      harness.agents.push(this);
    }
    async close() {}
  },
  ProxyAgent: class ProxyAgent {
    constructor(options) {
      this.options = options;
      harness.proxyAgents.push(this);
    }
    async close() {}
  },
  Socks5ProxyAgent: class Socks5ProxyAgent {
    constructor(_url, options) {
      this.options = options;
      harness.proxyAgents.push(this);
    }
    async close() {}
  },
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ execute: (...args) => harness.executorExecute(...args) }),
}));

import { decodeBase64Image, urlToBase64 } from "../../open-sse/handlers/imageProviders/_base.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import antigravity from "../../open-sse/handlers/imageProviders/antigravity.js";
import blackForestLabs from "../../open-sse/handlers/imageProviders/blackForestLabs.js";
import cloudflareAi from "../../open-sse/handlers/imageProviders/cloudflareAi.js";
import falAi from "../../open-sse/handlers/imageProviders/falAi.js";
import huggingface from "../../open-sse/handlers/imageProviders/huggingface.js";
import nanobanana from "../../open-sse/handlers/imageProviders/nanobanana.js";
import runwayml from "../../open-sse/handlers/imageProviders/runwayml.js";
import {
  MAX_IMAGE_BYTES,
  MAX_REMOTE_JSON_BYTES,
} from "../../open-sse/config/mediaConfig.js";

const originalFetch = globalThis.fetch;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_JSON_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + MAX_REMOTE_JSON_BYTES;
const proxyRoute = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy-user:proxy-password@proxy.test:8080",
  strictProxy: true,
  disableEnvProxy: true,
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("image provider remote fetch security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.agents.length = 0;
    harness.proxyAgents.length = 0;
    harness.executorExecute.mockReset();
    harness.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(PNG, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it.each([
    ["private IPv4", [{ address: "10.0.0.8", family: 4 }]],
    ["IPv6 loopback", [{ address: "::1", family: 6 }]],
    ["mixed public/private DNS", [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]],
    ["IPv4-mapped loopback", [{ address: "::ffff:7f00:1", family: 6 }]],
    ["NAT64 loopback", [{ address: "64:ff9b::7f00:1", family: 6 }]],
    ["deprecated IPv6 site-local", [{ address: "fec0::1", family: 6 }]],
  ])("rejects %s before fetch", async (_name, records) => {
    harness.lookup.mockResolvedValue(records);

    await expect(urlToBase64("https://images.example.test/result.png")).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects target URL credentials before fetch", async () => {
    await expect(urlToBase64("https://target-user:target-password@images.example.test/result.png"))
      .rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects unavailable routes before DNS or fetch I/O", async () => {
    await expect(urlToBase64("https://images.example.test/result.png", {
      source: "unavailable",
      proxyUnavailable: true,
      proxyPoolId: "missing-pool",
    })).rejects.toThrow(/unavailable/i);

    expect(harness.lookup).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects non-canonical base64 image payloads", () => {
    expect(() => decodeBase64Image(`${PNG.toString("base64")}***`)).toThrow(/invalid/i);
  });

  it("uses manual redirects and never follows a redirect target", async () => {
    globalThis.fetch.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data" },
    }));

    await expect(urlToBase64("https://images.example.test/result.png")).rejects.toThrow();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][1].redirect).toBe("manual");
  });

  it("pins validated DNS and isolates proxy credentials from target headers", async () => {
    await expect(urlToBase64("https://images.example.test/result.png", proxyRoute))
      .resolves.toBe(PNG.toString("base64"));

    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.proxyAgents).toHaveLength(1);
    expect(new URL(harness.proxyAgents[0].options.uri).origin).toBe(new URL(proxyRoute.connectionProxyUrl).origin);
    expect(harness.proxyAgents[0].options.requestTls.servername).toBe("images.example.test");
    const [target, options] = globalThis.fetch.mock.calls[0];
    expect(new URL(target).hostname).toBe("93.184.216.34");
    expect(options.headers.Host).toBe("images.example.test");
    expect(JSON.stringify(options.headers)).not.toContain("proxy-user");
    expect(JSON.stringify(options.headers)).not.toContain("proxy-password");
    expect(options.redirect).toBe("manual");
  });

  it("rejects invalid and oversized image payloads", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response("not an image", { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.alloc(10 * 1024 * 1024 + 1), { status: 200 }));

    await expect(urlToBase64("https://images.example.test/invalid.png")).rejects.toThrow();
    await expect(urlToBase64("https://images.example.test/oversized.png")).rejects.toThrow();
  });

  it("rejects BFL polling URLs outside the credential origin", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValue(jsonResponse({ status: "Ready", result: { sample: "x" } }));
    const parsing = blackForestLabs.parseResponse(
      jsonResponse({ polling_url: "https://attacker.test/status" }),
      {
        headers: { "x-key": "BFL-SECRET" },
        proxyOptions: { disableEnvProxy: true },
        url: "https://api.bfl.ai/v1/flux-pro",
      },
    );
    const rejected = expect(parsing).rejects.toThrow(/origin|URL/i);
    await vi.advanceTimersByTimeAsync(1_500);

    await rejected;
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("never forwards Fal credentials to a foreign response origin", async () => {
    vi.useFakeTimers();
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonResponse({ images: [] }));
    const parsing = falAi.parseResponse(
      jsonResponse({
        status_url: "https://queue.fal.run/status/123",
        response_url: "https://attacker.test/result/123",
      }),
      {
        headers: { Authorization: "Key FAL-SECRET" },
        proxyOptions: { disableEnvProxy: true },
        url: "https://queue.fal.run/fal-ai/flux/dev",
      },
    );
    const rejected = expect(parsing).rejects.toThrow(/origin|URL/i);
    await vi.advanceTimersByTimeAsync(1_500);

    await rejected;
    expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes("attacker.test"))).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("bounds credential-bearing poll response bytes", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValue(new Response(JSON.stringify({
      status: "Ready",
      padding: "x".repeat(1024 * 1024),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const parsing = blackForestLabs.parseResponse(
      jsonResponse({ polling_url: "https://api.bfl.ai/v1/status/123" }),
      {
        headers: { "x-key": "BFL-SECRET" },
        proxyOptions: { disableEnvProxy: true },
        url: "https://api.bfl.ai/v1/flux-pro",
      },
    );
    const rejected = expect(parsing).rejects.toThrow(/large|bytes|size/i);
    await vi.advanceTimersByTimeAsync(1_500);

    await rejected;
  });

  it.each([
    ["NanoBanana", nanobanana, jsonResponse({ code: 200, data: { taskId: "task-1" } }), {
      data: { successFlag: 1, padding: "x".repeat(1024 * 1024) },
    }],
    ["Runway", runwayml, jsonResponse({ id: "task-1" }), {
      status: "SUCCEEDED", output: [], padding: "x".repeat(1024 * 1024),
    }],
  ])("bounds %s polling responses and disables redirects", async (_name, adapter, submit, pollBody) => {
    vi.useFakeTimers();
    globalThis.fetch.mockResolvedValue(jsonResponse(pollBody));
    const parsing = adapter.parseResponse(submit, {
      headers: { Authorization: "Bearer PROVIDER-SECRET" },
      proxyOptions: { disableEnvProxy: true },
    });
    const outcome = parsing.then(() => null, (error) => error);

    await vi.advanceTimersByTimeAsync(1_500);
    expect((await outcome)?.message).toMatch(/large|bytes|size/i);
    expect(globalThis.fetch.mock.calls[0][1].redirect).toBe("manual");
  });

  it("bounds Cloudflare JSON image results", async () => {
    const response = jsonResponse({ result: { image: "value" }, padding: "x".repeat(1024 * 1024) });

    await expect(cloudflareAi.parseResponse(response)).rejects.toThrow(/large|bytes|size/i);
  });

  it.each([
    ["success JSON", 200, MAX_IMAGE_JSON_BYTES + 1],
    ["error text", 502, MAX_REMOTE_JSON_BYTES + 1],
  ])("bounds Antigravity %s responses", async (_name, status, declaredBytes) => {
    harness.executorExecute.mockResolvedValue({
      response: new Response(JSON.stringify({ candidates: [] }), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(declaredBytes),
        },
      }),
    });

    await expect(antigravity.executeViaExecutor(
      "gemini-3-pro-image-preview",
      { prompt: "bounded" },
      { accessToken: "token" },
    )).rejects.toThrow(/large|bytes|size/i);
  });

  it.each([
    ["invalid", Buffer.from("not an image").toString("base64")],
    ["oversized", Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64")],
  ])("rejects %s Antigravity base64 in non-binary output", async (_name, b64) => {
    harness.executorExecute.mockResolvedValue({
      response: jsonResponse({
        candidates: [{ content: { parts: [{ inlineData: { data: b64 } }] } }],
      }),
    });

    const result = await handleImageGenerationCore({
      body: { prompt: "unsafe image" },
      modelInfo: { provider: "antigravity", model: "gemini-3-pro-image-preview" },
      credentials: { accessToken: "token" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it.each([
    ["invalid", new Response("not an image", { status: 200 })],
    ["oversized", new Response(PNG, { status: 200, headers: { "Content-Length": String(10 * 1024 * 1024 + 1) } })],
  ])("rejects %s HuggingFace image results", async (_name, response) => {
    await expect(huggingface.parseResponse(response)).rejects.toThrow(/image|large|size/i);
  });
});
