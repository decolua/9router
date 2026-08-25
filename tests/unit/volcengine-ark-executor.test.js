import { describe, expect, it } from "vitest";
import { VolcengineArkExecutor } from "../../open-sse/executors/volcengine-ark.js";

describe("Volcengine Ark executor", () => {
  it("requests streaming usage so cache counters are available", () => {
    const executor = new VolcengineArkExecutor();
    const result = executor.transformRequest("glm-5.3", {
      model: "glm-5.3",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    }, true, {});

    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it("preserves existing streaming options while enabling usage", () => {
    const executor = new VolcengineArkExecutor();
    const result = executor.transformRequest("glm-5.3", {
      messages: [],
      stream_options: { include_usage: false, custom_flag: true },
    }, true, {});

    expect(result.stream_options).toEqual({ include_usage: true, custom_flag: true });
  });

  it("does not add stream options to non-streaming requests", () => {
    const executor = new VolcengineArkExecutor();
    const result = executor.transformRequest("glm-5.3", {
      messages: [],
    }, false, {});

    expect(result.stream_options).toBeUndefined();
  });
});
