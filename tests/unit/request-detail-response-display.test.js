import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatRequestDetailResponse } from "../../src/app/(dashboard)/dashboard/usage/components/responseDisplay.js";

function renderResponse(response) {
  const display = formatRequestDetailResponse(response);
  return renderToStaticMarkup(createElement("section", null,
    display.thinking && createElement("pre", { className: "thinking" }, display.thinking),
    createElement("pre", { className: "content" }, display.content),
  ));
}

describe("request detail response display (#2751)", () => {
  it("renders the reported empty thinking block and final text without React error 31", () => {
    const response = { content: [
      { type: "thinking", thinking: "", signature: "private-signature" },
      { type: "text", text: "B" },
    ], thinking: null };
    const markup = renderResponse(response);
    expect(markup).toContain('class="content">B</pre>');
    expect(markup).not.toContain("private-signature");
    expect(markup).toContain("Thinking content unavailable");
  });

  it("separates block thinking from the final answer without changing stored data", () => {
    const response = { content: [
      { type: "thinking", thinking: "Check the result", signature: "s".repeat(10000) },
      { type: "text", text: "Answer" },
      { type: "text", text: "Next line" },
    ] };
    const original = structuredClone(response);
    expect(formatRequestDetailResponse(response)).toEqual({
      content: "Answer\nNext line", thinking: "Check the result",
    });
    expect(response).toEqual(original);
    expect(renderResponse(response)).not.toContain("s".repeat(100));
  });

  it("keeps existing plain-text content and top-level thinking", () => {
    expect(formatRequestDetailResponse({ content: "Hello", thinking: "Reason" }))
      .toEqual({ content: "Hello", thinking: "Reason" });
    expect(renderResponse({ content: "<script>alert(1)</script>" }))
      .toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("serializes unknown structured blocks and objects safely", () => {
    const response = { content: [{ type: "future_block", payload: { count: 2 } }] };
    const display = formatRequestDetailResponse(response);
    expect(JSON.parse(display.content)).toEqual(response.content[0]);
    expect(renderResponse(response)).toContain("future_block");
    expect(JSON.parse(formatRequestDetailResponse({ content: { result: "ok" } }).content))
      .toEqual({ result: "ok" });
  });

  it("does not expose signatures or redacted thinking data", () => {
    const markup = renderResponse({ content: [
      { type: "redacted_thinking", data: "opaque-secret" },
      { type: "future_block", nested: { signature: "hidden-signature" } },
    ] });
    expect(markup).toContain("Redacted thinking");
    expect(markup).not.toContain("opaque-secret");
    expect(markup).not.toContain("hidden-signature");
  });

  it("renders structured top-level thinking as text", () => {
    const markup = renderResponse({ content: "ok", thinking: { reasoning: "checked", signature: "secret" } });
    expect(markup).toContain("checked");
    expect(markup).not.toContain("secret");
  });

  it.each([undefined, {}, { content: null }, { content: [] }, { content: "" }])(
    "shows the no-content placeholder for %j", (response) => {
      expect(formatRequestDetailResponse(response)).toEqual({ content: "[No content]", thinking: "" });
      expect(renderResponse(response)).toContain("[No content]");
    }
  );

  it("keeps mixed string content and primitive values renderable", () => {
    expect(formatRequestDetailResponse({ content: ["first", { type: "text", text: "second" }, null] }).content)
      .toBe("first\nsecond");
    expect(formatRequestDetailResponse({ content: 0 }).content).toBe("0");
  });
});
