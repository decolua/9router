import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-req-log-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1, observabilityFlushIntervalMs: 10 });
});

afterAll(async () => {
  try {
    await db?.closeDb?.();
  } catch {}
  try {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Request Logging & Filtering", () => {
  it("persists request detail with apiKey, customer, ip, status, and tokens", async () => {
    const detail = {
      id: "req-test-1",
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "9r-sec-testkey-12345",
      customer: "Customer Alpha",
      ip: "192.168.1.100",
      status: "success",
      cost: 0.00045,
      tokens: { prompt_tokens: 15, completion_tokens: 30, total_tokens: 45 },
      request: {
        model: "deepseek-chat",
        messages: [{ role: "user", content: "Hello world" }]
      },
      response: {
        content: "Hello! How can I help you today?"
      }
    };

    await db.saveRequestDetail(detail);
    await db.flushRequestDetailsNow();

    const fetched = await db.getRequestDetailById("req-test-1");
    expect(fetched).toBeDefined();
    expect(fetched.id).toBe("req-test-1");
    expect(fetched.apiKey).toBe("9r-sec-testkey-12345");
    expect(fetched.customer).toBe("Customer Alpha");
    expect(fetched.ip).toBe("192.168.1.100");
    expect(fetched.status).toBe("success");
    expect(fetched.cost).toBeCloseTo(0.00045, 5);
    expect(fetched.tokens.total_tokens).toBe(45);
    expect(fetched.request.messages[0].content).toBe("Hello world");
    expect(fetched.response.content).toBe("Hello! How can I help you today?");
  });

  it("filters request details by apiKey and customer", async () => {
    await db.saveRequestDetail({
      id: "req-cust-a",
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "key-alpha",
      customer: "Alpha Corp",
      status: "success",
      tokens: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    });

    await db.saveRequestDetail({
      id: "req-cust-b",
      provider: "qwen",
      model: "qwen-turbo",
      apiKey: "key-beta",
      customer: "Beta Inc",
      status: "success",
      tokens: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
    });

    await db.flushRequestDetailsNow();

    const alphaResults = await db.getRequestDetails({ apiKey: "key-alpha" });
    expect(alphaResults.details.some((d) => d.id === "req-cust-a")).toBe(true);
    expect(alphaResults.details.some((d) => d.id === "req-cust-b")).toBe(false);

    const betaResults = await db.getRequestDetails({ customer: "Beta" });
    expect(betaResults.details.some((d) => d.id === "req-cust-b")).toBe(true);
    expect(betaResults.details.some((d) => d.id === "req-cust-a")).toBe(false);
  });

  it("filters request details by model and status", async () => {
    await db.saveRequestDetail({
      id: "req-status-err",
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "key-err",
      status: "403 Forbidden",
      error: "Model not permitted for this API key",
      tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });

    await db.flushRequestDetailsNow();

    const errResults = await db.getRequestDetails({ status: "403 Forbidden" });
    expect(errResults.details.some((d) => d.id === "req-status-err")).toBe(true);

    const modelResults = await db.getRequestDetails({ model: "deepseek-chat" });
    expect(modelResults.details.some((d) => d.id === "req-status-err")).toBe(true);
  });

  it("filters request details by IP address", async () => {
    await db.saveRequestDetail({
      id: "req-ip-test",
      provider: "qwen",
      model: "qwen-plus",
      ip: "10.0.0.42",
      status: "success"
    });

    await db.flushRequestDetailsNow();

    const ipResults = await db.getRequestDetails({ ip: "10.0.0.42" });
    expect(ipResults.details.some((d) => d.id === "req-ip-test")).toBe(true);
  });
});
