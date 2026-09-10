import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

function makeBody(tool_choice) {
  const b = {
    model: "muse-spark-1.2-contributor",
    input: [],
    tools: [{ type: "function", name: "web_search", description: "search", parameters: { type: "object", properties: {} } }],
  };
  if (tool_choice !== undefined) b.tool_choice = tool_choice;
  return b;
}

describe("opencode-go muse-spark tool_choice demotion (Responses)", () => {
  it("demotes named function tool_choice to auto", () => {
    const ex = new DefaultExecutor("opencode-go");
    const body = makeBody({ type: "function", name: "web_search" });
    const expectedTools = structuredClone(body.tools);
    const out = ex.transformRequest("muse-spark-1.2-contributor", body);
    expect(out.tool_choice).toBe("auto");
    expect(out.tools).toEqual(expectedTools);
    expect(out.tools).toHaveLength(expectedTools.length);
    expect(out.tools[0].name).toBe(expectedTools[0].name);
  });

  it("demotes required to auto", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor", makeBody("required"));
    expect(out.tool_choice).toBe("auto");
  });

  it("demotes none to auto", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor", makeBody("none"));
    expect(out.tool_choice).toBe("auto");
  });

  it("keeps auto as auto", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor", makeBody("auto"));
    expect(out.tool_choice).toBe("auto");
  });

  it("leaves absent tool_choice absent", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor", makeBody(undefined));
    expect(out).not.toHaveProperty("tool_choice");
  });

  it("handles thinking suffix (max)", () => {
    const ex = new DefaultExecutor("opencode-go");
    const body = makeBody({ type: "function", name: "web_search" });
    const expectedTools = structuredClone(body.tools);
    const out = ex.transformRequest("muse-spark-1.2-contributor(max)", body);
    expect(out.tool_choice).toBe("auto");
    expect(out.tools).toEqual(expectedTools);
  });

  it("handles thinking suffix (8192)", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor(8192)", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toBe("auto");
  });

  it.each(["auto", "OFF"])("handles thinking suffix (%s)", (level) => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest(`muse-spark-1.2-contributor(${level})`, makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toBe("auto");
  });

  it("does not demote a bogus thinking suffix", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor(bogus)", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toEqual({ type: "function", name: "web_search" });
  });

  it("does not affect opencode free variant", () => {
    const ex = new DefaultExecutor("opencode");
    const out = ex.transformRequest("muse-spark-1.2-contributor-free", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toEqual({ type: "function", name: "web_search" });
  });

  it("does not affect other opencode-go model", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("glm-5.2", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toEqual({ type: "function", name: "web_search" });
  });

  it("does not affect other provider", () => {
    const ex = new DefaultExecutor("openai");
    const out = ex.transformRequest("muse-spark-1.2-contributor", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toEqual({ type: "function", name: "web_search" });
  });

  it("also demotes the 1.3 contributor (plain and with a recognized suffix)", () => {
    const ex = new DefaultExecutor("opencode-go");
    expect(ex.transformRequest("muse-spark-1.3-contributor", makeBody({ type: "function", name: "web_search" })).tool_choice).toBe("auto");
    expect(ex.transformRequest("muse-spark-1.3-contributor(high)", makeBody({ type: "function", name: "web_search" })).tool_choice).toBe("auto");
    expect(ex.transformRequest("muse-spark-1.3-contributor(bogus)", makeBody({ type: "function", name: "web_search" })).tool_choice)
      .toEqual({ type: "function", name: "web_search" });
  });
});

describe("opencode-go muse-spark reasoning_effort conversion (Responses endpoint)", () => {
  const GO_RESPONSES = { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses" };
  const GO_CHAT = { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions" };

  function reasoningBody(effort, extra = {}) {
    return { model: "muse-spark-1.3-contributor", input: [], reasoning_effort: effort, ...extra };
  }

  it("converts reasoning_effort xhigh to Responses reasoning with the exact quirk transport + baseUrl", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.3-contributor", reasoningBody("xhigh"), true, {
      runtimeTransport: GO_RESPONSES,
    });
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("clamps reasoning_effort none to minimal (no disable shape)", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.3-contributor", reasoningBody("none"), true, {
      runtimeTransport: GO_RESPONSES,
    });
    expect(out.reasoning).toEqual({ effort: "minimal", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("clamps reasoning_effort off to minimal (no disable shape)", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.3-contributor", reasoningBody("off"), true, {
      runtimeTransport: GO_RESPONSES,
    });
    expect(out.reasoning).toEqual({ effort: "minimal", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("leaves reasoning_effort untouched without a runtimeTransport", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.3-contributor", reasoningBody("xhigh"), true, {});
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.reasoning).toBeUndefined();
  });

  it("leaves reasoning_effort untouched on the chat endpoint", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.3-contributor", reasoningBody("xhigh"), true, {
      runtimeTransport: GO_CHAT,
    });
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.reasoning).toBeUndefined();
  });

  it("does not convert for another opencode-go model on the Responses transport", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("glm-5.2", reasoningBody("xhigh"), true, {
      runtimeTransport: GO_RESPONSES,
    });
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.reasoning).toBeUndefined();
  });

  it("does not convert for another provider on the Responses endpoint", () => {
    const ex = new DefaultExecutor("openai");
    const out = ex.transformRequest("muse-spark-1.3-contributor", reasoningBody("xhigh"), true, {
      runtimeTransport: GO_RESPONSES,
    });
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.reasoning).toBeUndefined();
  });
});
