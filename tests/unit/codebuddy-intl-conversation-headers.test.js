import { describe, expect, it } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const executor = new CodeBuddyIntlExecutor();
const CREDS = { accessToken: "tok-test", connectionId: "conn-abc" };

describe("CodeBuddy Intl channel-verification headers (#5005)", () => {
  it("sends the full X-Conversation-* family", () => {
    const headers = executor.buildHeaders(CREDS, true);
    expect(headers["X-Conversation-ID"]).toBeTruthy();
    expect(headers["X-Conversation-Request-ID"]).toBeTruthy();
    expect(headers["X-Conversation-Message-ID"]).toBeTruthy();
  });

  it("keeps X-Conversation-ID stable per connection so prompt cache buckets hold", () => {
    const first = executor.buildHeaders(CREDS, true)["X-Conversation-ID"];
    const second = executor.buildHeaders(CREDS, true)["X-Conversation-ID"];
    expect(second).toBe(first);
    expect(executor.buildHeaders({ ...CREDS, connectionId: "conn-other" }, true)["X-Conversation-ID"])
      .not.toBe(first);
  });

  it("rotates the request and message ids per call", () => {
    const a = executor.buildHeaders(CREDS, true);
    const b = executor.buildHeaders(CREDS, true);
    expect(b["X-Conversation-Request-ID"]).not.toBe(a["X-Conversation-Request-ID"]);
    expect(b["X-Conversation-Message-ID"]).not.toBe(a["X-Conversation-Message-ID"]);
  });

  it("falls back to a random conversation id when the connection has no seed", () => {
    const headers = executor.buildHeaders({ accessToken: "tok-test" }, true);
    expect(headers["X-Conversation-ID"]).toMatch(/^[0-9a-f]{32}$/);
    expect(executor.buildHeaders({ accessToken: "tok-test" }, true)["X-Conversation-ID"])
      .not.toBe(headers["X-Conversation-ID"]);
  });

  it("still sends auth and the transport headers from the base executor", () => {
    const headers = executor.buildHeaders(CREDS, true);
    expect(headers.Authorization).toBe("Bearer tok-test");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Product"]).toBe("SaaS");
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("does not leak the header family onto the CN gateway executor", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const cnHeaders = new CodeBuddyExecutor().buildHeaders(CREDS, true);
    expect(cnHeaders["X-Conversation-ID"]).toBeUndefined();
  });
});
