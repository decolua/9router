import { describe, expect, it } from "vitest";
import { setRoutingMeta, getRoutingMeta } from "../../open-sse/services/routingMeta.js";

describe("routingMeta", () => {
  it("stores and reads metadata on the same Response object", () => {
    const resp = new Response("err", { status: 502 });
    setRoutingMeta(resp, { errorKind: "connect_timeout", status: 502 });
    expect(getRoutingMeta(resp)).toEqual({ errorKind: "connect_timeout", status: 502 });
  });

  it("does NOT leak metadata into headers or body", async () => {
    const resp = new Response(JSON.stringify({ error: "boom" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
    setRoutingMeta(resp, { errorKind: "connect_timeout", status: 502 });

    // No header carries the kind
    for (const [, value] of resp.headers.entries()) {
      expect(String(value)).not.toContain("connect_timeout");
    }
    const text = await resp.clone().text();
    expect(text).not.toContain("connect_timeout");
  });

  it("returns null for an unknown Response", () => {
    expect(getRoutingMeta(new Response("x"))).toBeNull();
    expect(getRoutingMeta(null)).toBeNull();
  });
});
