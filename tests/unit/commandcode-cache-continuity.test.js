/**
 * CommandCode prompt-cache continuity.
 *
 * Upstream `/alpha/generate` keys its prompt cache on the session identity the
 * client sends (`x-session-id` header + envelope `threadId`): the official CLI
 * mints one random v4 UUID per conversation and reuses it for every turn. A
 * fresh id per request (the old `randomUUID()` in both places) makes every turn
 * look like a new conversation, so cache reads stayed at 0 across ~27k requests.
 *
 * These tests pin the replacement contract:
 *  - the id is conversation-stable (constant while a conversation appends)
 *  - the id is a real UUID (the envelope drops non-UUID threadIds)
 *  - the header carries the exact envelope id
 *  - a cache-read reported by upstream is translated into OpenAI usage
 */

import { describe, it, expect } from "vitest";
import {
  commandCodeThreadId,
  isCommandCodeThreadId,
} from "../../open-sse/utils/commandCodeSession.js";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";
import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

const MODEL = "deepseek/deepseek-v4.1-flash";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function conversation(turns) {
  return {
    messages: [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: "Fix the failing test." },
      ...turns,
    ],
  };
}

describe("commandCodeThreadId — conversation stability", () => {
  it("returns the same id for the same conversation", () => {
    expect(commandCodeThreadId(conversation([]))).toBe(commandCodeThreadId(conversation([])));
  });

  it("keeps the id when later turns append (the cache-continuity case)", () => {
    const firstTurn = commandCodeThreadId(conversation([]));
    const secondTurn = commandCodeThreadId(
      conversation([
        { role: "assistant", content: "Running the suite now." },
        { role: "user", content: "Any update?" },
      ]),
    );
    expect(secondTurn).toBe(firstTurn);
  });

  it("gives different ids to different conversations", () => {
    const a = commandCodeThreadId(conversation([]));
    const b = commandCodeThreadId({
      messages: [
        { role: "system", content: "You are a coding agent." },
        { role: "user", content: "Write a changelog entry." },
      ],
    });
    expect(b).not.toBe(a);
  });

  it("always produces a v4 UUID the envelope accepts", () => {
    for (const body of [
      conversation([]),
      { messages: [] },
      { messages: [{ role: "user", content: "hi" }] },
      { messages: [{ role: "user", content: "hi" }], prompt_cache_key: "not-a-uuid" },
      { system: "sys only" },
    ]) {
      const id = commandCodeThreadId(body);
      expect(isCommandCodeThreadId(id)).toBe(true);
      expect(id).toMatch(UUID_RE);
    }
  });

  it("reuses a UUID-shaped client session key verbatim", () => {
    const key = "11111111-2222-4333-8444-555555555555";
    expect(commandCodeThreadId({ ...conversation([]), prompt_cache_key: key })).toBe(key);
  });

  it("hashes a non-UUID client session key into a stable UUID", () => {
    const body = { ...conversation([]), prompt_cache_key: "opencode-conversation-42" };
    const id = commandCodeThreadId(body);
    expect(id).toMatch(UUID_RE);
    expect(commandCodeThreadId(body)).toBe(id);
  });

  it("reads Claude Code's session id out of metadata.user_id", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      metadata: { user_id: "user_abc_account__session_9f8e7d6c-1234-4abc-8def-0123456789ab" },
    };
    expect(commandCodeThreadId(body)).toBe("9f8e7d6c-1234-4abc-8def-0123456789ab");
  });
});

describe("openaiToCommandCodeRequest — threadId is stable per conversation", () => {
  it("keeps the same threadId across turns of one conversation", () => {
    const first = openaiToCommandCodeRequest(MODEL, conversation([]), true);
    const second = openaiToCommandCodeRequest(
      MODEL,
      conversation([
        { role: "assistant", content: "Done." },
        { role: "user", content: "Thanks." },
      ]),
      true,
    );
    expect(second.threadId).toBe(first.threadId);
    expect(isCommandCodeThreadId(first.threadId)).toBe(true);
  });
});

describe("CommandCodeExecutor.buildHeaders", () => {
  it("sends the envelope threadId as x-session-id", () => {
    const executor = new CommandCodeExecutor();
    const body = openaiToCommandCodeRequest(MODEL, conversation([]), true);
    const headers = executor.buildHeaders({ apiKey: "user_test" }, true, null, MODEL, body);
    expect(headers["x-session-id"]).toBe(body.threadId);
  });

  it("is stable across the requests of one conversation", () => {
    const executor = new CommandCodeExecutor();
    const body = openaiToCommandCodeRequest(MODEL, conversation([]), true);
    const first = executor.buildHeaders({}, true, null, MODEL, body);
    const second = executor.buildHeaders({}, true, null, MODEL, body);
    expect(second["x-session-id"]).toBe(first["x-session-id"]);
  });

  it("never emits the same session id for unrelated conversations", () => {
    const executor = new CommandCodeExecutor();
    const a = executor.buildHeaders(
      {},
      true,
      null,
      MODEL,
      openaiToCommandCodeRequest(MODEL, conversation([]), true),
    );
    const b = executor.buildHeaders(
      {},
      true,
      null,
      MODEL,
      openaiToCommandCodeRequest(
        MODEL,
        { messages: [{ role: "user", content: "unrelated prompt" }] },
        true,
      ),
    );
    expect(a["x-session-id"]).not.toBe(b["x-session-id"]);
  });
});

describe("commandcode usage — cache reads are reported", () => {
  it("maps AI SDK v5 cachedInputTokens to prompt_tokens_details.cached_tokens", () => {
    const usage = toOpenAIUsage(
      { inputTokens: 2043, outputTokens: 15, totalTokens: 2058, cachedInputTokens: 1984 },
      "commandcode",
    );
    expect(usage.prompt_tokens).toBe(2043);
    expect(usage.completion_tokens).toBe(15);
    expect(usage.prompt_tokens_details.cached_tokens).toBe(1984);
  });

  it("maps the nested inputTokenDetails.cacheReadTokens shape", () => {
    const usage = toOpenAIUsage(
      {
        inputTokens: 500,
        outputTokens: 4,
        totalTokens: 504,
        inputTokenDetails: { cacheReadTokens: 128 },
      },
      "commandcode",
    );
    expect(usage.prompt_tokens_details.cached_tokens).toBe(128);
  });

  it("omits the details object when upstream reports no cache read", () => {
    const usage = toOpenAIUsage(
      { inputTokens: 100, outputTokens: 2, totalTokens: 102 },
      "commandcode",
    );
    expect(usage.prompt_tokens_details).toBeUndefined();
  });
});
