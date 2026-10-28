import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import registry from "../../open-sse/providers/registry/codebuddy-intl.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

// The identity values below are the ones the official WorkBuddy AI 5.8.4
// desktop client puts on POST /v2/chat/completions (mitmproxy capture +
// client source cross-check).
const CAPTURED_UA = "WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/2.161.0";

const CONVERSATION_HEADERS = [
  "X-Conversation-ID",
  "X-Conversation-Request-ID",
  "X-Root-Request-ID",
  "X-Conversation-Message-ID",
];
const HEX32_HEADERS = [
  "X-Request-ID",
  "X-Conversation-Request-ID",
  "X-Root-Request-ID",
  "X-Conversation-Message-ID",
];
const TRACE_HEADERS = [
  "X-Trace-ID",
  "traceparent",
  "b3",
  "X-B3-TraceId",
  "X-B3-SpanId",
  "X-B3-Sampled",
];

function buildHeaders() {
  // DefaultExecutor's constructor needs the provider config; the executor under
  // test only overrides buildHeaders, so a minimal credentials object is enough.
  const executor = new CodeBuddyIntlExecutor();
  return executor.buildHeaders({ accessToken: "test-token" }, true, "url", "model", null);
}

describe("codebuddy-intl outbound identity (#4946)", () => {
  describe("registry transport", () => {
    it("talks to the workbuddy.ai chat gateway", () => {
      expect(registry.transport.baseUrl).toBe(
        "https://www.workbuddy.ai/v2/chat/completions"
      );
    });

    it("sends the captured desktop User-Agent", () => {
      expect(registry.transport.headers["User-Agent"]).toBe(CAPTURED_UA);
    });

    it("identifies as WorkBuddy, not IDE", () => {
      expect(registry.transport.headers["X-IDE-Type"]).toBe("WorkBuddy");
      expect(registry.transport.headers["X-IDE-Name"]).toBe("WorkBuddy");
      expect(registry.transport.headers["X-IDE-Version"]).toBe("5.8.4");
    });

    it("carries the captured product and agent headers", () => {
      expect(registry.transport.headers["X-Product"]).toBe("SaaS");
      expect(registry.transport.headers["X-Private-Data"]).toBe("true");
      expect(registry.transport.headers["X-Agent-Intent"]).toBe("craft");
      expect(registry.transport.headers["X-Agent-Purpose"]).toBe("conversation");
      expect(registry.transport.headers["X-Agent-Type"]).toBe("main");
      expect(registry.transport.headers["X-Domain"]).toBe("www.workbuddy.ai");
    });

    it("reads usage from the workbuddy.ai billing endpoint", () => {
      expect(registry.transport.usage.url).toBe(
        "https://www.workbuddy.ai/v2/billing/meter/get-user-resource"
      );
    });
  });

  describe("per-request header family", () => {
    // The channel check rejects a request that carries no conversation id with
    // HTTP 400 / code 11-128 (`conversation id missing`), so these headers are
    // the fix's whole point.
    it("sends every conversation header", () => {
      const headers = buildHeaders();
      for (const name of CONVERSATION_HEADERS) {
        expect(headers[name], name).toBeTruthy();
      }
    });

    it("keeps the captured id relationships", () => {
      const headers = buildHeaders();
      expect(headers["X-Conversation-Message-ID"]).toBe(headers["X-Request-ID"]);
      expect(headers["X-Root-Request-ID"]).toBe(headers["X-Conversation-Request-ID"]);
    });

    it("uses the captured id shapes", () => {
      const headers = buildHeaders();
      expect(headers["X-Conversation-ID"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      for (const name of HEX32_HEADERS) {
        expect(headers[name], name).toMatch(/^[0-9a-f]{32}$/);
      }
    });

    it("sends the W3C / B3 trace family", () => {
      const headers = buildHeaders();
      for (const name of TRACE_HEADERS) {
        expect(headers[name], name).toBeTruthy();
      }
      expect(headers.traceparent).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
      );
      expect(headers["X-B3-TraceId"]).toBe(headers["X-Trace-ID"]);
    });

    it("generates a fresh conversation id per request", () => {
      // Upstream keeps no history under the conversation id — the capture shows
      // a new one per call, so nothing may be cached across requests.
      expect(buildHeaders()["X-Conversation-ID"]).not.toBe(
        buildHeaders()["X-Conversation-ID"]
      );
    });
  });

  describe("no stale identity left behind", () => {
    it("does not mention the old IDE identity", () => {
      const registrySrc = readFileSync(
        resolve(root, "open-sse/providers/registry/codebuddy-intl.js"),
        "utf8"
      );
      expect(registrySrc).not.toContain("IDE/2.108.1 CodeBuddy/2.108.1");
      expect(registrySrc).not.toContain('"X-IDE-Type": "IDE"');
      expect(registrySrc).not.toContain(
        "codebuddy.ai/v2/chat/completions"
      );
    });
  });
});
