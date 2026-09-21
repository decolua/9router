import { describe, it, expect, vi, beforeEach } from "vitest";
import { XiaomiMimoExecutor, __test__ } from "../../open-sse/executors/xiaomi-mimo.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const { bareModel, COOKIE_KEY } = __test__;

const OPENAI_T = { runtimeTransport: { format: "openai", baseUrl: "https://api.xiaomimimo.com/v1/chat/completions" } };
const CLAUDE_T = { runtimeTransport: { format: "claude", baseUrl: "https://api.xiaomimimo.com/anthropic/v1/messages" } };

describe("xiaomi-mimo executor", () => {
  let ex;
  beforeEach(() => {
    ex = new XiaomiMimoExecutor();
  });

  it("is registered for xiaomi-mimo", () => {
    expect(getExecutor("xiaomi-mimo")).toBeInstanceOf(XiaomiMimoExecutor);
  });

  it("routes Preview models to the account-service route regardless of transport", () => {
    const expected = "https://mimo-server-cn.xiaomimimo.com/api/route/chat/completions";
    expect(ex.buildUrl("mimo-x-pro-preview", true, 0, OPENAI_T)).toBe(expected);
    expect(ex.buildUrl("mimo-x-pro-preview", true, 0, CLAUDE_T)).toBe(expected);
    // body.model arrives as `xiaomi/<id>` via upstreamModelId
    expect(ex.buildUrl("xiaomi/mimo-x-flash-preview", true, 0, OPENAI_T)).toBe(expected);
  });

  it("keeps the sourceFormat-matched endpoint for cloud models", () => {
    // Regression: a Claude client must reach /anthropic/v1/messages, not /v1/chat/completions.
    expect(ex.buildUrl("mimo-v2.5-pro", true, 0, CLAUDE_T)).toBe(CLAUDE_T.runtimeTransport.baseUrl);
    expect(ex.buildUrl("mimo-v2.5-pro", true, 0, OPENAI_T)).toBe(OPENAI_T.runtimeTransport.baseUrl);
  });

  it("authenticates Preview calls with the account cookie", () => {
    const headers = ex.buildHeaders({ [COOKIE_KEY]: "serviceToken=abc", accessToken: "sk-x" }, true, "u", "mimo-x-pro-preview");
    expect(headers.Cookie).toBe("serviceToken=abc");
    expect(headers.Authorization).toBeUndefined();
  });

  it("authenticates cloud calls with the bearer key", () => {
    const headers = ex.buildHeaders({ accessToken: "sk-x" }, true, "u", "mimo-v2.5-pro");
    expect(headers.Authorization).toBe("Bearer sk-x");
    expect(headers.Cookie).toBeUndefined();
  });

  it("fails fast when a Preview call has no account session", async () => {
    await expect(
      ex.execute({ model: "mimo-x-pro-preview", body: {}, stream: true, credentials: {}, log: null }),
    ).rejects.toThrow(/account session unavailable/);
  });

  it("flattens content-part arrays to plain strings", () => {
    const out = ex.transformRequest(
      "mimo-x-pro-preview",
      { messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] },
      true,
      {},
    );
    expect(out.messages[0].content).toBe("ab");
  });

  it("applies Preview defaults without overriding explicit values", () => {
    const body = { messages: [{ role: "user", content: "hi" }], temperature: 0.2 };
    const out = ex.transformRequest("mimo-x-pro-preview", body, true, {});
    expect(out.temperature).toBe(0.2);       // caller's value kept
    expect(out.top_p).toBe(0.95);            // default filled in
    expect(out.max_tokens).toBe(4096);
  });

  it("leaves cloud bodies free of Preview defaults", () => {
    const out = ex.transformRequest("mimo-v2.5-pro", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(out.thinking).toBeUndefined();
    expect(out.max_tokens).toBeUndefined();
  });

  it("strips a provider/model prefix when testing preview ids", () => {
    expect(bareModel("xiaomi/mimo-x-pro-preview")).toBe("mimo-x-pro-preview");
    expect(bareModel("mimo-x-pro-preview")).toBe("mimo-x-pro-preview");
  });
});
