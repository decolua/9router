import { describe, expect, it } from "vitest";
import { parseAutoModel } from "@/sse/services/autoModel.js";

describe("auto model parsing", () => {
  it("maps auto without suffix to the default kind", () => {
    expect(parseAutoModel("auto", "llm")).toEqual({
      strategy: "auto",
      kind: "llm",
      name: "auto",
    });
  });

  it("maps media suffixes to capability kinds", () => {
    expect(parseAutoModel("auto:image", "llm")).toMatchObject({ strategy: "auto", kind: "image" });
    expect(parseAutoModel("best:video", "llm")).toMatchObject({ strategy: "best", kind: "video" });
    expect(parseAutoModel("cheap:image-to-text", "llm")).toMatchObject({ strategy: "cheap", kind: "imageToText" });
  });

  it("ignores non-auto model names", () => {
    expect(parseAutoModel("openai/gpt-4o", "llm")).toBeNull();
  });
});
