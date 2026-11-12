import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "open-sse/services/combo.js";
import { unavailableResponse } from "open-sse/utils/error.js";

const NOW = Date.parse("2026-11-12T00:00:00Z");
const log = { info: vi.fn(), warn: vi.fn() };
const iso = (seconds) => new Date(NOW + seconds * 1000).toISOString();
const error = (body = {}, retryAfter) => new Response(JSON.stringify(body), {
  status: 429, headers: { "content-type": "application/json", ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }) },
});
const run = (responses) => handleComboChat({
  body: { messages: [{ role: "user", content: "hi" }], stream: false },
  models: responses.map((_, i) => `provider${i}/model`),
  handleSingleModel: vi.fn(async () => responses.shift()), log, comboStrategy: "fallback",
});
beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

describe("combo retry guidance (#4663)", () => {
  it("keeps the earliest header from actual cooldown envelopes", async () => {
    const response = await run([120, 20, 60].map(seconds => unavailableResponse(429, "usage limit reached", iso(seconds), "reset pending")));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("20");
  });

  it("accepts an HTTP-date header even if the member body is not JSON", async () => {
    const response = await run([new Response("rate limited", {
      status: 429, headers: { "retry-after": new Date(NOW + 45000).toUTCString() },
    })]);
    expect(response.headers.get("retry-after")).toBe("45");
  });

  it("ignores a malformed legacy timestamp before a valid member timestamp", async () => {
    const response = await run([error({ retryAfter: "invalid" }), error({ retryAfter: iso(35) })]);
    expect(response.headers.get("retry-after")).toBe("35");
  });

  it.each(["invalid", "-3", "999999999999999999999999"])("ignores an invalid header %s", async (value) => {
    const response = await run([error({}, value), error({}, "15")]);
    expect(response.headers.get("retry-after")).toBe("15");
  });

  it.each(["invalid", "-3600", "+3600", "3600.5"])("retains a legacy JSON reset when header %s is invalid", async (value) => {
    const response = await run([error({ retryAfter: iso(25) }, value)]);
    expect(response.headers.get("retry-after")).toBe("25");
  });

  it("does not invent retry guidance when none is available", async () => {
    const response = await run([error({}), error({ retryAfter: "invalid" })]);
    expect(response.status).toBe(429);
    expect(response.headers.has("retry-after")).toBe(false);
  });

  it("returns a later success without copying an earlier limit's retry header", async () => {
    const success = Response.json({ choices: [{ message: { content: "ok" } }] });
    expect(await run([error({}, "10"), success])).toBe(success);
    expect(success.headers.has("retry-after")).toBe(false);
  });
});
