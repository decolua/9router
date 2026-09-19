// Issue #3010 — Dashboard "Test" button fails for reasoning models because of a
// tiny max_tokens probe. pingModelByKind must use a sane budget (1024) and treat a
// reasoning-only (length-limited) response as a successful connection.
//
// pingModelByKind drives the chat probe through handleChat in-process (not fetch),
// so we mock handleChat and assert on the Request it receives. The heavy Next.js
// deps (@/lib/localDb, etc.) are mocked so the module resolves under raw vitest.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy Next.js-dependent imports BEFORE importing ping.js.
vi.mock("@/lib/localDb", () => ({ getApiKeys: vi.fn(async () => [{ key: "test-key", isActive: true }]) }));
vi.mock("@/shared/constants/config", () => ({ UPDATER_CONFIG: { appPort: 20127 } }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));

const handleChatMock = vi.hoisted(() => vi.fn());
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: handleChatMock }));

const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");

describe("pingModelByKind reasoning models (#3010)", () => {
  let capturedRequest;

  beforeEach(() => {
    capturedRequest = null;
    handleChatMock.mockReset();
  });

  function jsonResponse(obj) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(obj),
      json: async () => obj,
    };
  }

  // Capture the Request pingModelByKind hands to handleChat, then reply with obj.
  function replyWith(obj) {
    handleChatMock.mockImplementation(async (request) => {
      capturedRequest = request;
      return jsonResponse(obj);
    });
  }

  it("uses a 1024-token budget for the chat completions probe", async () => {
    replyWith({ choices: [{ message: { content: "Hi there!" } }] });

    await pingModelByKind("cline-pass/kimi-k3", "llm", "http://127.0.0.1:20127");

    expect(handleChatMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(await capturedRequest.text());
    expect(body.max_tokens).toBe(1024);
  });

  it("treats a reasoning-only (length-limited) response as ok:true", async () => {
    replyWith({
      choices: [
        {
          finish_reason: "length",
          message: { content: "", reasoning: "The user said hi — a simple greeting..." },
        },
      ],
    });

    const result = await pingModelByKind("cline-pass/kimi-k3", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/reasoning-only/);
  });

  it("still fails when there are no choices and no reasoning", async () => {
    replyWith({ choices: [] });
    const result = await pingModelByKind("some/model", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no completion choices/);
  });

  it("passes a normal answer with the larger budget", async () => {
    replyWith({ choices: [{ message: { content: "Hello!" } }] });
    const result = await pingModelByKind("openai/gpt-4o", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
  });
});
