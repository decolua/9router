import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import * as proxyFetch from "../../open-sse/utils/proxyFetch.js";

const credentials = { connectionId: "fixture", accessToken: "codex-fixture" };
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected external fetch"); });
});
afterEach(() => vi.restoreAllMocks());

for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
  for (const prefix of ["cx", "codex"]) {
    for (const search of [false, true]) {
      it(`${prefix}/${id}: Responses transport${search ? " with web_search" : ""}`, async () => {
        const catalog = getProviderModels("cx").find(model => model.id === id);
        expect(catalog).toBeDefined();
        const info = await getModelInfoCore(`${prefix}/${catalog.id}`);
        expect(info).toEqual({ provider: "codex", model: id });
        const tools = [{ type: "function", name: "run", parameters: { type: "object", properties: {} } }];
        if (search) tools.push({ type: "web_search" });
        const fetchMock = vi.spyOn(proxyFetch, "proxyAwareFetch").mockImplementation(async (url, options) => {
          expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
          expect(options.headers.Authorization).toBe("Bearer codex-fixture");
          expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
          const body = JSON.parse(options.body);
          expect(body.model).toBe(id);
          expect(body.stream).toBe(true);
          expect(body.store).toBe(false);
          expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
          expect(body.tools).toEqual(tools);
          expect(body.input).toContainEqual({ type: "function_call", call_id: "call_1", name: "run", arguments: "{}" });
          expect(body.input).toContainEqual({ type: "function_call_output", call_id: "call_1", output: "fixture result" });
          expect(body.input.some(item => item.type === "additional_tools")).toBe(false);
          return new Response('data: {"type":"response.completed","response":{"id":"resp_fixture","status":"completed","output":[]}}\n\n', { headers: { "content-type": "text/event-stream" } });
        });
        const result = await new CodexExecutor().execute({
          model: info.model,
          body: {
            model: info.model,
            input: [
              { type: "message", role: "user", content: [{ type: "input_text", text: "Use run" }] },
              { type: "function_call", call_id: "call_1", name: "run", arguments: "{}" },
              { type: "function_call_output", call_id: "call_1", output: "fixture result" },
            ],
            tools,
            reasoning: { effort: "high" },
          },
          stream: true,
          credentials,
        });
        expect(result.response.status).toBe(200);
        expect(await result.response.text()).toContain('"status":"completed"');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    }
  }
}
