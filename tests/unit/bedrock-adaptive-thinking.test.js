/**
 * Native Bedrock (SigV4) Claude Fable 5.1 rejects legacy thinking:
 * 400 `"thinking.type.enabled" is not supported for this model. Use
 * "thinking.type.adaptive" and "output_config.effort"`.
 * The Bedrock id `us.anthropic.claude-fable-5-1` missed the exact capability key and
 * fell to the *claude*fable* pattern (claude-budget). Fix is capability-driven:
 * older Claude models keep budget thinking. All HTTP is mocked — no live inference.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock, default: fetchMock }));
const signSpy = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/awsSigv4.js", async (orig) => {
  const real = await orig();
  return { ...real, signAwsRequest: (opts) => { signSpy(opts.body); return real.signAwsRequest(opts); } };
});

import { translateRequest } from "../../open-sse/translator/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const FABLE = "us.anthropic.claude-fable-5-1";
const CREDS = { apiKey: "test-secret", providerSpecificData: { accessKeyId: "AKIDTEST", region: "us-east-1" } };
const TOOLS = [{ name: "get_weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }];
const MULTI_TURN = [
  { role: "user", content: "weather in Paris?" },
  { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "18C" }, { type: "text", text: "and tomorrow?" }] },
];

const claude = (model, extra, source = FORMATS.CLAUDE) =>
  translateRequest(source, FORMATS.CLAUDE, model, { model, max_tokens: 32000, messages: MULTI_TURN, tools: TOOLS, ...extra }, true, CREDS, "bedrock");

afterEach(() => { fetchMock.mockReset(); signSpy.mockReset(); });

describe("Bedrock capability resolution", () => {
  it.each([
    [FABLE, "claude-adaptive", false],
    ["us.anthropic.claude-mythos-5-1", "claude-adaptive", false],
    ["us.anthropic.claude-opus-4-7", "claude-adaptive", true],
    ["us.anthropic.claude-opus-4-8", "claude-adaptive", true],
    ["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-budget", true],
    ["us.anthropic.claude-opus-4-5-20251101-v1:0", "claude-budget", true],
    ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "claude-budget", true],
  ])("%s → %s", (model, fmt, canDisable) => {
    const caps = getCapabilitiesForModel("bedrock", model);
    expect(caps.thinkingFormat).toBe(fmt);
    expect(caps.thinkingCanDisable).toBe(canDisable);
  });
});

describe("Fable 5.1 on Bedrock: enabled → adaptive", () => {
  it("drops thinking.enabled + budget_tokens and sets output_config.effort", () => {
    const out = claude(FABLE, { thinking: { type: "enabled", budget_tokens: 10000 } });
    expect(out.thinking).toBeUndefined(); // always-on model: omitted == adaptive
    expect(JSON.stringify(out)).not.toContain("budget_tokens");
    expect(out.output_config).toEqual({ effort: "medium" });
  });

  it("keeps a valid explicit output_config.effort", () => {
    const out = claude(FABLE, { thinking: { type: "adaptive" }, output_config: { effort: "xhigh" } });
    expect(out.output_config.effort).toBe("xhigh");
    expect(out.thinking?.type).not.toBe("enabled");
  });

  it("maps reasoning_effort from an OpenAI client into output_config.effort", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, FABLE,
      { model: FABLE, messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" }, true, CREDS, "bedrock");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(out.thinking).not.toHaveProperty("budget_tokens");
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("disabled cannot be honoured (always-on) → lowest effort, no disabled block", () => {
    const out = claude(FABLE, { thinking: { type: "disabled" } });
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toEqual({ effort: "low" });
  });

  it("provider-level thinking 'on' (chatCore injects enabled/10000) is normalized too", () => {
    const out = claude(FABLE, { thinking: { type: "enabled", budget_tokens: 10000 } }, FORMATS.OPENAI);
    expect(out.thinking).toBeUndefined();
    expect(out.output_config.effort).toBe("medium");
  });

  it("preserves tools and multi-turn tool history", () => {
    const out = claude(FABLE, { thinking: { type: "enabled", budget_tokens: 10000 } });
    expect(out.tools.map((t) => t.name)).toEqual(["get_weather"]);
    const blocks = out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    expect(blocks.some((b) => b.type === "tool_use" && b.id === "toolu_1")).toBe(true);
    expect(blocks.some((b) => b.type === "tool_result" && b.tool_use_id === "toolu_1")).toBe(true);
  });

  it("combo retry reusing the same client body cannot re-inject enabled thinking", () => {
    const body = { model: FABLE, max_tokens: 32000, messages: MULTI_TURN, thinking: { type: "enabled", budget_tokens: 10000 } };
    for (let i = 0; i < 2; i++) {
      const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, FABLE, structuredClone(body), true, CREDS, "bedrock");
      expect(out.thinking).toBeUndefined();
      expect(out.output_config.effort).toBe("medium");
    }
  });
});

describe("older Claude models are unchanged", () => {
  it.each(["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "us.anthropic.claude-haiku-4-5-20251001-v1:0"])("%s keeps enabled + budget_tokens", (model) => {
    const out = claude(model, { thinking: { type: "enabled", budget_tokens: 10000 } });
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
    expect(out.output_config).toBeUndefined();
  });

  it("Opus 4.7 (dashed Bedrock id) gets adaptive and can still disable", () => {
    expect(claude("us.anthropic.claude-opus-4-7", { thinking: { type: "enabled", budget_tokens: 10000 } }).thinking).toEqual({ type: "adaptive" });
    expect(claude("us.anthropic.claude-opus-4-7", { thinking: { type: "disabled" } }).thinking).toEqual({ type: "disabled" });
  });
});

describe("Bedrock executor: transform happens before SigV4 signing (mocked fetch)", () => {
  it.each([[true, "invoke-with-response-stream"], [false, "invoke"]])("stream=%s", async (stream, action) => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const body = claude(FABLE, { thinking: { type: "enabled", budget_tokens: 10000 } });
    await getExecutor("bedrock").execute({ model: FABLE, body, stream, credentials: CREDS });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://bedrock-runtime.us-east-1.amazonaws.com/model/${FABLE}/${action}`);
    const sent = JSON.parse(init.body);
    expect(sent.thinking).toBeUndefined();
    expect(sent.output_config).toEqual({ effort: "medium" });
    expect(sent).not.toHaveProperty("model");
    expect(sent).not.toHaveProperty("stream");
    // The signed bytes are exactly the bytes sent — nothing mutates the body after signing.
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(signSpy.mock.calls[0][0]).toBe(init.body);
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/us-east-1\/bedrock\//);
  });

  it("refuses a non-Anthropic model on the Claude Bedrock provider (routing isolation)", () => {
    expect(() => getExecutor("bedrock").buildUrl("openai.gpt-6-astra", true, 0, CREDS)).toThrow(/not supported/);
  });
});
