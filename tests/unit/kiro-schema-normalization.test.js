import { describe, expect, it } from "vitest";
import { normalizeKiroToolSpecs } from "../../open-sse/translator/concerns/kiroConversation.js";

function specSchema(schema) {
  const { specs } = normalizeKiroToolSpecs([{ name: "demo", input_schema: schema }]);
  expect(specs).toHaveLength(1);
  return specs[0].toolSpecification.inputSchema.json;
}

describe("kiro tool schema combinator normalization", () => {
  it("merges top-level allOf branches into the root properties", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      allOf: [
        { properties: { b: { type: "number" } }, required: ["b"] },
      ],
    };
    const out = specSchema(schema);
    expect(Object.keys(out.properties).sort()).toEqual(["a", "b"]);
    expect(out.required.sort()).toEqual(["a", "b"]);
    expect(out.allOf).toBeUndefined();
  });

  it("consumes top-level oneOf/anyOf branches without keeping a best-branch only", () => {
    const out = specSchema({
      type: "object",
      oneOf: [
        { properties: { x: { type: "string" } } },
        { properties: { y: { type: "number" } } },
      ],
      anyOf: [{ properties: { z: { type: "boolean" } } }],
    });
    expect(Object.keys(out.properties).sort()).toEqual(["x", "y", "z"]);
    expect(out.oneOf).toBeUndefined();
    expect(out.anyOf).toBeUndefined();
    expect(out.required).toBeUndefined();
  });

  it("resolves property conflicts first-writer-wins (root beats branches)", () => {
    const out = specSchema({
      type: "object",
      properties: { a: { type: "string" } },
      allOf: [{ properties: { a: { type: "number" } } }],
    });
    expect(out.properties.a).toEqual({ type: "string" });
  });

  it("drops required entries that reference properties absent after the merge", () => {
    const out = specSchema({
      type: "object",
      allOf: [
        { properties: { b: { type: "string" } }, required: ["b", "ghost"] },
      ],
      required: ["phantom"],
    });
    expect(out.properties).toHaveProperty("b");
    expect(out.required).toEqual(["b"]);
  });

  it("keeps required from nested allOf branches only", () => {
    const out = specSchema({
      allOf: [{ properties: { a: {} }, required: ["a"] }],
      oneOf: [{ properties: { c: {} }, required: ["c"] }],
    });
    expect(out.required).toEqual(["a"]);
  });

  it("preserves combinators at nested levels", () => {
    const nested = { anyOf: [{ type: "string" }, { type: "number" }] };
    const out = specSchema({ type: "object", properties: { p: nested } });
    expect(out.properties.p.anyOf).toEqual(nested.anyOf);
  });

  it("strips non-serializable metadata keys at every level", () => {
    const out = specSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:tool",
      type: "object",
      properties: {
        a: { type: "string", title: "A", examples: ["x"], default: "y", $id: "urn:a" },
      },
      additionalProperties: false,
    });
    expect(out).not.toHaveProperty("$schema");
    expect(out).not.toHaveProperty("$id");
    expect(out).not.toHaveProperty("additionalProperties");
    expect(out.properties.a).toEqual({ type: "string" });
  });

  it("skips non-object combinator branches", () => {
    const out = specSchema({
      type: "object",
      allOf: [{ properties: { a: {} } }, "garbage", 42, null],
    });
    expect(Object.keys(out.properties)).toEqual(["a"]);
  });

  it("falls back to an empty object schema", () => {
    expect(specSchema({})).toEqual({ type: "object", properties: {} });
    expect(specSchema(null)).toEqual({ type: "object", properties: {} });
    expect(specSchema("not-a-schema")).toEqual({ type: "object", properties: {} });
  });

  it("keeps the existing no-combinator behaviour (required pruned to existing properties)", () => {
    const out = specSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "missing", 42],
    });
    expect(out.required).toEqual(["a"]);
  });
});
