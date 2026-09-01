import { describe, expect, it } from "vitest";
import { correlateResponse } from "../../src/sse/utils/requestCorrelation.js";

describe("server request correlation", () => {
  it("overwrites spoofable request IDs and preserves upstream ID separately", async () => {
    const response = await correlateResponse(
      new Response(JSON.stringify({ error: { message: "bad", request_id: "client-spoof" } }), { status: 400 }),
      "server-123"
    );
    const body = await response.json();

    expect(response.headers.get("x-request-id")).toBe("server-123");
    expect(body.error.request_id).toBe("server-123");
    expect(body.error.request_id).not.toBe("client-spoof");
  });

  it("keeps validated provider ID as upstream_request_id", async () => {
    const response = await correlateResponse(
      new Response(JSON.stringify({ error: { message: "bad", request_id: "upstream-123" } }), { status: 502 }),
      "server-456"
    );

    expect(await response.json()).toEqual({
      error: { message: "bad", request_id: "server-456", upstream_request_id: "upstream-123" },
    });
  });

  it("adds header without consuming successful response body", async () => {
    const response = await correlateResponse(new Response("stream-body"), "server-789");

    expect(response.headers.get("x-request-id")).toBe("server-789");
    expect(await response.text()).toBe("stream-body");
  });
});
