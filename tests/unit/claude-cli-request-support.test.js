import { describe, it, expect } from "vitest";
import {
  generationExtraBody,
  ignoredRequestFields,
  structuredOutputSchema,
  toolsAreWanted,
  unsupportedRequestFeature,
} from "open-sse/executors/claudeCliRequestSupport.js";
import { CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS } from "open-sse/config/claudeCli.js";

/**
 * The CLI is a coding agent, not the Messages API. Fields it has no equivalent
 * for used to be read off the body and dropped without a word, so a caller who
 * asked for JSON, or for a particular tool, got something else and no reason
 * why. A field that changes the shape of the promised answer is refused; one
 * that only tunes it is ignored and named.
 *
 * Structured output is no longer one of those: `--json-schema` carries it, and
 * what is refused now is only a schema the flag could not take.
 */

const TOOLS = [{ type: "function", function: { name: "f" } }];

const JSON_SCHEMA_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "math_response",
    strict: true,
    schema: {
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
      additionalProperties: false,
    },
  },
};

describe("unsupportedRequestFeature", () => {
  it("passes an ordinary request", () => {
    expect(unsupportedRequestFeature({ messages: [] })).toBeNull();
    expect(unsupportedRequestFeature({ tools: TOOLS, tool_choice: "auto" })).toBeNull();
    expect(unsupportedRequestFeature({})).toBeNull();
  });

  it("refuses a forced tool, in either dialect", () => {
    // The model is asked, not instructed; there is no flag for forcing one.
    for (const tool_choice of [
      "required",
      "any",
      { type: "any" },
      { type: "tool", name: "f" },
      { type: "function", function: { name: "f" } },
    ]) {
      const refusal = unsupportedRequestFeature({ tools: TOOLS, tool_choice });
      expect(refusal?.code, JSON.stringify(tool_choice)).toBe("unsupported_tool_choice");
      expect(refusal.message).toMatch(/auto/);
    }
  });

  it("does not refuse a forced choice when there are no tools to force", () => {
    expect(unsupportedRequestFeature({ tool_choice: "required" })).toBeNull();
  });

  it("no longer refuses a structured-output request: --json-schema carries it", () => {
    expect(unsupportedRequestFeature({ response_format: JSON_SCHEMA_FORMAT })).toBeNull();
    expect(unsupportedRequestFeature({ response_format: { type: "json_object" } })).toBeNull();
    expect(unsupportedRequestFeature({ response_format: "json_object" })).toBeNull();
    expect(unsupportedRequestFeature({ response_format: { type: "text" } })).toBeNull();
  });

  it("refuses a json_schema with nothing usable to send", () => {
    // Each of these reaches argv, so each has to be something the CLI can take.
    const unusable = [
      { type: "json_schema" },
      { type: "json_schema", json_schema: {} },
      { type: "json_schema", json_schema: { name: "r" } },
      { type: "json_schema", json_schema: { schema: "{\"type\":\"object\"}" } },
      { type: "json_schema", json_schema: { schema: [] } },
      { type: "json_schema", json_schema: { schema: null } },
      // The CLI answers through a tool, and a tool's input is always an object.
      { type: "json_schema", json_schema: { schema: { type: "array", items: { type: "string" } } } },
      { type: "json_schema", json_schema: { schema: { properties: { a: { type: "string" } } } } },
    ];
    for (const response_format of unusable) {
      const refusal = unsupportedRequestFeature({ response_format });
      expect(refusal?.code, JSON.stringify(response_format)).toBe("invalid_response_format");
      expect(refusal.message).toMatch(/object/);
      // Names where it looked, so a caller whose schema sits elsewhere can see why.
      expect(refusal.message).toMatch(/response_format\.json_schema\.schema/);
    }
  });

  it("keeps the schema limit inside what Windows leaves after quote escaping", () => {
    // Every `"` on a Windows command line becomes `\"`, so a schema can grow to
    // twice its length; the line as a whole is capped at 32,767 characters, and
    // the rest of it (flags, three file paths, the model) needs room too.
    expect(CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS * 2).toBeLessThanOrEqual(32767 - 4000);
  });

  it("refuses a schema too large for one command-line argument", () => {
    // Few nodes, many characters: it is the length that is being refused here,
    // not the complexity (which has its own limits, below).
    const properties = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`field_${i}`, { type: "string", description: "x".repeat(400) }]),
    );
    const response_format = {
      type: "json_schema",
      json_schema: { name: "big", schema: { type: "object", properties } },
    };
    const refusal = unsupportedRequestFeature({ response_format });
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toContain(String(CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS));
    expect(structuredOutputSchema({ response_format })).toBeNull();
  });

  it("refuses structured output together with tools it would have to advertise", () => {
    // The CLI answers through a tool of its own, and the caller's tools would
    // compete with it for the one turn there is. Not measured, so not offered.
    const refusal = unsupportedRequestFeature({
      tools: TOOLS,
      response_format: { type: "json_object" },
    });
    expect(refusal?.code).toBe("unsupported_response_format_with_tools");
    expect(refusal.message).toMatch(/tool_choice/);
  });

  it("does not count tools that are never advertised", () => {
    expect(unsupportedRequestFeature({
      tools: TOOLS, tool_choice: "none", response_format: { type: "json_object" },
    })).toBeNull();
    expect(unsupportedRequestFeature({ tools: [], response_format: { type: "json_object" } })).toBeNull();
  });

  it("refuses more than one completion, which it answers once per request", () => {
    expect(unsupportedRequestFeature({ n: 2 })?.code).toBe("unsupported_n");
    expect(unsupportedRequestFeature({ n: 1 })).toBeNull();
  });
});

describe("what a client's schema may cost the CLI", () => {
  // The CLI compiles the schema with Ajv and validates the model's answer
  // against it, synchronously, inside the child. Measured with ajv 8.20: a chain
  // of allOf entries with two $refs each, 1.7 KB in all, takes 72 ms at depth 24
  // and 301 ms at 26 — doubling per level, about 80 minutes by depth 40. The
  // child's event loop is blocked throughout and only the 180 s idle timeout
  // ends it. So the walk is bounded, and does not recurse: a schema nested tens
  // of thousands of levels deep used to make JSON.stringify throw out of
  // execute(), which the account loop reads as a 502 and locks on.
  const wrap = (schema) => ({ response_format: { type: "json_schema", json_schema: { name: "s", schema } } });
  const refusalOf = (schema) => unsupportedRequestFeature(wrap(schema));

  const nested = (depth) => {
    let schema = { type: "object" };
    for (let i = 0; i < depth; i += 1) schema = { type: "object", properties: { a: schema } };
    return schema;
  };

  it("refuses a schema nested deeper than the limit, without throwing", () => {
    // Far past where JSON.stringify gives up; a recursive walk would too.
    const refusal = refusalOf(nested(50000));
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toMatch(/nest/i);
    expect(structuredOutputSchema(wrap(nested(50000)))).toBeNull();
  });

  it("accepts nesting an ordinary schema reaches", () => {
    expect(refusalOf(nested(6))).toBeNull();
  });

  it("refuses a schema with more nodes than a reasonable one has", () => {
    const properties = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`f${i}`, {}]));
    const refusal = refusalOf({ type: "object", properties });
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toMatch(/nodes/i);
  });

  it("refuses the $ref fan-out that makes validation exponential", () => {
    // Two references per level: each level doubles the work below it.
    const schema = { type: "object", $defs: {}, allOf: [{ $ref: "#/$defs/l0" }] };
    for (let i = 0; i < 40; i += 1) {
      schema.$defs[`l${i}`] = { allOf: [{ $ref: `#/$defs/l${i + 1}` }, { $ref: `#/$defs/l${i + 1}` }] };
    }
    schema.$defs.l40 = { type: "string" };
    const refusal = refusalOf(schema);
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toMatch(/\$ref/);
  });

  it("counts a $ref wherever it sits, including under keywords it does not know as name maps", () => {
    // `dependencies` (draft-07) maps property names to schemas. A property named
    // "properties" or "$defs" there looks like a name map to a walker that
    // trusts its own list, and the $ref under it went uncounted — five hidden
    // per level, so a fan-out the limit exists to stop sailed through.
    const hidden = {
      dependencies: {
        properties: { $ref: "#/$defs/a" },
        $defs: { $ref: "#/$defs/a" },
        definitions: { $ref: "#/$defs/a" },
        patternProperties: { $ref: "#/$defs/a" },
        dependentSchemas: { $ref: "#/$defs/a" },
      },
    };
    const schema = { type: "object", $defs: { a: { type: "string" } }, allOf: Array.from({ length: 10 }, () => hidden) };
    const refusal = refusalOf(schema);
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toMatch(/\$ref/);
  });

  it("does the work the limits allow, not the work the client sent", () => {
    // Plain values are not nodes, but each is still something the walk must
    // visit; listing every one before any limit is checked cost 555 MB of heap
    // for a 10 MB body (a fatal out-of-memory under a 256 MB cap), against 45 ms
    // and nothing to parse it. Reads are counted through a proxy, which is how
    // the cost shows without a timing assertion.
    let reads = 0;
    const huge = new Proxy(new Array(2_000_000).fill(1), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const refusal = refusalOf({ type: "object", enum: huge });
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toMatch(/values/);
    expect(reads).toBeLessThan(20000);
  });

  it("refuses a wide object of plain values the same way", () => {
    const wide = Object.fromEntries(Array.from({ length: 50000 }, (_, i) => [`k${i}`, 1]));
    const refusal = refusalOf({ type: "object", default: wide });
    expect(refusal?.code).toBe("response_format_too_large");
    expect(refusal.message).toMatch(/values/);
  });

  it("never refuses, for its value count, a schema the length limit would accept", () => {
    // Each value is at least a character and a separator, so this is the most a
    // schema inside the limit can hold — a schema of nothing but the shortest values.
    const values = Math.floor(CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS / 2) - 20;
    const schema = { type: "object", enum: new Array(values).fill(1) };
    expect(JSON.stringify(schema).length).toBeLessThanOrEqual(CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS);
    expect(refusalOf(schema)).toBeNull();
  });

  it("accepts the handful of $refs a generated schema uses", () => {
    // What Pydantic and zod-to-json-schema emit for a couple of nested models.
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        owner: { $ref: "#/$defs/Person" },
        members: { type: "array", items: { $ref: "#/$defs/Person" } },
      },
      required: ["owner"],
      $defs: { Person: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    };
    expect(refusalOf(schema)).toBeNull();
  });

  it("does not count a property that is merely named $ref", () => {
    const properties = { $ref: { type: "string" }, pattern: { type: "string" } };
    expect(refusalOf({ type: "object", properties })).toBeNull();
  });
});

describe("structuredOutputSchema", () => {
  const SCHEMA = {
    type: "object",
    properties: { answer: { type: "number" } },
    required: ["answer"],
    additionalProperties: false,
  };

  it("hands a json_schema to the CLI as the schema itself, not the OpenAI wrapper", () => {
    const value = structuredOutputSchema({ response_format: JSON_SCHEMA_FORMAT });
    expect(JSON.parse(value)).toEqual(SCHEMA);
  });

  it("turns json_object into a schema that asks for an object and nothing more", () => {
    const expected = { type: "object" };
    expect(JSON.parse(structuredOutputSchema({ response_format: { type: "json_object" } }))).toEqual(expected);
    expect(JSON.parse(structuredOutputSchema({ response_format: "json_object" }))).toEqual(expected);
  });

  it("is nothing for a request that asked for no particular format", () => {
    expect(structuredOutputSchema({})).toBeNull();
    expect(structuredOutputSchema({ response_format: { type: "text" } })).toBeNull();
    expect(structuredOutputSchema({ response_format: "text" })).toBeNull();
    expect(structuredOutputSchema({ response_format: null })).toBeNull();
  });

  it("is nothing for a json_schema it would have refused", () => {
    expect(structuredOutputSchema({ response_format: { type: "json_schema" } })).toBeNull();
  });

  it("is one line of JSON with nothing a shell or a NUL byte could make of it", () => {
    const value = structuredOutputSchema({
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: {
            type: "object",
            properties: { "a\nb": { type: "string", description: "\u0000 \"quoted\" & $(x) `y`" } },
          },
        },
      },
    });
    expect(value).not.toMatch(/[\n\r\u0000]/);
    expect(JSON.parse(value).properties["a\nb"].description).toContain("$(x)");
  });
});

describe("generationExtraBody", () => {
  // Only stop sequences survive the trip. Measured on 2.1.280: a stop sequence
  // ended the answer where the caller asked, while temperature failed the
  // request outright ("may only be set to 1 when thinking is enabled") and a
  // max_tokens of 32 still produced 128 output tokens before the CLI reported
  // an error with no content.
  it("carries stop sequences, which the upstream request honours", () => {
    expect(generationExtraBody({ stop_sequences: ["END", "HALT"] }))
      .toEqual({ stop_sequences: ["END", "HALT"] });
  });

  it("takes a single stop string, which is how OpenAI sends one", () => {
    expect(generationExtraBody({ stop: "END" })).toEqual({ stop_sequences: ["END"] });
  });

  it("carries nothing else, because nothing else survives", () => {
    expect(generationExtraBody({ temperature: 0.2, top_p: 0.9, max_tokens: 100 })).toBeNull();
  });

  it("is nothing at all for a request that set none of them", () => {
    // No settings file is written then, so an ordinary request spawns exactly
    // what it always did.
    expect(generationExtraBody({ messages: [] })).toBeNull();
    expect(generationExtraBody({})).toBeNull();
  });

  it("drops empty entries rather than sending a stop sequence that matches nothing", () => {
    expect(generationExtraBody({ stop: ["", null, "OK"] })).toEqual({ stop_sequences: ["OK"] });
    expect(generationExtraBody({ stop: [""] })).toBeNull();
  });
});


describe("ignoredRequestFields", () => {
  it("names every field the CLI will not act on", () => {
    expect(ignoredRequestFields({ temperature: 0.2, seed: 7, messages: [] }))
      .toEqual(["temperature", "seed"]);
  });

  it("says nothing about a token ceiling, which is carried now", () => {
    // It used to be listed here, on a measurement that only covered
    // CLAUDE_CODE_EXTRA_BODY. CLAUDE_CODE_MAX_OUTPUT_TOKENS does bound the
    // answer — see outputTokenCeiling for what it honours and what it does not.
    expect(ignoredRequestFields({ max_tokens: 100, max_completion_tokens: 100 })).toEqual([]);
  });

  it("says nothing about stop sequences, which are carried", () => {
    expect(ignoredRequestFields({ stop: ["x"], stop_sequences: ["y"] })).toEqual([]);
  });

  it("says nothing about fields that are absent or null", () => {
    expect(ignoredRequestFields({ messages: [], seed: null })).toEqual([]);
    expect(ignoredRequestFields({})).toEqual([]);
  });
});

describe("toolsAreWanted", () => {
  it("honours tool_choice none by not advertising them at all", () => {
    expect(toolsAreWanted({ tool_choice: "none" })).toBe(false);
    expect(toolsAreWanted({ tool_choice: { type: "none" } })).toBe(false);
  });

  it("advertises them otherwise", () => {
    expect(toolsAreWanted({})).toBe(true);
    expect(toolsAreWanted({ tool_choice: "auto" })).toBe(true);
    expect(toolsAreWanted({ tool_choice: { type: "auto" } })).toBe(true);
  });
});
