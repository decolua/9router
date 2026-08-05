import { describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";
import { markModelUnavailable } from "../../open-sse/services/accountFallback.js";

const log = { info: vi.fn(), warn: vi.fn() };

describe("combo failure classification (#2951)", () => {
  it("does not replay an invalid request against every model", async () => {
    const invalid = new Response(JSON.stringify({ error: { message: "invalid_request_error" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const handleSingleModel = vi.fn(async () => invalid.clone());

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "bad" }] },
      models: ["nvidia/a", "nvidia/b"],
      handleSingleModel,
      log,
    });

    expect(response.status).toBe(400);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });

  it("skips a model already rejected as unsupported", async () => {
    markModelUnavailable("opencode", "retired-free");
    const handleSingleModel = vi.fn(async () => new Response("ok"));

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["opencode/retired-free", "nvidia/working"],
      handleSingleModel,
      log,
    });

    expect(response.status).toBe(200);
    expect(handleSingleModel).toHaveBeenCalledOnce();
    expect(handleSingleModel).toHaveBeenCalledWith(expect.anything(), "nvidia/working");
  });
});
