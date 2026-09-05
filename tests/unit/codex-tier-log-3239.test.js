import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function emptySseResponse() {
  return new Response(new ReadableStream({
    start(controller) {
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Codex effective service tier logging (#3239)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["fast", "TIER:priority"],
    [undefined, "TIER:default"],
  ])("logs the final transformed tier for %s", async (serviceTier, expected) => {
    vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(function execute(args) {
      return Promise.resolve({
        response: emptySseResponse(),
        transformedBody: this.transformRequest(args.model, { ...args.body }, true, {}),
      });
    });
    const info = vi.fn();
    const executor = new CodexExecutor();

    await executor.execute({
      model: "gpt-5.6-sol",
      body: { input: "hello", service_tier: serviceTier },
      log: { info },
    });

    expect(info).toHaveBeenCalledWith("TIER", `CODEX | gpt-5.6-sol | ${expected}`);
  });
});
