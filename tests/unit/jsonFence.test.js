import { describe, it, expect } from "vitest";
import { stripJsonFence, wantsJsonOutput, unfenceJsonChoices } from "../../open-sse/utils/jsonFence.js";

const JSON_MODE = { response_format: { type: "json_schema", json_schema: { name: "x", schema: {} } } };
const wrap = (content) => ({ choices: [{ message: { role: "assistant", content } }] });

describe("stripJsonFence", () => {
  it("unwraps a ```json fence", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("unwraps a bare ``` fence", () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves unfenced JSON untouched", () => {
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
  });

  it("leaves prose containing a fence untouched", () => {
    const prose = 'Here you go:\n```json\n{"a":1}\n```\nHope that helps.';
    expect(stripJsonFence(prose)).toBe(prose);
  });

  it("passes through non-strings", () => {
    expect(stripJsonFence(null)).toBe(null);
  });
});

describe("wantsJsonOutput", () => {
  it("is true for json_schema and json_object", () => {
    expect(wantsJsonOutput(JSON_MODE)).toBe(true);
    expect(wantsJsonOutput({ response_format: { type: "json_object" } })).toBe(true);
  });

  it("is false without response_format", () => {
    expect(wantsJsonOutput({})).toBe(false);
    expect(wantsJsonOutput({ response_format: { type: "text" } })).toBe(false);
  });
});

describe("unfenceJsonChoices", () => {
  it("unfences assistant content in JSON mode", () => {
    const out = unfenceJsonChoices(JSON_MODE, wrap('```json\n{"a":1}\n```'));
    expect(out.choices[0].message.content).toBe('{"a":1}');
  });

  it("leaves content alone when JSON was not requested", () => {
    const fenced = '```json\n{"a":1}\n```';
    expect(unfenceJsonChoices({}, wrap(fenced)).choices[0].message.content).toBe(fenced);
  });

  it("tolerates a tool-call message with null content", () => {
    const out = unfenceJsonChoices(JSON_MODE, wrap(null));
    expect(out.choices[0].message.content).toBe(null);
  });
});
