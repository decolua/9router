import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "open-sse/services/combo.js";
import { CUSTOM_JSON_NO_FALLBACK } from "open-sse/config/customJson.js";

describe("custom JSON business requests in fallback combos", () => {
  it.each([200, 502, 503])("does not repeat a business operation after status %s", async (status) => {
    const response = Response.json({ choices: [{ message: { content: "" } }] }, { status });
    response[CUSTOM_JSON_NO_FALLBACK] = true;
    const single = vi.fn(async () => response);
    const result = await handleComboChat({ body: { messages: [] }, models: ["business/a", "business/b"], handleSingleModel: single, log: { info: vi.fn(), warn: vi.fn() } });
    expect(result).toBe(response);
    expect(single).toHaveBeenCalledTimes(1);
  });
});
