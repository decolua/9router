import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const executors = [
  { name: "CN", executor: new CodeBuddyExecutor(), preservesUnknownFields: false },
  { name: "Intl", executor: new CodeBuddyIntlExecutor(), preservesUnknownFields: true },
];

describe.each(executors)("CodeBuddy $name request normalization", ({ executor, preservesUnknownFields }) => {
  const transform = (body) => executor.transformRequest("glm-5.2", body, false, {});

  it("forces stream while preserving multimodal content and non-empty tools", () => {
    const content = [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
    ];
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }];
    const out = transform({
      messages: [{ role: "user", content }],
      tools,
      unknown_top_level: { retainedByIntl: true },
      stream: false,
    });

    expect(out.stream).toBe(true);
    expect(out.messages[0].content).toEqual(content);
    expect(out.tools).toEqual(tools);
    if (preservesUnknownFields) {
      expect(out.unknown_top_level).toEqual({ retainedByIntl: true });
    } else {
      expect(out.unknown_top_level).toBeUndefined();
    }
  });

  it("removes empty tools", () => {
    expect(transform({ messages: [], tools: [] }).tools).toBeUndefined();
  });

  it.each([undefined, "", "  ", "none", "off"])(
    "omits disabled reasoning for effort %p",
    (reasoning_effort) => {
      const out = transform({ messages: [], reasoning_effort, reasoning_summary: "detailed" });
      expect(out.reasoning_effort).toBeUndefined();
      expect(out.reasoning_summary).toBeUndefined();
    },
  );

  it("defaults reasoning_summary only for non-empty effort", () => {
    const out = transform({ messages: [], reasoning_effort: "high" });
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning_summary).toBe("auto");
  });

  it("preserves an explicit reasoning_summary", () => {
    const out = transform({
      messages: [],
      reasoning_effort: "high",
      reasoning_summary: "detailed",
    });
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning_summary).toBe("detailed");
  });
});
