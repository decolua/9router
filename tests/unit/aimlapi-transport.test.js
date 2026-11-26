import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
vi.mock("undici", () => ({
  Agent: class {
    constructor(opts) { this.opts = opts; }
  },
  fetch: vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  }),
}));

import { aimlapiDirectFetch } from "../../open-sse/executors/aimlapi.js";

afterEach(() => { calls.length = 0; });

describe("AI/ML API direct transport", () => {
  it("refuses redirects and widens the curve list only for its own hosts", async () => {
    await aimlapiDirectFetch("https://tools.aimlapi.com/v1/tools/run", {
      method: "POST",
      redirect: "follow",
      headers: { Authorization: "Bearer k" },
      directFetch: aimlapiDirectFetch,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.directFetch).toBeUndefined();
    expect(calls[0].init.dispatcher.opts.connect.ecdhCurve).toBe("X25519:P-256");
  });

  it.each([
    "https://evil.example.com/v1/chat/completions",
    "https://api.aimlapi.com.evil.example/v1/chat/completions",
    "https://aimlapi.com/v1/chat/completions",
    "http://api.aimlapi.com/v1/chat/completions",
  ])("does not send the key to %s", async (url) => {
    await expect(aimlapiDirectFetch(url, { headers: { Authorization: "Bearer k" } })).rejects.toThrow(/refused host/);
    expect(calls).toHaveLength(0);
  });
});
