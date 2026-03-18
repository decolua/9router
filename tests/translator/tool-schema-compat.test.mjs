import assert from "node:assert/strict";
import {
  normalizeToolDescription,
  sanitizeJsonSchemaForOpenAI,
  sanitizeOpenAIChatTool,
  sanitizeOpenAIResponsesTool,
  sanitizeRequestTools
} from "../../open-sse/translator/helpers/toolSchemaCompat.js";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("object schema without properties gets patched", () => {
  const out = sanitizeJsonSchemaForOpenAI({ type: "object" });
  assert.deepEqual(out, { type: "object", properties: {} });
});

test("object schema with properties stays unchanged", () => {
  const schema = {
    type: "object",
    properties: {
      q: { type: "string" }
    },
    required: ["q"]
  };
  const out = sanitizeJsonSchemaForOpenAI(schema);
  assert.deepEqual(out, schema);
  assert.notStrictEqual(out, schema);
});

test("nested object schema is sanitized recursively", () => {
  const schema = {
    type: "object",
    properties: {
      config: { type: "object" },
      list: {
        type: "array",
        items: {
          type: "object"
        }
      }
    }
  };
  const out = sanitizeJsonSchemaForOpenAI(schema);
  assert.deepEqual(out, {
    type: "object",
    properties: {
      config: { type: "object", properties: {} },
      list: {
        type: "array",
        items: { type: "object", properties: {} }
      }
    }
  });
});

test("combiners and not are sanitized recursively", () => {
  const schema = {
    oneOf: [{ type: "object" }],
    not: { type: "object" }
  };
  const out = sanitizeJsonSchemaForOpenAI(schema);
  assert.deepEqual(out, {
    oneOf: [{ type: "object", properties: {} }],
    not: { type: "object", properties: {} }
  });
});

test("chat tool format is sanitized", () => {
  const tool = {
    type: "function",
    function: {
      name: "mcp__vibe_kanban__list_repos",
      description: null,
      parameters: { type: "object" }
    }
  };
  const out = sanitizeOpenAIChatTool(tool);
  assert.deepEqual(out, {
    type: "function",
    function: {
      name: "mcp__vibe_kanban__list_repos",
      description: "",
      parameters: { type: "object", properties: {} }
    }
  });
});

test("responses tool format is sanitized", () => {
  const tool = {
    type: "function",
    name: "mcp__vibe_kanban__list_organizations",
    description: ["List", "organizations"],
    parameters: { type: "object" },
    strict: true
  };
  const out = sanitizeOpenAIResponsesTool(tool);
  assert.deepEqual(out, {
    type: "function",
    name: "mcp__vibe_kanban__list_organizations",
    description: "[\"List\",\"organizations\"]",
    parameters: { type: "object", properties: {} },
    strict: true
  });
});

test("description normalization covers null/object/primitive", () => {
  assert.equal(normalizeToolDescription(null), "");
  assert.equal(normalizeToolDescription({ a: 1 }), "{\"a\":1}");
  assert.equal(normalizeToolDescription(123), "123");
});

test("sanitizeRequestTools is idempotent", () => {
  const body = {
    tools: [
      {
        type: "function",
        function: {
          name: "chat_tool",
          description: { title: "tool" },
          parameters: { type: "object" }
        }
      },
      {
        type: "function",
        name: "responses_tool",
        description: undefined,
        parameters: { type: "object" }
      }
    ]
  };
  const once = sanitizeRequestTools(body);
  const twice = sanitizeRequestTools(once);
  assert.deepEqual(twice, once);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("all tool schema compat tests passed");
