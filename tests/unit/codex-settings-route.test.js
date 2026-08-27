import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTOML } from "confbox";

const originalHome = process.env.HOME;
const tempHomes = [];

afterEach(() => {
  process.env.HOME = originalHome;
  for (const tempHome of tempHomes.splice(0)) {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

describe("Codex settings route", () => {
  it("preserves provider auth and writes native reasoning settings", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "9router-codex-settings-"));
    tempHomes.push(tempHome);
    process.env.HOME = tempHome;

    const codexDir = path.join(tempHome, ".codex");
    fs.mkdirSync(codexDir);
    fs.writeFileSync(path.join(codexDir, "config.toml"), [
      'model = "old-model"',
      'model_provider = "9router"',
      "",
      "[model_providers.9router]",
      'name = "9Router"',
      'base_url = "http://old/v1"',
      'wire_api = "responses"',
      "",
      "[model_providers.9router.auth]",
      'command = "python3"',
      'args = ["-c", "print(\\\"preserve-me\\\")"]',
    ].join("\n"));

    const { POST } = await import("../../src/app/api/cli-tools/codex-settings/route.js");
    const response = await POST(new Request("http://localhost/api/cli-tools/codex-settings", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: "http://127.0.0.1:20128/v1",
        apiKey: "test-key",
        model: "cx/gpt-5.6-luna",
        subagentModel: "cx/gpt-5.6-luna",
        reasoningEffort: "high",
        serviceTier: "priority",
      }),
    }));

    expect(response.status).toBe(200);
    const config = parseTOML(fs.readFileSync(path.join(codexDir, "config.toml"), "utf8"));
    expect(config.model).toBe("cx/gpt-5.6-luna");
    expect(config.model_reasoning_effort).toBe("high");
    expect(config.service_tier).toBe("priority");
    expect(config.model_providers["9router"].auth.command).toBe("python3");
    expect(config.agents.subagent.description).toBe("Runs focused tasks delegated by Codex.");
    expect(JSON.parse(fs.readFileSync(path.join(codexDir, "auth.json"), "utf8")).OPENAI_API_KEY).toBe("test-key");
  });
});
