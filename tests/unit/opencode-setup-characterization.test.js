/**
 * Characterization tests for the OpenCode setup route.
 *
 * Bead: 9r-ocmr.e1.01
 * PRD:  REQ-001, REQ-003, VAL-001, VAL-003
 *
 * These tests assert the DESIRED behavior (limits present, user fields
 * preserved).  They fail against the current code, which writes only
 * { name, modalities } and overwrites existing model entries.
 *
 * The tests will turn green once e1.02 (converter) and e1.03 (controlled
 * merge) are implemented.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
// The route imports `fs` as a default import from "fs/promises".
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ _data: data, _status: init?.status ?? 200 }),
  },
}));

import fs from "fs/promises";
import { POST } from "@/app/api/cli-tools/opencode-settings/route.js";

// ── Helpers ──────────────────────────────────────────────────────────

function mockRequest(body) {
  return { json: () => Promise.resolve(body) };
}

/** Extract the config object that was passed to fs.writeFile. */
function getWrittenConfig() {
  const call = fs.writeFile.mock.calls[0];
  if (!call) throw new Error("fs.writeFile was not called");
  return JSON.parse(call[1]); // [path, content]
}

// ── Tests ────────────────────────────────────────────────────────────

describe("OpenCode setup route — characterization (9r-ocmr.e1.01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    // Default: no existing config on disk
    fs.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  });

  // ── REQ-001 / VAL-001: limit metadata ───────────────────────────

  it("should write limit.context/input/output for known models", async () => {
    await POST(
      mockRequest({
        baseUrl: "http://localhost:20128",
        apiKey: "sk_test",
        models: ["claude-opus-4.6"],
      }),
    );

    const config = getWrittenConfig();
    const modelEntry = config.provider?.["9router"]?.models?.["claude-opus-4.6"];

    expect(modelEntry).toBeDefined();
    // Current code omits `limit` entirely — this captures the gap.
    expect(modelEntry.limit).toBeDefined();
    expect(modelEntry.limit.context).toBeGreaterThan(0);
    expect(modelEntry.limit.input).toBeGreaterThan(0);
    expect(modelEntry.limit.output).toBeGreaterThan(0);
  });

  // ── REQ-003 / VAL-003: field preservation on re-run ────────────

  it("should preserve existing user limit, options, headers, variants, and unknown fields", async () => {
    const existingConfig = {
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://old:20128/v1", apiKey: "sk_old" },
          models: {
            "claude-opus-4.6": {
              name: "claude-opus-4.6",
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 500000, input: 500000, output: 64000 },
              options: { temperature: 0.5 },
              headers: { "X-Custom": "value" },
              variants: { low: { reasoningEffort: "low", customSetting: "keep" } },
              customField: "should-survive",
            },
          },
        },
      },
    };
    fs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

    await POST(
      mockRequest({
        baseUrl: "http://localhost:20128",
        apiKey: "sk_new",
        models: ["claude-opus-4.6"],
      }),
    );

    const config = getWrittenConfig();
    const modelEntry = config.provider?.["9router"]?.models?.["claude-opus-4.6"];

    expect(modelEntry).toBeDefined();
    // Current code overwrites the entire model entry — these capture the gap.
    expect(modelEntry.limit).toEqual({ context: 500000, input: 500000, output: 64000 });
    expect(modelEntry.options).toEqual({ temperature: 0.5 });
    expect(modelEntry.headers).toEqual({ "X-Custom": "value" });
    // Variants merge: existing wins on key conflict, generated fills blanks.
    expect(modelEntry.variants.low).toEqual({ reasoningEffort: "low", customSetting: "keep" });
    expect(modelEntry.variants.medium).toEqual({ reasoningEffort: "medium" });
    expect(modelEntry.variants.high).toEqual({ reasoningEffort: "high" });
    expect(modelEntry.variants.max).toEqual({ reasoningEffort: "max" });
    expect(modelEntry.customField).toBe("should-survive");
  });

  // ── REQ-004 / VAL-004: capability flags (forward-looking) ──────

  it("should derive reasoning/tool_call/attachment from resolved capabilities", async () => {
    await POST(
      mockRequest({
        baseUrl: "http://localhost:20128",
        apiKey: "sk_test",
        models: ["claude-opus-4.6"],
      }),
    );

    const config = getWrittenConfig();
    const modelEntry = config.provider?.["9router"]?.models?.["claude-opus-4.6"];

    expect(modelEntry).toBeDefined();
    // claude-opus-4.6 is reasoning-capable per the resolver.
    expect(modelEntry.reasoning).toBe(true);
    // tools defaults to true.
    expect(modelEntry.tool_call).toBe(true);
  });
});
