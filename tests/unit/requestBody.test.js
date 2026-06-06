import { describe, it, expect } from "vitest";

import { cloneRequestBody } from "../../open-sse/utils/requestBody.js";

describe("cloneRequestBody", () => {
  it("returns a deep copy that is structurally equal", () => {
    const body = {
      model: "combo",
      tools: [{ type: "function", function: { name: "read" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const clone = cloneRequestBody(body);
    expect(clone).toEqual(body);
    expect(clone).not.toBe(body);
  });

  it("isolates nested mutations from the original", () => {
    const body = {
      messages: [{ role: "tool", content: "result" }],
      tools: [{ name: "a" }],
    };
    const clone = cloneRequestBody(body);

    // Mutate the clone the way translate/RTK/caveman would mutate a body.
    clone.messages[0].content = "COMPRESSED";
    clone.messages.push({ role: "system", content: "injected" });
    clone.tools.push({ name: "b" });

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe("result");
    expect(body.tools).toHaveLength(1);
  });

  it("passes through primitives and null", () => {
    expect(cloneRequestBody(null)).toBeNull();
    expect(cloneRequestBody(undefined)).toBeUndefined();
    expect(cloneRequestBody("x")).toBe("x");
    expect(cloneRequestBody(42)).toBe(42);
  });

  it("clones arrays", () => {
    const arr = [{ a: 1 }];
    const clone = cloneRequestBody(arr);
    expect(clone).toEqual(arr);
    expect(clone).not.toBe(arr);
    clone[0].a = 2;
    expect(arr[0].a).toBe(1);
  });
});
