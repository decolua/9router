import { afterEach, describe, expect, it, vi } from "vitest";

import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor, stripRejectedCodexInputNamespaces } from "../../open-sse/executors/codex.js";

afterEach(() => vi.restoreAllMocks());

describe("Codex rejected input namespace compatibility", () => {
  it("removes namespace only from input history", () => {
    const body = {
      input: [{ type: "function_call", namespace: "collaboration", name: "spawn_agent" }],
      tools: [{ type: "namespace", name: "collaboration", tools: [] }],
    };

    expect(stripRejectedCodexInputNamespaces(body)).toBe(true);
    expect(body.input[0].namespace).toBeUndefined();
    expect(body.tools[0].type).toBe("namespace");
  });

  it("retries once after the exact upstream schema error", async () => {
    const executeSpy = vi.spyOn(BaseExecutor.prototype, "execute")
      .mockResolvedValueOnce({
        response: new Response(JSON.stringify({
          error: { message: "Unknown parameter: 'input[150].namespace'.", type: "invalid_request_error", code: "unknown_parameter" },
        }), { status: 400 }),
      })
      .mockResolvedValueOnce({ response: new Response("ok", { status: 200 }) });
    const executor = new CodexExecutor();
    executor._peekSseTransientError = vi.fn().mockResolvedValue({ matched: null, replacementBody: null });
    const body = {
      input: [{ type: "function_call", namespace: "collaboration", name: "spawn_agent" }],
      tools: [{ type: "namespace", name: "collaboration", tools: [] }],
    };

    const result = await executor.execute({ body, credentials: {}, log: { warn: vi.fn() } });

    expect(result.response.status).toBe(200);
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(body.input[0].namespace).toBeUndefined();
    expect(body.tools[0].type).toBe("namespace");
  });

  it("does not retry unrelated 400 responses", async () => {
    const executeSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response("unsupported model", { status: 400 }),
    });
    const executor = new CodexExecutor();
    executor._peekSseTransientError = vi.fn().mockResolvedValue({ matched: null, replacementBody: null });

    await executor.execute({
      body: { input: [{ type: "function_call", namespace: "collaboration" }] },
      credentials: {},
      log: { warn: vi.fn() },
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});
