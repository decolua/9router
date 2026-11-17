import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import * as upstream from "../../open-sse/utils/proxyFetch.js";

const captures = [];
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected external fetch"); });
});
afterEach(() => vi.restoreAllMocks());
for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
  for (const prefix of ["cx", "codex"]) {
    for (const effort of [null, "high"]) {
      for (const search of [false, true]) {
        it(`${prefix}/${id} effort=${effort} search=${search}: exact upstream payload capture`, async () => {
          const info = await getModelInfoCore(`${prefix}/${id}`);
          expect(info).toEqual({ provider: "codex", model: id });
          const mock = vi.spyOn(upstream, "proxyAwareFetch").mockImplementation(async (url, init) => {
            const body = JSON.parse(init.body);
            expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
            expect(body.model).toBe(id);
            expect(init.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
            expect(body.reasoning).toEqual({ effort: effort || "low", summary: "auto" });
            expect(body.input).toContainEqual({ type: "reasoning", encrypted_content: "gAAAAA_fixture_reasoning", summary: [{ type: "summary_text", text: "Fixture reasoning summary" }] });
            expect(body.input).toContainEqual({ type: "function_call_output", call_id: "call_fixture", output: "fixture result" });
            const captured = { scenario: `${prefix}/${id}:${effort}:${search}`, url, method: init.method, headers: init.headers, body };
            captures.push(captured);
            return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
          });
          await new CodexExecutor().execute({ model: info.model, stream: true,
            credentials: { connectionId: "parity-fixture", accessToken: "oauth-fixture", providerSpecificData: {} },
            body: { model: info.model, prompt_cache_key: "parity-fixture", instructions: "Fixture instructions",
              input: [{ type: "reasoning", id: "rs_fixture", encrypted_content: "gAAAAA_fixture_reasoning", summary: [{ type: "summary_text", text: "Fixture reasoning summary" }] },
                { type: "function_call", call_id: "call_fixture", name: "run", arguments: "{}" },
                { type: "function_call_output", call_id: "call_fixture", output: "fixture result" }],
              tools: [{ type: "function", name: "run", parameters: { type: "object", properties: {} } }, ...(search ? [{ type: "web_search" }] : [])],
              ...(effort ? { reasoning: { effort } } : {}),
            },
          });
          expect(mock).toHaveBeenCalledTimes(1);
        });
      }
    }
  }
}
it("exports all 16 payloads without concealing body differences", () => {
  expect(captures).toHaveLength(16);
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const sample = canonical(captures);
  const changed = structuredClone(captures);
  changed[0].body.model = "different-model";
  expect(canonical(changed)).not.toEqual(sample);
  if (process.env.GPT62_PARITY_OUTPUT) writeFileSync(process.env.GPT62_PARITY_OUTPUT, JSON.stringify(sample, null, 2) + "\n", { flag: "wx" });
});
