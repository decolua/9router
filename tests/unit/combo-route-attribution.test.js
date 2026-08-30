import { describe, expect, it } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import * as routeAttribution from "../../open-sse/services/routeAttribution.js";

const log = { info() {}, warn() {} };

describe("Combo route attribution", () => {
  it("annotates a direct stream without exposing private identifiers", async () => {
    expect(typeof routeAttribution.annotateDirectResponse).toBe("function");
    let pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
    });

    const response = routeAttribution.annotateDirectResponse({
      requestedModel: "alias",
      resolvedModel: "provider/model",
      connectionId: "must-not-leak",
      credentialId: "must-not-leak",
    }, new Response(body));

    expect(pulls).toBe(0);
    expect(response.headers.get("x-9router-requested-model")).toBe("alias");
    expect(response.headers.get("x-9router-resolved-provider")).toBe("provider");
    expect(response.headers.get("x-9router-resolved-model")).toBe("model");
    expect([...response.headers].some(([name, value]) => /credential|connection|must-not-leak/i.test(`${name}:${value}`))).toBe(false);
    expect(response.headers.get("access-control-expose-headers")).toContain("X-9Router-Requested-Model");
    expect(await response.text()).toBe("streamed");
    expect(pulls).toBe(1);
  });

  it("reports the requested Combo, resolved leaf, and attempted fallbacks", async () => {
    const attempts = [];
    const response = await handleComboChat({
      body: { model: "coding-combo", messages: [{ role: "user", content: "ping" }] },
      models: ["provider/model-a", "provider/model-b"],
      comboName: "coding-combo",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        return model.endsWith("model-a")
          ? new Response("unavailable", { status: 503 })
          : new Response("ok", { headers: { "content-type": "text/plain" } });
      },
    });

    expect(await response.text()).toBe("ok");
    expect(attempts).toEqual(["provider/model-a", "provider/model-b"]);
    expect(response.headers.get("x-9router-requested-model")).toBe("coding-combo");
    expect(response.headers.get("x-9router-resolved-provider")).toBe("provider");
    expect(response.headers.get("x-9router-resolved-model")).toBe("model-b");
    expect(response.headers.get("x-9router-route-path")).toBe("coding-combo,provider/model-b");
    expect(response.headers.get("x-9router-fallback-count")).toBe("1");
    expect(response.headers.get("x-9router-attempted-models")).toBe("provider/model-a,provider/model-b");
  });

  it("preserves the complete nested Combo path", async () => {
    const inner = () => handleComboChat({
      body: { model: "inner-combo", messages: [] },
      models: ["provider/model-a", "provider/model-b"],
      comboName: "inner-combo",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async (_body, model) => model.endsWith("model-a")
        ? new Response("unavailable", { status: 503 })
        : new Response("ok"),
    });
    const response = await handleComboChat({
      body: { model: "outer-combo", messages: [] },
      models: ["inner-combo"],
      comboName: "outer-combo",
      comboStrategy: "fallback",
      log,
      handleSingleModel: inner,
    });

    expect(response.headers.get("x-9router-route-path")).toBe("outer-combo,inner-combo,provider/model-b");
    expect(response.headers.get("x-9router-resolved-provider")).toBe("provider");
    expect(response.headers.get("x-9router-resolved-model")).toBe("model-b");
    expect(response.headers.get("x-9router-fallback-count")).toBe("1");
    expect(response.headers.get("x-9router-attempted-models")).toBe("inner-combo,provider/model-a,provider/model-b");
  });
});
