import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => "" } })),
}));

// Break caught: Muse Spark free Responses models 400 vì upstream
// chỉ nhận tool_choice "auto"; named/required/none phải demote sang "auto".
// Live 2026-09-19: both 1.2-free and 1.3-free reject non-auto with 400, and any
// Responses request without both 'bash'+'read' tools returns 403 FreeTierError.
const FREE_12 = "muse-spark-1.2-contributor-free";
const FREE_13 = "muse-spark-1.3-contributor-free";
const CREDS = { connectionId: "opencode-free-tool-choice-test" };
const INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
const TOOLS = [{ type: "function", name: "get_weather", description: "w", parameters: { type: "object", properties: {} } }];

function responsesBody(model, tool_choice) {
  const body = { model, input: structuredClone(INPUT), tools: structuredClone(TOOLS) };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  return body;
}

describe("opencode Free tool_choice auto-only", () => {
  it("khai quirk đúng model Free trong registry", () => {
    expect(PROVIDERS.opencode.quirks?.forceAutoToolChoiceModels).toEqual([FREE_12, FREE_13]);
  });

  it.each([
    ["Responses named", { type: "function", name: "get_weather" }],
    ["Chat function named", { type: "function", function: { name: "get_weather" } }],
    ["Claude tool named", { type: "tool", name: "get_weather" }],
    ["required", "required"],
    ["none", "none"],
  ])("demote %s sang auto (plain và max)", (_label, choice) => {
    for (const model of [FREE_12, FREE_13, `${FREE_13}(max)`]) {
      const body = responsesBody(model, structuredClone(choice));
      const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
      expect(out.tool_choice).toBe("auto");
      // Cloak: original tool preserved + bash/read decoys (prevents 403 FreeTierError)
      expect(out.tools.map((t) => t.name)).toEqual(["get_weather", "bash", "read"]);
      expect(out.input).toEqual(INPUT);
    }
  });

  it("giữ auto và default absent sang auto; tools/input nguyên vẹn + decoys", () => {
    const autoOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, "auto"), true, CREDS,
    );
    expect(autoOut.tool_choice).toBe("auto");
    expect(autoOut.tools.map((t) => t.name)).toEqual(["get_weather", "bash", "read"]);
    expect(autoOut.input).toEqual(INPUT);

    const absentOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, undefined), true, CREDS,
    );
    // Cloak defaults missing choice to auto so upstream never sees absent + tools
    expect(absentOut.tool_choice).toBe("auto");
    expect(absentOut.tools.map((t) => t.name)).toEqual(["get_weather", "bash", "read"]);
    expect(absentOut.input).toEqual(INPUT);
  });

  it.each([
    ["future 1.4-Free", "muse-spark-1.4-contributor-free"],
    ["Go id", "muse-spark-1.3-contributor"],
    ["non-Muse", "big-pickle"],
  ])("không đổi tool_choice của %s", (_label, model) => {
    const choice = { type: "function", name: "get_weather" };
    const body = responsesBody(model, structuredClone(choice));
    const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
    expect(out.tool_choice).toEqual(choice);
  });

  it("wire: execute gửi choice auto + decoys tới /zen/v1/responses", async () => {
    proxyAwareFetch.mockClear();
    const ex = new OpenCodeExecutor();
    const body = responsesBody(FREE_13, { type: "function", name: "get_weather" });
    const { url, transformedBody } = await ex.execute({
      model: FREE_13, body, stream: true, credentials: CREDS,
    });
    expect(url).toBe("https://opencode.ai/zen/v1/responses");
    expect(transformedBody.tool_choice).toBe("auto");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [actualUrl, actualInit] = proxyAwareFetch.mock.calls[0];
    expect(actualUrl).toBe("https://opencode.ai/zen/v1/responses");
    const sent = JSON.parse(actualInit.body);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.model).toBe(FREE_13);
    expect(sent.tools.map((t) => t.name)).toEqual(["get_weather", "bash", "read"]);
    expect(sent.input).toEqual(INPUT);
  });

  it("cloak 46 external tools: tambah bash/read agar lolos FreeTierError", () => {
    const tools46 = Array.from({ length: 46 }, (_, i) => ({
      type: "function", name: `ext_tool_${i}`, description: "d", parameters: { type: "object", properties: {} },
    }));
    const body = { model: FREE_13, input: structuredClone(INPUT), tools: tools46 };
    const out = new OpenCodeExecutor().transformRequest(FREE_13, body, true, CREDS);
    expect(out.tools).toHaveLength(48);
    const names = new Set(out.tools.map((t) => t.name));
    expect(names.has("bash")).toBe(true);
    expect(names.has("read")).toBe(true);
    expect(names.has("ext_tool_0")).toBe(true);
    expect(out.tool_choice).toBe("auto");
  });
});
