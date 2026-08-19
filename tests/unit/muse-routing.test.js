import { describe, it, expect } from "vitest";

describe("muse routing end-to-end", () => {
  it("translator flattens namespace tools; executor route works", async () => {
    const { openaiResponsesToOpenAIRequest } = await import("open-sse/translator/request/openai-responses.js");

    const body = {
      model: "mc/muse-spark-1.2",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
      instructions: "You are Muse.",
      reasoning: { effort: "xhigh", summary: "concise" },
      include: ["reasoning.encrypted_content"],
      tools: [
        { type: "namespace", name: "filesystem", tools: [
          { type: "function", name: "read_file", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
          { type: "function", name: "edit_file", description: "edit a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        ]},
        { type: "function", name: "shell", description: "run a shell command", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } },
      ],
      stream: true,
      store: false,
      max_output_tokens: 131072,
    };

    const converted = openaiResponsesToOpenAIRequest("muse-spark-1.2", JSON.parse(JSON.stringify(body)), true, {});
    expect(converted.messages).toHaveLength(2);
    expect(converted.messages[0]).toMatchObject({ role: "system", content: "You are Muse." });
    expect(converted.tools.some(t => t.type === "namespace")).toBe(false);
    const names = converted.tools.map(t => t.function.name).filter(Boolean).sort();
    expect(names).toEqual(["edit_file", "read_file", "shell"]);
    expect(converted.max_tokens).toBe(131072);
    expect(converted.reasoning_effort).toBe("xhigh");
  });

  it("parseModel resolves mc/muse-spark-1.2 to provider muse-code", async () => {
    const { parseModel } = await import("open-sse/services/model.js");
    const p = parseModel("mc/muse-spark-1.2");
    expect(p.provider).toBe("muse-code");
    expect(p.model).toBe("muse-spark-1.2");
  });

  it("executor flattens namespace tools (belt & suspenders)", async () => {
    const { getExecutor } = await import("open-sse/executors/index.js");
    const exec = getExecutor("muse-code");
    const out = exec.transformRequest("muse-spark-1.2", {
      tools: [
        { type: "namespace", name: "fs", tools: [{ type: "function", name: "a", parameters: {} }] },
        { type: "function", name: "b", parameters: {} },
      ],
    });
    expect(out.tools.map(t => t.name)).toEqual(["a", "b"]);
  });
});
