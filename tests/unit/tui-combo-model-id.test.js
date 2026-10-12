import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { comboModelId } = require("../../cli/src/cli/utils/comboModelId.js");

describe("TUI combo model identifiers", () => {
  it("uses fullModel for /api/models records", () => {
    expect(comboModelId({ provider: "ag", model: "gemini-3.8-flash", fullModel: "ag/gemini-3.8-flash" }))
      .toBe("ag/gemini-3.8-flash");
  });

  it("falls back to provider/model and rejects invalid objects", () => {
    expect(comboModelId({ provider: "ag", model: "gemini-3.8-flash" })).toBe("ag/gemini-3.8-flash");
    expect(comboModelId({ provider: "ag" })).toBeNull();
  });
});
