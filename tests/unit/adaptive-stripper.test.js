import { describe, it, expect } from "vitest";
import {
  getRejectedFields,
  addRejectedFields,
  stripRejectedFields,
  extractRejectedFieldNamesFromError,
} from "../../open-sse/utils/adaptiveStripper.js";

describe("adaptiveStripper", () => {
  describe("extractRejectedFieldNamesFromError", () => {
    it("parses Groq-style error message", () => {
      const msg = "'messages.3' : for 'role:assistant' the following must be satisfied[('messages.3' : property 'reasoning_content' is unsupported)]";
      const fields = extractRejectedFieldNamesFromError(msg);
      expect(fields).toContain("reasoning_content");
    });

    it("parses unsupported field error", () => {
      const msg = "'messages.3' : for 'role:assistant' the following must be satisfied[('messages.3' : property 'encrypted_content' is unsupported)]";
      const fields = extractRejectedFieldNamesFromError(msg);
      expect(fields).toContain("encrypted_content");
    });

    it("parses Mistral-style 422 extra_forbidden error (issue #1649)", () => {
      const body = {
        error: {
          detail: [
            {
              type: "extra_forbidden",
              loc: ["body", "messages", 2, "assistant", "reasoning_content"],
              msg: "Extra inputs are not permitted"
            }
          ]
        }
      };
      const fields = extractRejectedFieldNamesFromError(body);
      expect(fields).toContain("reasoning_content");
    });

    it("parses NVIDIA-style Unsupported parameter error with backticks", () => {
      const body = {
        error: {
          message: "Validation: Unsupported parameter(s): `extra_param`",
          type: "Bad Request",
          code: 400
        }
      };
      const fields = extractRejectedFieldNamesFromError(body);
      expect(fields).toContain("extra_param");
    });

    it("extracts field from Groq-style bracketed error", () => {
      const msg = "'messages.3' : for 'role:assistant' the following must be satisfied[('messages.3' : property 'reasoning_content' is unsupported)]";
      const fields = extractRejectedFieldNamesFromError(msg);
      expect(fields).toContain("reasoning_content");
    });
  });

  describe("addRejectedFields / getRejectedFields", () => {
    it("adds and retrieves rejected fields for provider+model", () => {
      const set = addRejectedFields("groq", "gpt-oss-120b", ["reasoning_content", "foo"]);
      expect(set.has("reasoning_content")).toBe(true);
      expect(set.has("foo")).toBe(true);
      const retrieved = getRejectedFields("groq", "gpt-oss-120b");
      expect(retrieved.has("reasoning_content")).toBe(true);
    });

    it("normalizes fields to lowercase", () => {
      const set = addRejectedFields("groq", "test-normalize", ["Reasoning_Content"]);
      expect(set.has("reasoning_content")).toBe(true);
    });
  });

  describe("stripRejectedFields", () => {
    it("removes blocked fields from messages", () => {
      const body = {
        messages: [
          { role: "assistant", content: "hi", reasoning_content: "" },
          { role: "user", content: "bye" },
        ],
      };
      addRejectedFields("test-stripper", "model-a", ["reasoning_content"]);
      const result = stripRejectedFields(body, "test-stripper", "model-a");
      expect(result.messages[0].reasoning_content).toBeUndefined();
      expect(result.messages[0].content).toBe("hi");
      expect(result.messages[1].role).toBe("user");
    });

    it("returns body unchanged when no fields rejected", () => {
      const body = { messages: [{ role: "user", content: "hi" }] };
      const result = stripRejectedFields(body, "no-blocklist", "nomodel");
      expect(result).toBe(body);
    });

    it("returns null when blocklist has no matching fields", () => {
      const body = { messages: [{ role: "user", content: "hi", reasoning_content: "x" }] };
      addRejectedFields("test-nostrip", "m1", ["totally_unrelated_field"]);
      const result = stripRejectedFields(body, "test-nostrip", "m1");
      expect(result).toBe(null);
    });
  });
});
