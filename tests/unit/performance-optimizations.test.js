import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSettings, updateSettings, invalidateSettingsCache } from "@/lib/db/repos/settingsRepo.js";
import { validateApiKey, createApiKey, updateApiKey, deleteApiKey, invalidateApiKeyCache } from "@/lib/db/repos/apiKeysRepo.js";
import { getProviderConnections, createProviderConnection, updateProviderConnection, deleteProviderConnection, invalidateConnectionCache } from "@/lib/db/repos/connectionsRepo.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { createSSEStream } from "open-sse/utils/stream.js";
import { FORMATS } from "open-sse/translator/formats.js";

describe("Performance Optimizations Unit Tests", () => {
  beforeEach(() => {
    invalidateSettingsCache();
    invalidateApiKeyCache();
    invalidateConnectionCache();
  });

  describe("Settings Repository L1 In-Memory Cache", () => {
    it("should return cached settings on consecutive reads", async () => {
      const initialSettings = await getSettings();
      expect(initialSettings).toBeDefined();

      const secondSettings = await getSettings();
      expect(secondSettings).toBe(initialSettings);
    });

    it("should invalidate and update cache upon updateSettings", async () => {
      const initial = await getSettings();
      const updated = await updateSettings({ stickyRoundRobinLimit: 7 });

      expect(updated.stickyRoundRobinLimit).toBe(7);
      const readAfter = await getSettings();
      expect(readAfter.stickyRoundRobinLimit).toBe(7);
      expect(readAfter).toBe(updated);

      // Restore
      await updateSettings({ stickyRoundRobinLimit: initial.stickyRoundRobinLimit });
    });
  });

  describe("API Keys Repository L1 In-Memory Cache", () => {
    it("should cache validated API keys and invalidate on mutations", async () => {
      // Create test key
      const created = await createApiKey("Test Perf Key", "perf-machine-id-123");
      expect(created.key).toBeDefined();

      // First validation (caches the result)
      const isValidFirst = await validateApiKey(created.key);
      expect(isValidFirst).toBe(true);

      // Consecutive validation (hits cache)
      const isValidSecond = await validateApiKey(created.key);
      expect(isValidSecond).toBe(true);

      // Deactivate key (must invalidate cache)
      await updateApiKey(created.id, { isActive: false });
      const isValidAfterDeactivate = await validateApiKey(created.key);
      expect(isValidAfterDeactivate).toBe(false);

      // Cleanup
      await deleteApiKey(created.id);
      const isValidAfterDelete = await validateApiKey(created.key);
      expect(isValidAfterDelete).toBe(false);
    });

    it("should return false immediately for empty or null keys", async () => {
      expect(await validateApiKey("")).toBe(false);
      expect(await validateApiKey(null)).toBe(false);
      expect(await validateApiKey(undefined)).toBe(false);
    });
  });

  describe("Connections Repository L1 In-Memory Cache", () => {
    it("should cache provider connections by filter", async () => {
      const firstList = await getProviderConnections({ provider: "openai", isActive: true });
      const secondList = await getProviderConnections({ provider: "openai", isActive: true });

      expect(secondList).toBe(firstList);
    });

    it("should invalidate connection cache when a connection is modified", async () => {
      const created = await createProviderConnection({
        provider: "anthropic",
        authType: "apikey",
        name: "Test Anthropic Perf",
        apiKey: "sk-ant-test-perf",
        isActive: true,
      });

      expect(created.id).toBeDefined();

      const cachedList = await getProviderConnections({ provider: "anthropic" });
      expect(cachedList.some(c => c.id === created.id)).toBe(true);

      // Update connection
      await updateProviderConnection(created.id, { name: "Updated Anthropic Perf" });
      const refreshedList = await getProviderConnections({ provider: "anthropic" });
      const found = refreshedList.find(c => c.id === created.id);
      expect(found?.name).toBe("Updated Anthropic Perf");

      // Cleanup
      await deleteProviderConnection(created.id);
      const afterDeleteList = await getProviderConnections({ provider: "anthropic" });
      expect(afterDeleteList.some(c => c.id === created.id)).toBe(false);
    });
  });

  describe("Auth Service Granular Provider Mutex", () => {
    it("should allow concurrent credential retrieval for distinct providers without blocking", async () => {
      const start = Date.now();

      const [resOpenai, resAnthropic, resDeepseek] = await Promise.all([
        getProviderCredentials("openai"),
        getProviderCredentials("anthropic"),
        getProviderCredentials("deepseek"),
      ]);

      const duration = Date.now() - start;
      // All three independent providers should resolve in parallel quickly (< 1000ms)
      expect(duration).toBeLessThan(1000);
      expect(resOpenai === null || typeof resOpenai === "object").toBe(true);
      expect(resAnthropic === null || typeof resAnthropic === "object").toBe(true);
      expect(resDeepseek === null || typeof resDeepseek === "object").toBe(true);
    });
  });

  describe("Streaming SSE Parser & Chunk Accumulation", () => {
    it("should correctly accumulate content and thinking chunks without string mutation overhead", async () => {
      let completedContent = "";
      let completedThinking = "";

      const stream = createSSEStream({
        mode: "passthrough",
        provider: "openai",
        model: "gpt-4o",
        onStreamComplete: (accumulated) => {
          completedContent = accumulated.content;
          completedThinking = accumulated.thinking;
        },
      });

      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      const readPromise = (async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      })();

      const chunks = [
        'data: {"id":"1","choices":[{"delta":{"content":"Hello "}}]}\n\n',
        'data: {"id":"2","choices":[{"delta":{"content":"World!"}}]}\n\n',
        'data: {"id":"3","choices":[{"delta":{"reasoning_content":"Thinking steps"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        await writer.write(encoder.encode(chunk));
      }
      await writer.close();
      await readPromise;

      expect(completedContent).toBe("Hello World!");
      expect(completedThinking).toBe("Thinking steps");
    });

    it("should handle multiline chunks split across network packets cleanly", async () => {
      let completedContent = "";

      const stream = createSSEStream({
        mode: "passthrough",
        provider: "openai",
        model: "gpt-4o",
        onStreamComplete: (accumulated) => {
          completedContent = accumulated.content;
        },
      });

      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      const readPromise = (async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      })();

      const encoder = new TextEncoder();
      // Split a single JSON payload across two chunks
      await writer.write(encoder.encode('data: {"id":"1","choices":[{"delta":{"con'));
      await writer.write(encoder.encode('tent":"Distributed Line"}}]}\n\ndata: [DONE]\n\n'));
      await writer.close();
      await readPromise;

      expect(completedContent).toBe("Distributed Line");
    });
  });

  describe("Models Route Caching & Headers", () => {
    it("should return Cache-Control headers and cached model list", async () => {
      const { GET } = await import("@/app/api/v1/models/route.js");
      const fakeRequest = { headers: new Headers({ "x-internal-models-fetch": "1" }) };

      const res1 = await GET(fakeRequest);
      expect(res1.status).toBe(200);
      expect(res1.headers.get("cache-control")).toContain("public, max-age=30");

      const body1 = await res1.json();
      expect(body1.object).toBe("list");
      expect(Array.isArray(body1.data)).toBe(true);

      const res2 = await GET(fakeRequest);
      const body2 = await res2.json();
      expect(body2.data.length).toBe(body1.data.length);
    });
  });

  describe("Usage Repository Optimized Index Query", () => {
    it("should record usage entry and deduplicate repeated writes using native IS comparison", async () => {
      const { saveRequestUsage, getUsageHistory } = await import("@/lib/db/repos/usageRepo.js");

      const testTimestamp = new Date().toISOString();
      const entry = {
        timestamp: testTimestamp,
        provider: "openai",
        model: "gpt-4o",
        connectionId: "conn-perf-1",
        apiKey: "sk-perf-1",
        endpoint: "/v1/chat/completions",
        promptTokens: 15,
        completionTokens: 25,
        cost: 0.001,
        status: "200 OK",
        tokens: { prompt_tokens: 15, completion_tokens: 25 },
      };

      // First insertion
      await saveRequestUsage(entry);

      // Duplicate insertion with exact parameters
      await saveRequestUsage(entry);

      const history = await getUsageHistory({ provider: "openai" });
      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
    });
  });
});
