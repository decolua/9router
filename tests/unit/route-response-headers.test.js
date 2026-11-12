// Route info headers (x-9router-*) — unit coverage for the helpers added in #5313.
// `ROUTE_HEADERS_ENABLED` is read once at module load, so the kill-switch cases
// reset the module registry and re-import instead of mutating a live binding.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  upstreamResponseHeaders,
  routeResponseHeaders,
  cloneResponseWithHeaders,
} from "open-sse/utils/upstreamHeaders.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("routeResponseHeaders", () => {
  it("emits all four headers when every field is provided", () => {
    expect(routeResponseHeaders("gh", "gpt-5.6", "dev-combo", 2)).toEqual({
      "x-9router-provider": "gh",
      "x-9router-model": "gpt-5.6",
      "x-9router-combo": "dev-combo",
      "x-9router-attempts": "2",
    });
  });

  it("omits x-9router-combo for a single-model request", () => {
    const headers = routeResponseHeaders("gh", "gpt-5.6", undefined, 1);
    expect(headers).not.toHaveProperty("x-9router-combo");
    expect(headers["x-9router-attempts"]).toBe("1");
  });

  it("treats an empty combo name as absent", () => {
    expect(routeResponseHeaders("gh", "gpt-5.6", "", 1)).not.toHaveProperty("x-9router-combo");
  });

  it("includes attempts=1 but drops missing, zero, negative and non-numeric values", () => {
    expect(routeResponseHeaders("gh", "m", null, 1)["x-9router-attempts"]).toBe("1");
    for (const value of [undefined, null, 0, -3, NaN]) {
      expect(routeResponseHeaders("gh", "m", null, value)).not.toHaveProperty("x-9router-attempts");
    }
  });

  it("skips provider and model when they are falsy", () => {
    const headers = routeResponseHeaders("", null, undefined, 1);
    expect(headers).not.toHaveProperty("x-9router-provider");
    expect(headers).not.toHaveProperty("x-9router-model");
    expect(headers).toEqual({ "x-9router-attempts": "1" });
  });

  it("stringifies non-string values", () => {
    expect(routeResponseHeaders(123, 456, 789, 1)).toEqual({
      "x-9router-provider": "123",
      "x-9router-model": "456",
      "x-9router-combo": "789",
      "x-9router-attempts": "1",
    });
  });
});

describe("cloneResponseWithHeaders", () => {
  it("preserves status, statusText, body and pre-existing upstream headers", async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 201,
      statusText: "Created",
      headers: {
        "Content-Type": "application/json",
        "retry-after": "5",
        "anthropic-ratelimit-unified-status": "rejected",
      },
    });

    const cloned = cloneResponseWithHeaders(original, {
      "x-9router-provider": "gh",
      "x-9router-model": "gpt-5.6",
    });

    expect(cloned.status).toBe(201);
    expect(cloned.statusText).toBe("Created");
    expect(cloned.headers.get("content-type")).toBe("application/json");
    expect(cloned.headers.get("retry-after")).toBe("5");
    expect(cloned.headers.get("anthropic-ratelimit-unified-status")).toBe("rejected");
    expect(cloned.headers.get("x-9router-provider")).toBe("gh");
    expect(cloned.headers.get("x-9router-model")).toBe("gpt-5.6");
    expect(await cloned.json()).toEqual({ ok: true });
  });

  it("overrides an existing header with the same name", () => {
    const original = new Response("x", { headers: { "x-9router-provider": "old" } });
    const cloned = cloneResponseWithHeaders(original, { "x-9router-provider": "new" });
    expect(cloned.headers.get("x-9router-provider")).toBe("new");
  });

  it("streams an SSE body through unchanged", async () => {
    const payload = "data: {\"choices\":[]}\n\ndata: [DONE]\n\n";
    const original = new Response(payload, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const cloned = cloneResponseWithHeaders(original, { "x-9router-combo": "dev-combo" });

    expect(cloned.headers.get("content-type")).toBe("text/event-stream");
    expect(cloned.headers.get("x-9router-combo")).toBe("dev-combo");
    expect(await cloned.text()).toBe(payload);
  });

  it("keeps the body untouched when no extra headers are given", async () => {
    const original = new Response("plain", { status: 202 });
    const cloned = cloneResponseWithHeaders(original, {});
    expect(cloned.status).toBe(202);
    expect(await cloned.text()).toBe("plain");
  });
});

describe("NINEROUTER_ROUTE_HEADERS kill switch", () => {
  // Re-import the module so ROUTE_HEADERS_ENABLED is evaluated with the stubbed env.
  async function loadWith(value) {
    vi.resetModules();
    if (value === undefined) vi.stubEnv("NINEROUTER_ROUTE_HEADERS", undefined);
    else vi.stubEnv("NINEROUTER_ROUTE_HEADERS", value);
    return import("open-sse/utils/upstreamHeaders.js");
  }

  it.each(["0", "false"])("accepts %s as the off switch", async (value) => {
    const mod = await loadWith(value);
    expect(mod.routeResponseHeaders("gh", "gpt-5.6", "dev-combo", 2)).toEqual({});
  });

  it.each([undefined, "", "1", "true", "FALSE", "no"])(
    "keeps headers on for %s",
    async (value) => {
      const mod = await loadWith(value);
      expect(mod.routeResponseHeaders("gh", "gpt-5.6")).toMatchObject({
        "x-9router-provider": "gh",
        "x-9router-model": "gpt-5.6",
      });
    }
  );

  it("leaves upstream header forwarding independent of the switch", async () => {
    const mod = await loadWith("0");
    expect(mod.upstreamResponseHeaders(new Headers({ "retry-after": "9" }))).toEqual({
      "retry-after": "9",
    });
  });
});

describe("upstreamResponseHeaders regression", () => {
  it("still filters to retry and ratelimit headers only", () => {
    const upstream = new Headers({
      "retry-after": "12",
      "x-should-retry": "false",
      "anthropic-ratelimit-unified-status": "rejected",
      "set-cookie": "secret=1",
      "content-length": "99",
    });
    expect(upstreamResponseHeaders(upstream)).toEqual({
      "retry-after": "12",
      "x-should-retry": "false",
      "anthropic-ratelimit-unified-status": "rejected",
    });
  });

  it("returns an empty object for missing or non-Headers input", () => {
    expect(upstreamResponseHeaders(undefined)).toEqual({});
    expect(upstreamResponseHeaders({})).toEqual({});
  });
});
