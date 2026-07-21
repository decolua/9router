import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTOML } from "confbox";

const DOC_PATH = fileURLToPath(new URL("../../docs/codex-gpt56.md", import.meta.url));

function readTomlSnippets() {
  const markdown = fs.readFileSync(DOC_PATH, "utf8");
  return [...markdown.matchAll(/```toml\n([\s\S]*?)```/g)].map((match) => parseTOML(match[1]));
}

describe("Codex GPT-5.6 configuration guide", () => {
  it("keeps every TOML snippet parseable", () => {
    const snippets = readTomlSnippets();
    expect(snippets).toHaveLength(5);
    expect(snippets.every((snippet) => snippet && typeof snippet === "object")).toBe(true);
  });

  it("documents four independent mode and effort profiles", () => {
    const [base, ...profiles] = readTomlSnippets();
    expect(base.model_provider).toBe("9router");
    expect(base.model_providers["9router"]).toMatchObject({
      base_url: "http://127.0.0.1:20128/v1",
      wire_api: "responses",
      env_key: "NINEROUTER_API_KEY",
    });
    expect(profiles.map(({ model, model_reasoning_effort: effort }) => [model, effort])).toEqual([
      ["cx/gpt-5.6-sol", "xhigh"],
      ["cx/gpt-5.6-sol", "max"],
      ["cx/gpt-5.6-sol-pro", "xhigh"],
      ["cx/gpt-5.6-sol-pro", "max"],
    ]);
  });
});
