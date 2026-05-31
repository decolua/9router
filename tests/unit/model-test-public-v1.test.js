import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readRepoFile(path) {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
}

describe("model test routes", () => {
  it("uses the public /v1 endpoints for internal model reachability checks", () => {
    const route = readRepoFile("src/app/api/models/test/route.js");

    expect(route).toContain("`${baseUrl}/v1/chat/completions`");
    expect(route).toContain("`${baseUrl}/v1/embeddings`");
    expect(route).not.toContain("`${baseUrl}/api/v1/chat/completions`");
    expect(route).not.toContain("`${baseUrl}/api/v1/embeddings`");
  });

  it("uses the public /v1 endpoint when testing provider model lists", () => {
    const route = readRepoFile("src/app/api/providers/[id]/test-models/route.js");

    expect(route).toContain("`${baseUrl}/v1/chat/completions`");
    expect(route).not.toContain("`${baseUrl}/api/v1/chat/completions`");
  });
});
