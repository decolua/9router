import { describe, it, expect } from "vitest";
import { normalizeSchemaForCCA, coerceBooleanSubschema, CCA_REJECTED_FIELDS } from "../../src/lib/schemas/antigravity.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import { CLOUD_CODE_API } from "../../open-sse/config/appConstants.js";

describe("Antigravity CCA Protocol & Tool Schema Normalizer", () => {
  describe("normalizeSchemaForCCA - Claude Code Tools", () => {
    it("sanitizes Claude Code Bash tool schema", () => {
      const claudeBashSchema = {
        type: "object",
        description: "Run a shell command on the host system",
        properties: {
          command: {
            type: "string",
            description: "The command to run",
            $comment: "Internal execution note",
            default: "echo",
          },
          timeout: {
            type: "number",
            description: "Optional timeout in seconds",
            default: 30,
            minimum: 1,
            maximum: 600,
          },
        },
        required: ["command"],
        additionalProperties: false,
        $comment: "Claude Code tool definition",
      };

      const normalized = normalizeSchemaForCCA(claudeBashSchema);

      expect(normalized.type).toBe("object");
      expect(normalized.properties).toBeDefined();
      expect(normalized.properties.command.type).toBe("string");
      expect(normalized.properties.command.description).toBe("The command to run");
      expect(normalized.properties.command.$comment).toBeUndefined();
      expect(normalized.properties.command.default).toBeUndefined();
      expect(normalized.properties.timeout.type).toBe("number");
      expect(normalized.properties.timeout.default).toBeUndefined();
      expect(normalized.properties.timeout.minimum).toBeUndefined();
      expect(normalized.properties.timeout.maximum).toBeUndefined();
      expect(normalized.additionalProperties).toBeUndefined();
      expect(normalized.$comment).toBeUndefined();
      expect(normalized.required).toEqual(["command"]);
    });

    it("sanitizes Claude Code Edit tool schema", () => {
      const claudeEditSchema = {
        type: "object",
        description: "Edit a file by replacing old text with new text",
        properties: {
          file_path: {
            type: "string",
            description: "Path to file",
            readOnly: false,
            writeOnly: false,
          },
          old_string: {
            type: "string",
            description: "String to replace",
            deprecated: false,
          },
          new_string: {
            type: "string",
            description: "Replacement string",
          },
        },
        required: ["file_path", "old_string", "new_string", "non_existent_prop"],
        additionalProperties: false,
        readOnly: false,
      };

      const normalized = normalizeSchemaForCCA(claudeEditSchema);

      expect(normalized.type).toBe("object");
      expect(normalized.properties.file_path.readOnly).toBeUndefined();
      expect(normalized.properties.file_path.writeOnly).toBeUndefined();
      expect(normalized.properties.old_string.deprecated).toBeUndefined();
      expect(normalized.readOnly).toBeUndefined();
      expect(normalized.additionalProperties).toBeUndefined();
      // Non-existent property removed from required array
      expect(normalized.required).toEqual(["file_path", "old_string", "new_string"]);
    });

    it("sanitizes Claude Code Grep tool schema with anyOf union types", () => {
      const claudeGrepSchema = {
        type: "object",
        description: "Search file contents for regex pattern",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            description: "Target directory or file path",
            anyOf: [
              { type: "string", description: "Search directory path" },
              { type: "null" },
            ],
          },
          max_results: {
            description: "Max results limit",
            oneOf: [
              { type: "integer" },
              { type: "null" },
            ],
          },
        },
        required: ["pattern"],
      };

      const normalized = normalizeSchemaForCCA(claudeGrepSchema);

      expect(normalized.type).toBe("object");
      expect(normalized.properties.pattern.type).toBe("string");
      // anyOf collapsed into scalar string
      expect(normalized.properties.path.anyOf).toBeUndefined();
      expect(normalized.properties.path.type).toBe("string");
      // oneOf collapsed into scalar integer
      expect(normalized.properties.max_results.oneOf).toBeUndefined();
      expect(normalized.properties.max_results.type).toBe("integer");
      expect(normalized.required).toEqual(["pattern"]);
    });

    it("coerces boolean subschemas and guarantees explicit properties dictionary", () => {
      expect(coerceBooleanSubschema(true)).toEqual({});
      expect(coerceBooleanSubschema(false)).toEqual({ not: {} });

      const bareObjectSchema = {
        type: "object",
      };

      const normalizedBare = normalizeSchemaForCCA(bareObjectSchema);
      expect(normalizedBare.type).toBe("object");
      expect(normalizedBare.properties).toEqual({});

      const emptySchema = {};
      const normalizedEmpty = normalizeSchemaForCCA(emptySchema);
      expect(normalizedEmpty.type).toBe("object");
      expect(normalizedEmpty.properties).toEqual({});
    });

    it("collapses type arrays into first non-null scalar type", () => {
      const schemaWithTypeArray = {
        type: "object",
        properties: {
          query: {
            type: ["string", "null"],
            description: "Search query",
          },
          count: {
            type: ["number", "null"],
          },
        },
      };

      const normalized = normalizeSchemaForCCA(schemaWithTypeArray);
      expect(normalized.properties.query.type).toBe("string");
      expect(normalized.properties.count.type).toBe("number");
    });
  });

  describe("Antigravity Request Envelope & Routing", () => {
    it("configures primary and automatic failover SSE endpoints in registry", () => {
      expect(antigravityRegistry.transport.baseUrls).toEqual([
        "https://daily-cloudcode-pa.googleapis.com",
        "https://daily-cloudcode-pa.sandbox.googleapis.com",
      ]);
      expect(antigravityRegistry.oauth.loadCodeAssistEndpoint).toBe(
        "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
      );
      expect(antigravityRegistry.oauth.onboardUserEndpoint).toBe(
        "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser"
      );
      expect(CLOUD_CODE_API.antigravity.loadCodeAssist).toBe(
        "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
      );
      expect(CLOUD_CODE_API.antigravity.onboardUser).toBe(
        "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser"
      );
    });

    it("builds compliant Antigravity request envelope with trajectory labels and step index", () => {
      const executor = new AntigravityExecutor();
      const body = {
        model: "gemini-3.8-flash-high",
        request: {
          contents: [
            { role: "user", parts: [{ text: "List files" }] },
            { role: "model", parts: [{ functionCall: { name: "Bash", args: { command: "ls" } } }] },
            { role: "user", parts: [{ functionResponse: { name: "Bash", response: { output: "file1" } } }] },
          ],
          systemInstruction: {
            role: "system",
            parts: [{ text: "You are a coding assistant" }],
          },
          generationConfig: {
            temperature: 0.7,
            thinkingLevel: 2,
            maxOutputTokens: 16000,
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: "Bash",
                  description: "Execute bash command",
                  parameters: {
                    type: "object",
                    properties: {
                      command: { type: "string" },
                    },
                    additionalProperties: false,
                    $comment: "Bash tool",
                  },
                },
              ],
            },
          ],
        },
      };

      const credentials = {
        projectId: "test-companion-project-123",
        accessToken: "test-token",
        email: "developer@example.com",
      };

      const transformed = executor.transformRequest("gemini-3.8-flash-high", body, true, credentials);

      expect(transformed.project).toBe("test-companion-project-123");
      expect(transformed.model).toBe("gemini-3.8-flash-high");
      expect(transformed.userAgent).toBe("antigravity");
      expect(transformed.requestType).toBe("agent");
      expect(transformed.sessionId).toBeUndefined();
      expect(transformed.request.sessionId).toBeDefined();
      expect(transformed.request.sessionId).toMatch(/^-?\d+$/);

      // requestId format: agent/<uuid>/<timestamp>/<trajectoryId>/<stepIndex>
      expect(transformed.requestId).toMatch(/^agent\/[0-9a-f-]+\/\d+\/[0-9a-f-]+\/\d+$/);

      // systemInstruction.role normalized to user
      expect(transformed.request.systemInstruction.role).toBe("user");

      // labels populated
      expect(transformed.request.labels).toBeDefined();
      expect(transformed.request.labels.trajectory_id).toBeDefined();
      expect(transformed.request.labels.last_step_index).toBeDefined();
      expect(typeof transformed.request.labels.used_claude).toBe("string");

      // generationConfig sanitized
      expect(transformed.request.generationConfig.thinkingLevel).toBeUndefined();
      expect(transformed.request.generationConfig.maxOutputTokens).toBe(8192);
      expect(transformed.request.generationConfig.temperature).toBe(0.7);

      // toolConfig mode VALIDATED
      expect(transformed.request.toolConfig).toEqual({
        functionCallingConfig: { mode: "VALIDATED" },
      });

      // tool parameters normalized via normalizeSchemaForCCA
      const bashParams = transformed.request.tools[0].functionDeclarations[0].parameters;
      expect(bashParams.additionalProperties).toBeUndefined();
      expect(bashParams.$comment).toBeUndefined();
      expect(bashParams.properties.command.type).toBe("string");
    });
  });
});
