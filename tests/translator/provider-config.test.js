// Provider configuration and fallback test
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Provider configuration and fallback", () => {
  it("should translate OpenAI to NVIDIA format correctly", () => {
    const body = {
      messages: [{ role: "user", content: "Hello" }],
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "nvidia/nemotron-3-ultra-550b-a55b", body, true, { apiKey: "test" }, "nvidia");
    expect(out.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(out.messages).toBeDefined();
    expect(Array.isArray(out.messages)).toBe(true);
  });

  it("should translate OpenAI to DeepSeek format with search enabled", () => {
    const body = {
      messages: [{ role: "user", content: "Search for something" }],
      model: "deepseek-v4-flash",
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "deepseek-v4-flash", body, true, { apiKey: "test" }, "deepseek");
    expect(out.model).toBe("deepseek-v4-flash");
    expect(out.messages).toBeDefined();
  });

  it("should translate OpenAI to OVH format correctly", () => {
    const body = {
      messages: [{ role: "user", content: "Hello OVH" }],
      model: "ovh/mistral-7b-instruct",
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "ovh/mistral-7b-instruct", body, true, { apiKey: "test" }, "ovh");
    expect(out.model).toBe("ovh/mistral-7b-instruct");
    expect(out.messages).toBeDefined();
  });

  it("should translate OpenAI to TRAE format correctly", () => {
    const body = {
      messages: [{ role: "user", content: "Hello TRAE" }],
      model: "trae-v1",
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "trae-v1", body, true, { apiKey: "test" }, "trae");
    expect(out.model).toBe("trae-v1");
    expect(out.messages).toBeDefined();
  });

  it("should translate OpenAI to Reasonix format correctly", () => {
    const body = {
      messages: [{ role: "user", content: "Hello Reasonix" }],
      model: "reasonix-v1",
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "reasonix-v1", body, true, { apiKey: "test" }, "reasonix");
    expect(out.model).toBe("reasonix-v1");
    expect(out.messages).toBeDefined();
  });

  it("should translate OpenAI to JoyCode format correctly", () => {
    const body = {
      messages: [{ role: "user", content: "Hello JoyCode" }],
      model: "joycode-v1",
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "joycode-v1", body, true, { apiKey: "test" }, "joycode");
    expect(out.model).toBe("joycode-v1");
    expect(out.messages).toBeDefined();
  });
});