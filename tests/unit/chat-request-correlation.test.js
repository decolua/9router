import { describe, expect, it } from "vitest";

const { handleChat } = await import("../../src/sse/handlers/chat.js");

describe("chat request correlation boundary", () => {
  it("adds trusted request ID to invalid requests", async () => {
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      body: "not-json",
    }));
    const body = await response.json();
    const requestId = body.error.request_id;

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
