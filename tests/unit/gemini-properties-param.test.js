/**
 * Regression test for #4306
 *
 * OpenAI→Gemini tool schema conversion fails with 400 INVALID_ARGUMENT when a
 * tool parameter is named "properties". Gemini's wire format uses "properties"
 * as the keyword for object sub-schemas; a parameter with that exact name
 * collides with the keyword and causes the API to reject the request.
 *
 * Fix: rename any property called "properties" to "properties_" recursively
 * inside cleanJSONSchemaForAntigravity, updating required arrays to match.
 *
 * Affects real MCP servers: Notion (notion-create-pages, notion-update-page)
 * and Atlassian (getJiraIssue).
 */

import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity — 'properties' parameter name (#4306)", () => {
  it("renames a top-level parameter named 'properties'", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        properties: { type: "array", items: { type: "string" } }
      },
      required: ["a", "properties"]
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties).not.toHaveProperty("properties");
    expect(result.properties).toHaveProperty("properties_");
    expect(result.required).not.toContain("properties");
    expect(result.required).toContain("properties_");
    expect(result.properties["a"]).toBeDefined();
  });

  it("renames 'properties' in a nested object property", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            properties: { type: "string" },
            other: { type: "number" }
          },
          required: ["properties"]
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    const outer = result.properties["outer"];
    expect(outer.properties).not.toHaveProperty("properties");
    expect(outer.properties).toHaveProperty("properties_");
    expect(outer.required).not.toContain("properties");
    expect(outer.required).toContain("properties_");
  });

  it("does not rename 'properties' keyword itself (the object sub-schema map)", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    // The top-level 'properties' keyword must still exist
    expect(result).toHaveProperty("properties");
    expect(result.properties).toHaveProperty("name");
  });

  it("leaves schemas with no 'properties' parameter untouched", () => {
    // NOTE: avoid using "title" as a property name here — it is listed in
    // UNSUPPORTED_SCHEMA_CONSTRAINTS and removed from every schema node by
    // removeUnsupportedKeywords (it's a JSON Schema annotation keyword).
    // Use unambiguous names instead.
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" }
      },
      required: ["name"]
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties).toHaveProperty("name");
    expect(result.properties).toHaveProperty("count");
    expect(result.required).toContain("name");
  });

  it("handles 'properties' as optional (not in required)", () => {
    const schema = {
      type: "object",
      properties: {
        properties: { type: "object" },
        other: { type: "string" }
      }
      // no required array
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties).not.toHaveProperty("properties");
    expect(result.properties).toHaveProperty("properties_");
    // required should not have been added
    if (result.required) {
      expect(result.required).not.toContain("properties");
    }
  });
});