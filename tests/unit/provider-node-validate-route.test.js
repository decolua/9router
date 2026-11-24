import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/dashboardGuard", () => ({ isLocalRequest: () => true }));

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const post = async (body) => {
  const { POST } = await import("../../src/app/api/provider-nodes/validate/route.js");
  const res = await POST(new Request("http://localhost/api/provider-nodes/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "https://node.test/v1", apiKey: "k", ...body }),
  }));
  return { status: res.status, json: await res.json() };
};

const networkError = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("#5721 /api/provider-nodes/validate network failures", () => {
  it.each(["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND"])("reports %s as a validation result, not HTTP 500", async (code) => {
    global.fetch = vi.fn().mockRejectedValue(networkError(code));
    const { status, json } = await post({});
    expect(status).toBe(200);
    expect(json.valid).toBe(false);
    expect(typeof json.error).toBe("string");
  });

  it("keeps HTTP 500 for errors that are not a failed probe, so bugs stay visible", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom"));
    const { status, json } = await post({});
    expect(status).toBe(500);
    expect(json.valid).toBe(false);
  });

  it("does not hide a bug whose message merely mentions a timeout", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Cannot read properties of undefined (reading "timeoutMs")'));
    expect((await post({})).status).toBe(500);
  });

  it("keeps HTTP 500 for a malformed request body (a request error, not a probe result)", async () => {
    const { POST } = await import("../../src/app/api/provider-nodes/validate/route.js");
    const res = await POST(new Request("http://localhost/api/provider-nodes/validate", { method: "POST", body: "{bad" }));
    expect(res.status).toBe(500);
  });

  it("does not blame the provider for a connect timeout", async () => {
    global.fetch = vi.fn().mockRejectedValue(networkError("ETIMEDOUT"));
    const { json } = await post({});
    expect(json.error).not.toMatch(/too slow/i);
  });

  it("still validates a healthy node", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { status, json } = await post({});
    expect(status).toBe(200);
    expect(json.valid).toBe(true);
  });

  it("still rejects missing input with 400", async () => {
    const { status } = await post({ apiKey: "" });
    expect(status).toBe(400);
  });
});
