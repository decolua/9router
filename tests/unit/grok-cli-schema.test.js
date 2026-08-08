import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";

function taskParameters() {
  return {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          $defs: {
            AddTask: {
              type: "object",
              properties: {
                name: { type: "string" },
                children: {
                  type: "array",
                  items: { $ref: "AddTask" },
                },
              },
              $id: "AddTask",
            },
          },
          $ref: "AddTask",
        },
      },
    },
  };
}

describe("Grok CLI tool schema compatibility", () => {
  it("hoists TypeBox cyclic definitions and rewrites local refs", () => {
    const body = {
      tools: [
        {
          type: "function",
          function: {
            name: "set_tasks",
            parameters: taskParameters(),
          },
        },
      ],
    };

    const out = new GrokCliExecutor().transformRequest("grok-4.5", body, true, {
      connectionId: "schema-test",
      rawHeaders: {},
    });

    const parameters = out.tools[0].parameters;
    expect(parameters.$defs.AddTask).toBeDefined();
    expect(parameters.properties.tasks.items).toEqual({ $ref: "#/$defs/AddTask" });
    expect(parameters.$defs.AddTask).not.toHaveProperty("$id");
    expect(parameters.$defs.AddTask.properties.children.items.$ref).toBe("#/$defs/AddTask");
  });

  it("leaves already-qualified and external refs untouched", () => {
    const body = {
      tools: [{
        type: "function",
        function: {
          name: "lookup",
          parameters: {
            type: "object",
            properties: {
              local: { $ref: "#/$defs/Local" },
              external: { $ref: "https://example.com/schema.json" },
            },
            $defs: { Local: { type: "string" } },
          },
        },
      }],
    };

    const out = new GrokCliExecutor().transformRequest("grok-4.5", body, true, {
      connectionId: "schema-test",
      rawHeaders: {},
    });
    const parameters = out.tools[0].parameters;
    expect(parameters.properties.local.$ref).toBe("#/$defs/Local");
    expect(parameters.properties.external.$ref).toBe("https://example.com/schema.json");
  });
});
