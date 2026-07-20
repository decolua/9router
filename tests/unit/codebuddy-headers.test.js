/**
 * Unit tests for CodeBuddy CLI spoofing headers
 *
 * Tests cover:
 *  - default.js buildHeaders(): CodeBuddy provider includes 5 CLI spoofing headers
 *  - X-App: cli
 *  - X-Stainless-Runtime: node
 *  - X-Stainless-Lang: js
 *  - X-Stainless-Helper-Method: stream
 *  - X-Stainless-Retry-Count: 0
 */

import { describe, it, expect } from "vitest";
import DefaultExecutor from "open-sse/executors/default.js";

describe("DefaultExecutor.buildHeaders() — codebuddy provider", () => {

  it("should include CLI spoofing headers for CodeBuddy provider", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    // Verify the 5 required CLI spoofing headers
    expect(headers["X-App"]).toBe("cli");
    expect(headers["X-Stainless-Runtime"]).toBe("node");
    expect(headers["X-Stainless-Lang"]).toBe("js");
    expect(headers["X-Stainless-Helper-Method"]).toBe("stream");
    expect(headers["X-Stainless-Retry-Count"]).toBe("0");
  });

  it("should set Bearer Authorization when accessToken is provided", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token-123" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["Authorization"]).toBe("Bearer test-token-123");
  });

  it("should set Bearer Authorization when apiKey is provided", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { apiKey: "api-key-456" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["Authorization"]).toBe("Bearer api-key-456");
  });

  it("should include Accept: text/event-stream when stream=true", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("should include Content-Type: application/json; charset=utf-8", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["Content-Type"]).toBe("application/json; charset=utf-8");
  });

  it("should include User-Agent header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["User-Agent"]).toBe("CLI/2.105.2 CodeBuddy/2.105.2");
  });

  it("should include X-Requested-With: XMLHttpRequest", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Requested-With"]).toBe("XMLHttpRequest");
  });

  it("should include X-IDE-Type: CLI", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-IDE-Type"]).toBe("CLI");
  });

  it("should include X-IDE-Name: CLI", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-IDE-Name"]).toBe("CLI");
  });

  it("should include X-IDE-Version: 2.105.2", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-IDE-Version"]).toBe("2.105.2");
  });

  it("should include X-Private-Data: false", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Private-Data"]).toBe("false");
  });

  it("should include X-Domain with default value when not provided", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Domain"]).toBe("www.codebuddy.ai");
  });

  it("should include X-Domain with custom value when provided in providerSpecificData", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = {
      accessToken: "test-token",
      providerSpecificData: { domain: "custom.codebuddy.ai" }
    };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Domain"]).toBe("custom.codebuddy.ai");
  });

  it("should generate X-Request-ID header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Request-ID"]).toBeDefined();
    expect(typeof headers["X-Request-ID"]).toBe("string");
    expect(headers["X-Request-ID"].length).toBeGreaterThan(0);
  });

  it("should generate X-Conversation-ID header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Conversation-ID"]).toBeDefined();
    expect(typeof headers["X-Conversation-ID"]).toBe("string");
    expect(headers["X-Conversation-ID"].length).toBeGreaterThan(0);
  });

  it("should include X-Conversation-Request-ID header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Conversation-Request-ID"]).toBeDefined();
  });

  it("should include X-Conversation-Message-ID header", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Conversation-Message-ID"]).toBeDefined();
  });

  it("should include X-Agent-Intent: craft", () => {
    const executor = new DefaultExecutor("codebuddy");
    const credentials = { accessToken: "test-token" };
    const headers = executor.buildHeaders(credentials, true);

    expect(headers["X-Agent-Intent"]).toBe("craft");
  });
});
