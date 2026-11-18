import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let promptRetention;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-retention-capture-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  promptRetention = await import("@/lib/promptRetention.js");
  // Batch size 1 flushes the write buffer immediately instead of after 5s.
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// The retention payload cap must not use the small disk-observability limit:
// Claude Code /v1/messages bodies are 10-100KB+, and truncating them to 5KB
// blanks out Original/Client/Translated in the prompt chat view.
describe("prompt retention payload capture", () => {
  it("keeps large anthropic payloads intact (bigger than the 5KB observability cap)", async () => {
    const bigText = "x".repeat(60 * 1024);

    // Consent: a real apiKeys row with promptRetentionEnabled.
    const created = await db.createApiKey("cap-test-key", "machine");
    await db.updateApiKey(created.id, { promptRetentionEnabled: true });

    const context = await promptRetention.createPromptRetentionContext(created.key);
    expect(context).toBeTruthy();

    const anthropicBody = {
      model: "openai-compatible-x/gpt-5.6-sol",
      max_tokens: 1024,
      stream: true,
      system: [{ type: "text", text: "You are Claude Code" }],
      messages: [{ role: "user", content: [{ type: "text", text: bigText }] }],
    };
    promptRetention.snapshotOriginalBody(context, anthropicBody);

    await db.saveRequestDetail({
      id: "det-big-1",
      provider: "openai-compatible-x",
      model: "gpt-5.6-sol",
      promptRetentionContext: context,
      apiKey: created.key,
      timestamp: new Date().toISOString(),
      latency: { ttft: 10, total: 100 },
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
      request: { ...anthropicBody, stream: true },
      providerRequest: { model: "gpt-5.6-sol", messages: [{ role: "user", content: bigText }] },
      providerResponse: "[Streaming in progress...]",
      response: { content: "[Streaming in progress...]", type: "streaming" },
      status: "success",
    });
    await new Promise((r) => setTimeout(r, 120));

    const detail = await db.getRequestDetailById("det-big-1");
    // No _truncated markers: the payload rides the dedicated retention cap.
    expect(detail.providerRequest?._truncated).toBeUndefined();
    expect(JSON.stringify(detail.providerRequest).length).toBeGreaterThan(60 * 1024);
    expect(detail.request?._truncated).toBeUndefined();
    // Pristine snapshot survived, so the Client view is renderable.
    expect(detail.originalRequest?.messages?.[0]?.content?.[0]?.text).toBe(bigText);
  });

  it("records and lists retention consent change events", () => {
    const event = promptRetention.recordRetentionChange("key-1", "My Key", "sk-1234***abcd", true, "dashboard");
    expect(event.enabled).toBe(true);
    expect(event.keyName).toBe("My Key");
    expect(event.maskedKey).toBe("sk-1234***abcd");
    const events = promptRetention.getRetentionEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].source).toBe("dashboard");
    expect(promptRetention.getRetentionEvents({ keyId: "key-1" }).length).toBeGreaterThanOrEqual(1);
    expect(promptRetention.getRetentionEvents({ keyId: "other" }).length).toBe(0);
    expect(promptRetention.maskKeyForDisplay("sk-abcdefghijklmnop")).toBe("sk-abcde***mnop");
  });
});
