import { describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../open-sse/config/appConstants.js";

const model = "claude-sonnet-5-5";
const key = { apiKey: "sk-ant-api-test", rawHeaders: { "anthropic-beta": "claude-code-20250219,context-management-2025-06-27" } };
const official = [
  ["anthropic", {}],
  ["anthropic", { baseUrl: "https://unused.example/v1" }],
  ["anthropic-compatible-official", {}],
  ["anthropic-compatible-official", { baseUrl: "https://api.anthropic.com/v1" }],
  ["anthropic-compatible-official", { baseUrl: "https://API.anthropic.com/v1" }],
];

describe("official Anthropic API-key identity (#4739)", () => {
  it.each(official)("removes Claude Code identity for %s at %j", (provider, providerSpecificData) => {
    const credentials = { ...key, providerSpecificData };
    const executor = new DefaultExecutor(provider);
    const body = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, model, {
      messages: [{ role: "system", content: "Keep my instructions." }, { role: "user", content: "Hello" }],
    }, false, credentials, provider);
    const original = structuredClone(body);
    const outbound = executor.transformRequest(model, body, false, credentials);
    expect(outbound.system.some(block => block.text === CLAUDE_SYSTEM_PROMPT)).toBe(false);
    expect(outbound.system.at(-1).text).toBe("Keep my instructions.");
    expect(outbound.system.at(-1).cache_control).toEqual(body.system.at(-1).cache_control);
    expect(body).toEqual(original);
    const headers = executor.buildHeaders(credentials, false, undefined, model, outbound);
    const normalized = new Headers(headers);
    expect(normalized.get("anthropic-beta")).not.toContain("claude-code-20250219");
    expect(normalized.get("anthropic-beta")).toContain("context-management-2025-06-27");
    expect(normalized.get("x-api-key")).toBe(key.apiKey);
    expect(normalized.get("authorization")).toBeNull();
    expect(normalized.get("anthropic-version")).toBe("2023-06-01");
  });

  it.each([
    [CLAUDE_SYSTEM_PROMPT, undefined],
    [`${CLAUDE_SYSTEM_PROMPT}\nKeep my instructions.`, "Keep my instructions."],
    [`${CLAUDE_SYSTEM_PROMPT}\r\nKeep my instructions.\r\n`, "Keep my instructions.\r\n"],
    [[{ type: "text", text: CLAUDE_SYSTEM_PROMPT }], undefined],
    [[{ type: "text", text: CLAUDE_SYSTEM_PROMPT }, { type: "text", text: "Keep my instructions.", cache_control: { type: "ephemeral" } }],
      [{ type: "text", text: "Keep my instructions.", cache_control: { type: "ephemeral" } }]],
    [[{ type: "text", text: "x-anthropic-billing-header: cc_version=test;" }, { type: "text", text: CLAUDE_SYSTEM_PROMPT }, { type: "text", text: "Keep my instructions." }],
      [{ type: "text", text: "x-anthropic-billing-header: cc_version=test;" }, { type: "text", text: "Keep my instructions." }]],
    [`x-anthropic-billing-header: cc_version=test;\n${CLAUDE_SYSTEM_PROMPT}\nKeep my instructions.`,
      "x-anthropic-billing-header: cc_version=test;\nKeep my instructions."],
  ])("sanitizes native Claude system input without translation: %j", (system, expected) => {
    const body = { system, messages: [{ role: "user", content: CLAUDE_SYSTEM_PROMPT }] };
    const original = structuredClone(body);
    const result = new DefaultExecutor("anthropic").transformRequest(model, body, false, key);
    expect(result.system).toEqual(expected);
    expect(result.messages).toEqual(original.messages);
    expect(body).toEqual(original);
  });

  it.each([
    `Instructions quoting ${CLAUDE_SYSTEM_PROMPT}`,
    `Keep my instructions.\n${CLAUDE_SYSTEM_PROMPT}`,
    `${CLAUDE_SYSTEM_PROMPT} This is part of a longer instruction.`,
    [{ type: "text", text: "Keep my instructions." }, { type: "text", text: CLAUDE_SYSTEM_PROMPT }],
    [],
    [{ type: "text", text: "", cache_control: { type: "ephemeral" } }],
  ])("preserves identity mentions in actual instructions: %j", (system) => {
    const body = { system, messages: [{ role: "user", content: "Hello" }] };
    expect(new DefaultExecutor("anthropic").transformRequest(model, body, false, key).system).toEqual(system);
  });

  it.each(["https://gateway.example/v1", "https://api.anthropic.com.example/v1"])(
    "preserves third-party body and gateway authentication for %s", (baseUrl) => {
      const credentials = { ...key, providerSpecificData: { baseUrl } };
      const executor = new DefaultExecutor("anthropic-compatible-gateway");
      const body = { system: CLAUDE_SYSTEM_PROMPT, messages: [] };
      expect(executor.transformRequest(model, body, false, credentials)).toEqual(body);
      const headers = new Headers(executor.buildHeaders(credentials, false, undefined, model));
      expect(headers.get("authorization")).toBe(`Bearer ${key.apiKey}`);
      expect(headers.get("anthropic-beta")).not.toContain("claude-code-20250219");
    }
  );

  it.each(["anthropic-beta", "Anthropic-Beta"])("cleans identity headers without dropping unrelated %s flags", (betaName) => {
    const headers = new Headers(new DefaultExecutor("anthropic-compatible-official").buildHeaders({
      ...key,
      runtimeTransport: { headers: {
        [betaName]: "claude-code-20250219,context-1m-2025-08-07",
        "x-app": "cli", "Anthropic-Dangerous-Direct-Browser-Access": "true",
      } },
    }, false, undefined, model));
    expect(headers.get("anthropic-beta")).not.toContain("claude-code-20250219");
    expect(headers.get("anthropic-beta")).toContain("context-1m-2025-08-07");
    expect(headers.get("anthropic-beta").split(",").map(flag => flag.trim())
      .filter(flag => flag === "context-1m-2025-08-07")).toHaveLength(1);
    expect(headers.get("x-app")).toBeNull();
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBeNull();
  });

  it.each([
    ["https://gateway.example/v1", "https://api.anthropic.com/v1/messages", true],
    ["https://api.anthropic.com/v1", "https://gateway.example/v1/messages", false],
  ])("classifies the actual runtime destination instead of %s", async (baseUrl, runtimeUrl, isOfficial) => {
    const executor = new DefaultExecutor("anthropic-compatible-runtime");
    const credentials = { ...key, providerSpecificData: { baseUrl }, runtimeTransport: { baseUrl: runtimeUrl } };
    const body = { system: CLAUDE_SYSTEM_PROMPT, messages: [{ role: "user", content: "Hello" }] };
    const directFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    await executor.execute({ model, body, stream: false, credentials, directFetch });
    expect(directFetch).toHaveBeenCalledOnce();
    const [url, options] = directFetch.mock.calls[0];
    expect(url).toBe(runtimeUrl);
    expect(JSON.parse(options.body).system).toBe(isOfficial ? undefined : CLAUDE_SYSTEM_PROMPT);
    expect(new Headers(options.headers).get("authorization")).toBe(isOfficial ? null : `Bearer ${key.apiKey}`);
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE])("sends a clean final request for %s input", async (sourceFormat) => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const credentials = { ...key, providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" } };
    const input = sourceFormat === FORMATS.OPENAI
      ? { messages: [{ role: "system", content: "Keep my instructions." }, { role: "user", content: "Hello" }] }
      : { system: [{ type: "text", text: CLAUDE_SYSTEM_PROMPT }, { type: "text", text: "Keep my instructions." }], messages: [{ role: "user", content: "Hello" }] };
    // Native Claude passthrough skips translation; both paths still use the executor.
    const body = sourceFormat === FORMATS.OPENAI
      ? translateRequest(sourceFormat, FORMATS.CLAUDE, model, input, false, credentials, executor.provider) : input;
    const directFetch = vi.fn(async () => new Response(JSON.stringify({ content: [] }), { status: 200 }));
    const result = await executor.execute({ model, body, stream: false, credentials, directFetch });
    expect(result.response.status).toBe(200);
    expect(directFetch).toHaveBeenCalledOnce();
    const [url, options] = directFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const sent = JSON.parse(options.body);
    expect(sent.system.map(block => block.text)).toEqual(["Keep my instructions."]);
    expect(new Headers(options.headers).get("anthropic-beta")).not.toContain("claude-code-20250219");
  });

  it.each([
    ["claude", { accessToken: "sk-ant-oat-test", rawHeaders: key.rawHeaders }],
    ["anthropic", { accessToken: "sk-ant-oat-test", rawHeaders: key.rawHeaders }],
    ["anthropic-compatible-official", { accessToken: "sk-ant-oat-test", rawHeaders: key.rawHeaders }],
    ["anthropic-compatible-official", { apiKey: "sk-ant-oat-test", rawHeaders: key.rawHeaders }],
  ])("keeps OAuth identity for %s (%j)", (provider, credentials) => {
    const executor = new DefaultExecutor(provider);
    const body = { system: CLAUDE_SYSTEM_PROMPT, messages: [] };
    expect(executor.transformRequest(model, body, false, credentials)).toEqual(body);
    const headers = new Headers(executor.buildHeaders(credentials, false, undefined, model));
    expect(headers.get("anthropic-beta")).toContain("claude-code-20250219");
  });
});
