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
    const out = ex.transformRequest("muse-spark-1.2-contributor", body);
    expect(out.tool_choice).toBe("auto");
    expect(out.tools).toBeDefined();
    expect(out.tools.length).toBe(1);
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
    const out = ex.transformRequest("muse-spark-1.2-contributor(max)", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toBe("auto");
  });

  it("handles thinking suffix (8192)", () => {
    const ex = new DefaultExecutor("opencode-go");
    const out = ex.transformRequest("muse-spark-1.2-contributor(8192)", makeBody({ type: "function", name: "web_search" }));
    expect(out.tool_choice).toBe("auto");
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
});
