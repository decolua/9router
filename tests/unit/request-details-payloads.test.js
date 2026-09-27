import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

/**
 * What the Request Details tab is handed, and what it is not.
 *
 * The bodies are withheld by default — without that, any dashboard session
 * could read every conversation the gateway has carried. The existing
 * redaction test asserts an inline copy of the route's logic rather than the
 * route, so it kept passing while the route grew a conversation branch and an
 * environment switch that turns redaction off entirely. Those two are the ones
 * worth asserting against the real thing.
 */

const DETAIL = {
  id: "d1",
  provider: "claude-cli",
  model: "claude-cli-opus-1m",
  timestamp: "2026-09-24T00:00:00.000Z",
  status: "success",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  request: { messages: [{ role: "user", content: "a private question" }] },
  providerRequest: {
    model: "opus[1m]",
    stdinChars: 1234,
    conversation: { turns: 3, toolCalls: 1, unansweredCalls: ["toolu_1"] },
  },
  providerResponse: { text: "a private answer" },
  response: { content: "a private answer" },
};

const ENV_KEYS = ["OBSERVABILITY_INCLUDE_PAYLOADS", "ENABLE_REQUEST_LOGS", "OBSERVABILITY_ENABLED"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.doUnmock("@/lib/usageDb");
});

async function callRoute() {
  vi.resetModules();
  vi.doMock("@/lib/usageDb", async () => {
    const repo = await vi.importActual("@/lib/db/repos/requestDetailsRepo.js");
    return {
      getRequestDetails: async () => ({
        details: [JSON.parse(JSON.stringify(DETAIL))],
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      }),
      isObservabilityRecording: async () => true,
      observabilityEnvSource: repo.observabilityEnvSource,
    };
  });
  const { GET } = await import("@/app/api/usage/request-details/route.js");
  const res = await GET(new Request("http://localhost/api/usage/request-details"));
  return res.json();
}

describe("what the Request Details API returns", () => {
  it("withholds every body by default", async () => {
    const body = await callRoute();
    const detail = body.details[0];
    expect(body.payloadsRedacted).toBe(true);
    expect(detail.request).toEqual({ redacted: true });
    expect(detail.providerResponse).toEqual({ redacted: true });
    expect(detail.response).toEqual({ redacted: true });
    expect(JSON.stringify(body)).not.toContain("a private question");
    expect(JSON.stringify(body)).not.toContain("a private answer");
  });

  it("keeps the metadata, which is what the table is drawn from", async () => {
    const detail = (await callRoute()).details[0];
    expect(detail.model).toBe("claude-cli-opus-1m");
    expect(detail.tokens).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(detail.status).toBe("success");
  });

  it("keeps the conversation's shape, which is not its contents", async () => {
    // Turn counts and tool ids: what a looping client is diagnosed from, and
    // the reason redaction alone left the record saying only how many
    // characters went down the pipe.
    const detail = (await callRoute()).details[0];
    expect(detail.providerRequest.redacted).toBe(true);
    expect(detail.providerRequest.conversation)
      .toEqual({ turns: 3, toolCalls: 1, unansweredCalls: ["toolu_1"] });
    expect(detail.providerRequest.stdinChars).toBeUndefined();
  });

  it("hands over the bodies when the server's environment says to", async () => {
    // Deliberately an environment variable: it takes access to the server, not
    // just a session on it.
    process.env.OBSERVABILITY_INCLUDE_PAYLOADS = "true";
    const body = await callRoute();
    expect(body.payloadsRedacted).toBe(false);
    expect(body.details[0].response.content).toBe("a private answer");
  });

  it("does not hand them over for anything but an exact true", async () => {
    for (const value of ["1", "yes", "TRUE", "", "false"]) {
      process.env.OBSERVABILITY_INCLUDE_PAYLOADS = value;
      expect((await callRoute()).payloadsRedacted, value).toBe(true);
    }
  });

  it("names the environment variable that settled recording, when one did", async () => {
    // The tab tells the operator to flip a switch in Settings; an environment
    // variable overrides that switch in silence, so the tab has to be able to
    // say so instead of giving advice that cannot work.
    expect((await callRoute()).recordingSource).toBeNull();
    process.env.ENABLE_REQUEST_LOGS = "false";
    expect((await callRoute()).recordingSource).toBe("ENABLE_REQUEST_LOGS");
    delete process.env.ENABLE_REQUEST_LOGS;
    process.env.OBSERVABILITY_ENABLED = "true";
    expect((await callRoute()).recordingSource).toBe("OBSERVABILITY_ENABLED");
  });
});

/**
 * The stored record, before any of that.
 *
 * A field larger than the size limit is replaced wholesale by a preview of its
 * first 200 characters — which dropped the conversation's shape exactly for the
 * long, tool-heavy conversations that are worth diagnosing.
 */
describe("what survives the size limit", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-details-size-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();
    await db.updateSettings({
      enableObservability: true,
      observabilityBatchSize: 1,
      observabilityMaxJsonSize: 1, // 1 KB
    });
  });

  afterAll(() => {
    // Windows keeps the SQLite file open until the driver is collected; the
    // directory is under %TEMP% either way.
    try { if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* held open */ }
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  const shape = { turns: 8, toolCalls: 4, orphanResults: ["toolu_9"], unansweredCalls: [] };

  it("keeps the conversation's shape when the rest of the field is too large", async () => {
    await db.saveRequestDetail({
      id: "too-big",
      provider: "claude-cli",
      model: "claude-cli-opus-1m",
      timestamp: new Date().toISOString(),
      status: "success",
      providerRequest: { conversation: shape, padding: "x".repeat(4000) },
    });
    await new Promise((r) => setTimeout(r, 150));

    const stored = (await db.getRequestDetails({ provider: "claude-cli" }))
      .details.find((d) => d.id === "too-big");
    expect(stored.providerRequest._truncated).toBe(true);
    expect(stored.providerRequest.conversation).toEqual(shape);
    expect(stored.providerRequest.padding).toBeUndefined();
  });

  it("still truncates a field that has no shape to keep", async () => {
    await db.saveRequestDetail({
      id: "no-shape",
      provider: "claude-cli",
      model: "claude-cli-opus-1m",
      timestamp: new Date().toISOString(),
      status: "success",
      providerRequest: { padding: "x".repeat(4000) },
    });
    await new Promise((r) => setTimeout(r, 150));

    const stored = (await db.getRequestDetails({ provider: "claude-cli" }))
      .details.find((d) => d.id === "no-shape");
    expect(stored.providerRequest._truncated).toBe(true);
    expect(stored.providerRequest.conversation).toBeUndefined();
  });
});
