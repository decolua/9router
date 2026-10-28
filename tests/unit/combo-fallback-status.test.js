import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("handleComboChat fallback status tracking (OSC-001)", () => {
  const dummyLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  it("returns terminal status code when earlier model fails with 502 and later model fails with 429", async () => {
    let callCount = 0;
    const handleSingleModel = async (body, modelStr) => {
      callCount++;
      if (modelStr === "provider-a/model-1") {
        return new Response(
          JSON.stringify({ error: { message: "Bad Gateway from provider A" } }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
      if (modelStr === "provider-b/model-2") {
        return new Response(
          JSON.stringify({ error: { message: "Rate limit exceeded on provider B" } }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error("Unexpected model");
    };

    const res = await handleComboChat({
      body: { model: "test-combo", messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-1", "provider-b/model-2"],
      handleSingleModel,
      log: dummyLog,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(callCount).toBe(2);
    // Prior to fix: res.status was 502 because lastStatus was locked on model 1.
    // Fixed behavior: res.status matches terminal failure (429).
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.message).toContain("Rate limit exceeded on provider B");
  });

  it("updates lastStatus when earlier model throws an exception and later model fails with HTTP 429", async () => {
    let callCount = 0;
    const handleSingleModel = async (body, modelStr) => {
      callCount++;
      if (modelStr === "provider-a/model-1") {
        throw new Error("Socket disconnected unexpectedly");
      }
      if (modelStr === "provider-b/model-2") {
        return new Response(
          JSON.stringify({ error: { message: "Too many requests" } }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error("Unexpected model");
    };

    const res = await handleComboChat({
      body: { model: "test-combo", messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-1", "provider-b/model-2"],
      handleSingleModel,
      log: dummyLog,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(callCount).toBe(2);
    // Prior to fix: res.status was 500 from the catch block.
    // Fixed behavior: res.status updates to 429 from model 2.
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.message).toContain("Too many requests");
  });

  it("returns 503 when the final failure is 'no credentials'", async () => {
    const handleSingleModel = async () => {
      return new Response(
        JSON.stringify({ error: { message: "no credentials available" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await handleComboChat({
      body: { model: "test-combo", messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-1"],
      handleSingleModel,
      log: dummyLog,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.message).toContain("no credentials");
  });
});
