import { describe, expect, it } from "vitest";
import { customJsonForm, parseCustomJsonForm } from "@/shared/utils/customJsonForm.js";
import { buildCustomJsonRequest, extractCustomJsonText } from "open-sse/utils/customJson.js";

const endpoint = "https://example.com/v1/chat/completions";
const body = { messages: [{ role: "user", content: "hello" }] };
const field = (name, value, type = "text") => ({ id: name || "empty", name, value, type });

describe("custom JSON default template and optional fields", () => {
  it("can save and call a standard chat endpoint without adding any extra fields", () => {
    const form = customJsonForm();
    expect(form.templateMode).toBe("fields");
    expect(form.extraFields).toEqual([]);
    const config = parseCustomJsonForm(form, endpoint);
    expect(buildCustomJsonRequest(config, "chat-model", body)).toEqual({ model: "chat-model", messages: body.messages });
    expect(extractCustomJsonText(config, { choices: [{ message: { content: "hello back" } }] })).toBe("hello back");
  });
  it("ignores an untouched added row and keeps a named empty text value", () => {
    const config = parseCustomJsonForm({ ...customJsonForm(), extraFields: [field("", ""), field("optional_label", "")] }, endpoint);
    expect(buildCustomJsonRequest(config, "chat-model", body)).toEqual({ model: "chat-model", messages: body.messages, optional_label: "" });
  });
  it("adds text, placeholders and typed JSON values alongside model and messages", () => {
    const config = parseCustomJsonForm({ ...customJsonForm(), extraFields: [
      field("project_id", "demo-project"), field("question", "{{prompt}}"), field("temperature", "0.5", "json"),
      field("enabled", "false", "json"), field("options", '{"tags":["demo"]}', "json"),
    ] }, endpoint);
    expect(buildCustomJsonRequest(config, "chat-model", body)).toEqual({
      model: "chat-model", messages: body.messages, project_id: "demo-project", question: "hello", temperature: 0.5, enabled: false, options: { tags: ["demo"] },
    });
  });
  it("restores saved extra fields and stops sending a field after it is removed", () => {
    const config = parseCustomJsonForm({ ...customJsonForm(), extraFields: [field("project_id", "demo-project"), field("temperature", "0", "json")] }, endpoint);
    const restored = customJsonForm(config);
    expect(restored.templateMode).toBe("fields");
    expect(restored.extraFields.map(({ name, type }) => ({ name, type }))).toEqual([{ name: "project_id", type: "text" }, { name: "temperature", type: "json" }]);
    restored.extraFields = restored.extraFields.filter(({ name }) => name !== "project_id");
    const request = buildCustomJsonRequest(parseCustomJsonForm(restored, endpoint), "chat-model", body);
    expect(request).not.toHaveProperty("project_id");
    expect(request.temperature).toBe(0);
  });
  it.each([
    [field("model", "override")], [field("messages", "override")], [field("x", "a"), field("x", "b")],
    [field("", "demo-project")], [field("temperature", "invalid JSON", "json")], [field("__proto__", "bad")],
  ])("rejects invalid added fields without losing the default template", (...extraFields) => {
    expect(() => parseCustomJsonForm({ ...customJsonForm(), extraFields }, endpoint)).toThrow();
    expect(parseCustomJsonForm(customJsonForm(), endpoint).requestTemplate).toEqual({ model: "{{model}}", messages: "{{messages}}" });
  });
  it("preserves existing business-only templates in advanced JSON mode", () => {
    const existing = { requestTemplate: { project_id: "{{prompt}}" }, responsePath: "data.answer" };
    const restored = customJsonForm(existing);
    expect(restored.templateMode).toBe("json");
    expect(parseCustomJsonForm(restored, endpoint).requestTemplate).toEqual(existing.requestTemplate);
  });
});
