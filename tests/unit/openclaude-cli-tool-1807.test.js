// #1807 — OpenClaude CLI tool entry. DefaultToolCard renders "Coming soon..." for any
// tool without guideSteps, so the registry data is the whole feature here. The command
// shape is pinned because it was verified against openclaude 0.28.0: env vars alone stop
// at "Not logged in", and only --provider openai actually reaches the endpoint.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const { CLI_TOOLS } = await import("../../src/shared/constants/cliTools.js");

const tool = CLI_TOOLS.openclaude;

describe("openclaude cli tool", () => {
  it("is registered separately from the existing openclaw entry", () => {
    expect(tool.id).toBe("openclaude");
    expect(tool.name).toBe("OpenClaude");
    expect(CLI_TOOLS.openclaw.id).toBe("openclaw");
    expect(CLI_TOOLS.openclaw.name).not.toBe(tool.name);
  });

  it("ships the icon its image path points at", () => {
    expect(tool.image).toBe("/providers/openclaude.png");
    const icon = fileURLToPath(new URL("../../public/providers/openclaude.png", import.meta.url));
    expect(fs.existsSync(icon)).toBe(true);
  });

  it("renders a real card rather than the Coming soon fallback", () => {
    expect(tool.configType).toBe("guide");
    expect(Array.isArray(tool.guideSteps)).toBe(true);
    expect(tool.guideSteps.length).toBeGreaterThan(0);
  });

  it("keeps the placeholders DefaultToolCard substitutes", () => {
    const { code } = tool.codeBlock;

    expect(tool.codeBlock.language).toBe("bash");
    expect(code).toContain("{{baseUrl}}");
    expect(code).toContain("{{apiKey}}");
    expect(code).toContain("{{model}}");
  });

  it("exports the env vars openclaude actually reads", () => {
    const { code } = tool.codeBlock;

    expect(code).toContain('export OPENAI_BASE_URL="{{baseUrl}}"');
    expect(code).toContain('export OPENAI_API_KEY="{{apiKey}}"');
    expect(code).toContain('export OPENAI_MODEL="{{model}}"');
  });

  it("passes --provider openai, without which openclaude ignores the env vars", () => {
    expect(tool.codeBlock.code).toContain("openclaude --provider openai");
    expect(tool.notes.some((n) => n.text.includes("--provider openai"))).toBe(true);
  });

  it("covers Windows, where the export syntax does not apply", () => {
    expect(tool.codeBlock.code).toContain("$env:OPENAI_BASE_URL");
  });

  it("offers the api key and model selectors the card knows how to render", () => {
    const types = tool.guideSteps.map((s) => s.type).filter(Boolean);

    expect(types).toContain("apiKeySelector");
    expect(types).toContain("modelSelector");
  });
});
