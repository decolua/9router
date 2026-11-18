import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { applyCloaking } from "../../open-sse/utils/claudeCloaking.js";

const header = "x-anthropic-billing-header: cc_version=2.1.322; cc_entrypoint=cli;";
const instructions = "Follow the project instructions.\nKeep answers concise.";
const convert = (content, extra = {}) => openaiToClaudeRequest("claude-opus-4-8", {
  messages: [{ role: "system", content }, { role: "user", content: "Hello" }],
  ...extra,
}, false);

describe("OpenAI to Claude billing header cache stability (#5739)", () => {
  it.each([
    ["string", (line) => `${line}\n${instructions}`, instructions],
    ["CRLF and mixed case", (line) => `${line.toUpperCase()}\r\n${instructions}`, instructions],
    ["separate content blocks", (line) => [
      { type: "text", text: line }, { type: "text", text: instructions },
    ], instructions],
    ["a later content block", (line) => [
      { type: "text", text: "Stable prefix" }, { type: "text", text: `${line}\n${instructions}` },
    ], `Stable prefix\n${instructions}`],
  ])("keeps cached system blocks identical across header variants: %s", (_, makeContent, expectedText) => {
    const expected = convert(makeContent(header)).system;
    for (const line of [
      `${header} cc_workload=cron;`,
      `${header} cc_is_subagent=true;`,
      header.replace("2.1.322", "2.1.323"),
    ]) {
      expect(convert(makeContent(line)).system).toEqual(expected);
    }
    expect(expected[1].text).toBe(expectedText);
    expect(expected[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it.each([
    { content: header }, { content: `${header}\n` },
    { content: [{ type: "text", text: header }] },
  ])(
    "omits a billing-only client system block (%j)", ({ content }) => {
      expect(convert(content).system).toEqual(convert(undefined).system);
    }
  );

  it("strips each system message without mutating input or user text", () => {
    const messages = [
      { role: "system", content: header },
      { role: "system", content: "Stable prefix" },
      { role: "system", content: [{ type: "text", text: `${header}\n${instructions}` }] },
      { role: "user", content: `${header}\nExplain this header.` },
    ];
    const original = structuredClone(messages);
    const result = convert(undefined, { messages });
    expect(result.system[1].text).toBe(`Stable prefix\n${instructions}`);
    expect(result.messages[0].content[0].text).toBe(messages[3].content);
    expect(messages).toEqual(original);
  });

  it("preserves billing-header mentions inside actual instructions", () => {
    const text = `Document ${header}\n${header}\n${instructions}`;
    expect(convert(text).system[1].text).toBe(text);
  });

  it("retains response format instructions when the client system is billing-only", () => {
    const extra = { response_format: { type: "json_object" } };
    expect(convert(header, extra).system).toEqual(convert(undefined, extra).system);
    expect(convert(header, extra).system[1].text).toContain("Respond ONLY with a JSON object");
  });

  it("keeps the proxy OAuth billing header as the only billing system block", () => {
    const result = applyCloaking(convert(`${header}\n${instructions}`), "sk-ant-oat-test", "session-id");
    expect(result.system[0].text).toMatch(/^x-anthropic-billing-header:/);
    expect(result.system[0].cache_control).toBeUndefined();
    expect(result.system.slice(1).some(block => block.text.includes("x-anthropic-billing-header:"))).toBe(false);
    expect(result.system.at(-1).text).toBe(instructions);
  });
});
