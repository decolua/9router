// Claude Code 2.1.270 sends output_config.format (json_schema) on its session-title
// request. Claude-compatible gateways (e.g. Alibaba MaaS /apps/anthropic) reject it
// with "response_format type is unavailable now", locking the connection for 30s
// and failing every subsequent request. prepareClaudeRequest must strip the format
// for non-official-Anthropic providers while keeping effort.
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const titleGenBody = () => ({
  model: "deepseek-v4.1-flash",
  max_tokens: 128000,
  stream: true,
  system: [{ type: "text", text: "sys" }],
  messages: [{ role: "user", content: [{ type: "text", text: "name this session" }] }],
  output_config: {
    effort: "high",
    format: { type: "json_schema", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  },
});

describe("output_config.format strip for Claude-compatible gateways", () => {
  it("strips format and keeps effort for anthropic-compatible provider", () => {
    const out = prepareClaudeRequest(titleGenBody(), "anthropic-compatible-alibaba-claude");
    expect(out.output_config).toEqual({ effort: "high" });
    expect(JSON.stringify(out)).not.toContain("json_schema");
  });

  it("drops output_config entirely when format was the only field", () => {
    const body = titleGenBody();
    delete body.output_config.effort;
    const out = prepareClaudeRequest(body, "anthropic-compatible-alibaba-claude");
    expect(out.output_config).toBeUndefined();
  });

  it("keeps output_config.format for official anthropic provider", () => {
    const out = prepareClaudeRequest(titleGenBody(), "anthropic");
    expect(out.output_config.format).toEqual(expect.objectContaining({ type: "json_schema" }));
  });

  it("keeps full output_config when dropOutputConfig quirk applies (minimax precedence)", () => {
    // quirk drops the whole field; the format strip must not resurrect anything
    const out = prepareClaudeRequest(titleGenBody(), "minimax");
    expect(out.output_config).toBeUndefined();
  });
});
