import { describe, it, expect } from "vitest";
import REGISTRY from "../open-sse/providers/registry/index.js";
import { getExecutor } from "../open-sse/executors/index.js";
import { parseModel } from "../open-sse/services/model.js";

describe("muse-code provider", () => {
  it("registry entry exists", () => {
    const e = REGISTRY.find(r => r.id === "muse-code");
    expect(e).toBeTruthy();
    expect(e.alias).toBe("mc");
    expect(e.category).toBe("apikey");
    expect(e.transport.format).toBe("openai-responses");
    expect(e.models.map(m => m.id)).toEqual(expect.arrayContaining(["muse-spark-1.2", "muse-spark-1.2-contributor", "muse-spark-1.1"]));
  });

  it("parseModel resolves mc/muse-spark-1.2", () => {
    const p = parseModel("mc/muse-spark-1.2");
    expect(p.provider).toBe("muse-code");
    expect(p.model).toBe("muse-spark-1.2");
    expect(p.isAlias).toBe(false);
  });

  it("executor resolves and flattens namespace tools", () => {
    const exec = getExecutor("muse-code");
    expect(exec.constructor.name).toBe("MuseCodeExecutor");
    const out = exec.transformRequest("muse-spark-1.2", {
      model: "muse-spark-1.2",
      input: "hi",
      tools: [
        { type: "namespace", name: "filesystem", tools: [
          { type: "function", name: "read", parameters: { type: "object", properties: {} } },
        ]},
        { type: "function", name: "shell", parameters: { type: "object", properties: {} } },
      ],
    });
    expect(out.tools).toHaveLength(2);
    expect(out.tools[0].name).toBe("read");
    expect(out.tools[1].name).toBe("shell");
  });
});
