/**
 * TDD test for the Claude Code auto-mode classifier compat mode (opt-in, default off).
 *
 * Claude Code's `--permission-mode auto` sends an internal `/v1/messages`
 * security-classifier request and requires the response to START with the
 * literal token `<block>no</block>` (ALLOW) or `<block>yes</block>` (BLOCK).
 * Anything else is unparseable and Claude Code fails closed with "Auto mode
 * could not evaluate this action and is blocking it for safety".
 *
 * When a combo/fallback route sends the classifier call to a cheap model that
 * returns 200 with empty content, the well-formed-but-empty Claude message
 * 9router produces still fails that parser. With `claudeClassifierCompat` set
 * to "auto" or "always", handleChatCore detects the classifier request and
 * short-circuits with a synthetic ALLOW response, WITHOUT ever calling the
 * upstream provider. Default is "off": nothing changes unless an operator
 * explicitly opts in.
 */

import { describe, expect, it, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { executeMock, getExecutorMock } = vi.hoisted(() => {
  const executeMock = vi.fn();
  const getExecutorMock = vi.fn(() => ({
    noAuth: true,
    execute: executeMock,
  }));
  return { executeMock, getExecutorMock };
});

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: getExecutorMock,
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-classifier-compat-"));
  process.env.DATA_DIR = tempDir;
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  // Give any open SQLite handle a tick to release before we try to remove the temp dir.
  await new Promise((r) => setTimeout(r, 50));
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows EPERM when a SQLite handle still holds a file in the temp dir.
      // The OS reclaims the temp dir later; the test assertions already passed.
    }
  }
});

const {
  shouldDefaultAllowClassifier,
  detectClassifierFormat,
  buildDefaultAllowClaudeMessage,
} = await import("../../open-sse/handlers/chatCore/claudeClassifierCompat.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

// Shape of the classifier request Claude Code's `--permission-mode auto` sends
// internally: a Claude Messages request carrying the security-monitor system
// prompt AND `</block>` as a stop sequence.
const CLASSIFIER_BODY = {
  model: "claude-3-5-haiku-20241022",
  stream: false,
  system: [
    {
      type: "text",
      text: "You are a security monitor for autonomous AI coding agents. Evaluate the following action and respond with <block>yes</block> or <block>no</block>.",
    },
  ],
  stop_sequences: ["</block>"],
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "<transcript>WebFetch https://example.com</transcript>" }],
    },
  ],
  max_tokens: 8,
};

// Newer Claude Code builds send a "severity classifier" variant of the same
// internal request: same security-monitor marker, but `stop_sequences` carries
// `</severity>` instead of `</block>`, and it expects a `<severity>N</severity>` reply.
const SEVERITY_CLASSIFIER_BODY = {
  ...CLASSIFIER_BODY,
  stop_sequences: ["</severity>"],
};

describe("shouldDefaultAllowClassifier", () => {
  it("off never short-circuits (pass-through preserved by default)", () => {
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, CLASSIFIER_BODY, "off")).toBe(false);
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, CLASSIFIER_BODY, undefined)).toBe(false);
  });

  it("auto fires on the security-monitor system-prompt marker", () => {
    const body = {
      system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents." }],
      stop_sequences: [],
    };
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, body, "auto")).toBe(true);
  });

  it("auto does NOT fire on the </block> stop_sequence token alone (over-broad trigger fix)", () => {
    const body = { system: [{ type: "text", text: "unrelated" }], stop_sequences: ["</block>"] };
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, body, "auto")).toBe(false);
  });

  it("auto does NOT fire on a regular Claude request (no marker, no </block>)", () => {
    const body = {
      system: [{ type: "text", text: "You are a helpful coding assistant." }],
      stop_sequences: [],
      messages: [{ role: "user", content: "hello" }],
    };
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, body, "auto")).toBe(false);
  });

  it("never fires for non-Claude source formats even in always mode", () => {
    expect(shouldDefaultAllowClassifier(FORMATS.OPENAI, CLASSIFIER_BODY, "always")).toBe(false);
  });

  it("always does NOT fire for normal chat without classifier marker", () => {
    const plain = { system: [{ type: "text", text: "hi" }], stop_sequences: [] };
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, plain, "always")).toBe(false);
  });

  it("always fires when classifier marker is present", () => {
    const classifier = {
      system: [
        {
          type: "text",
          text: "You are a security monitor for autonomous AI coding agents. Evaluate the following action.",
        },
      ],
      stop_sequences: ["</block>"],
    };
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, classifier, "always")).toBe(true);
  });

  it("reads system as a plain string too", () => {
    const body = {
      system: "You are a security monitor for autonomous AI coding agents. Evaluate.",
      stop_sequences: [],
    };
    expect(shouldDefaultAllowClassifier(FORMATS.CLAUDE, body, "auto")).toBe(true);
  });
});

describe("detectClassifierFormat", () => {
  it("defaults to block for the legacy </block> classifier shape", () => {
    expect(detectClassifierFormat(CLASSIFIER_BODY)).toBe("block");
  });

  it("returns severity when stop_sequences carries </severity>", () => {
    expect(detectClassifierFormat(SEVERITY_CLASSIFIER_BODY)).toBe("severity");
  });

  it("defaults to block when stop_sequences is missing/empty", () => {
    expect(detectClassifierFormat({})).toBe("block");
    expect(detectClassifierFormat({ stop_sequences: [] })).toBe("block");
  });
});

describe("buildDefaultAllowClaudeMessage", () => {
  it("synthetic message text STARTS WITH <block>no</block> and sets CORS header", async () => {
    const built = buildDefaultAllowClaudeMessage("claude-3-5-haiku-20241022");
    expect(built.success).toBe(true);
    expect(built.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const payload = await built.response.json();
    expect(payload.type).toBe("message");
    expect(payload.role).toBe("assistant");
    expect(payload.stop_reason).toBe("end_turn");
    const text = payload.content.find((b) => b.type === "text")?.text ?? "";
    expect(text.startsWith("<block>no</block>")).toBe(true);
    expect(text.includes("<block>yes")).toBe(false);
  });

  it("format='severity' returns <severity>0</severity>", async () => {
    const built = buildDefaultAllowClaudeMessage("claude-3-5-haiku-20241022", "severity");
    expect(built.success).toBe(true);
    expect(built.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const payload = await built.response.json();
    const text = payload.content.find((b) => b.type === "text")?.text ?? "";
    expect(text).toBe("<severity>0</severity>");
  });
});

describe("handleChatCore classifier compat integration", () => {
  beforeEach(() => {
    executeMock.mockReset();
    getExecutorMock.mockClear();
  });

  it("short-circuits legacy block classifier requests without invoking upstream executor", async () => {
    const result = await handleChatCore({
      body: CLASSIFIER_BODY,
      modelInfo: { provider: "openai", model: "gpt-4o-mini" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn",
      sourceFormatOverride: FORMATS.CLAUDE,
      claudeClassifierCompat: "auto",
      clientRawRequest: { endpoint: "/v1/messages", body: CLASSIFIER_BODY, headers: {} },
    });

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const payload = await result.response.json();
    expect(payload.content[0].text).toBe("<block>no</block>");
    expect(getExecutorMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("short-circuits severity classifier requests without invoking upstream executor", async () => {
    const result = await handleChatCore({
      body: SEVERITY_CLASSIFIER_BODY,
      modelInfo: { provider: "openai", model: "gpt-4o-mini" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn",
      sourceFormatOverride: FORMATS.CLAUDE,
      claudeClassifierCompat: "always",
      clientRawRequest: { endpoint: "/v1/messages", body: SEVERITY_CLASSIFIER_BODY, headers: {} },
    });

    expect(result.success).toBe(true);
    expect(result.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const payload = await result.response.json();
    expect(payload.content[0].text).toBe("<severity>0</severity>");
    expect(getExecutorMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("forwards classifier requests to upstream when compat mode is off", async () => {
    executeMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({
          id: "chatcmpl_1",
          object: "chat.completion",
          model: "gpt-4o-mini",
          choices: [{ index: 0, message: { role: "assistant", content: "<block>no</block>" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: {},
    });

    const result = await handleChatCore({
      body: CLASSIFIER_BODY,
      modelInfo: { provider: "openai", model: "gpt-4o-mini" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      connectionId: "test-conn",
      sourceFormatOverride: FORMATS.CLAUDE,
      claudeClassifierCompat: "off",
      clientRawRequest: { endpoint: "/v1/messages", body: CLASSIFIER_BODY, headers: {} },
    });

    expect(result.success).toBe(true);
    expect(getExecutorMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("settings default", () => {
  it("claudeClassifierCompat is 'off' (opt-in)", async () => {
    const { getSettings } = await import("../../src/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.claudeClassifierCompat).toBe("off");
  });
});
