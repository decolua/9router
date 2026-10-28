import { describe, it, expect } from "vitest";
import githubAdapter from "../../open-sse/handlers/embeddingProviders/github.js";

describe("github embeddings adapter buildBody", () => {
  it("wraps a bare string input into a one-element array", () => {
    const body = githubAdapter.buildBody("text-embedding-3-small", { input: "hello world" });
    expect(body.input).toEqual(["hello world"]);
  });

  it("keeps an array input unchanged", () => {
    const body = githubAdapter.buildBody("text-embedding-3-small", { input: ["a", "b"] });
    expect(body.input).toEqual(["a", "b"]);
  });

  it("keeps model, encoding_format and dimensions", () => {
    const body = githubAdapter.buildBody("text-embedding-3-small", {
      input: "hello world",
      encoding_format: "float",
      dimensions: 512,
    });
    expect(body).toEqual({
      model: "text-embedding-3-small",
      input: ["hello world"],
      encoding_format: "float",
      dimensions: 512,
    });
  });
});
