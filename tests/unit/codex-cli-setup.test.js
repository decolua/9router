import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cliToolsPath = fileURLToPath(new URL("../../cli/src/cli/menus/cliTools.js", import.meta.url));
const cliDir = dirname(cliToolsPath);
const dependencyPaths = {
  api: resolve(cliDir, "../api/client.js"),
  input: resolve(cliDir, "../utils/input.js"),
  display: resolve(cliDir, "../utils/display.js"),
  modelSelector: resolve(cliDir, "../utils/modelSelector.js"),
  menuHelper: resolve(cliDir, "../utils/menuHelper.js"),
  endpoint: resolve(cliDir, "../utils/endpoint.js"),
};

const mocks = {
  getApiKeys: vi.fn(),
  getAvailableModels: vi.fn(),
  getProviders: vi.fn(),
  applyCliToolSettings: vi.fn(),
  showStatus: vi.fn(),
  pause: vi.fn(),
  prompt: vi.fn(),
  clearScreen: vi.fn(),
  getEndpoint: vi.fn(),
  showMenuWithBack: vi.fn(),
};
let previousModules;

function loadCliToolsWithMocks() {
  previousModules = new Map();
  const exportsByPath = new Map([
    [dependencyPaths.api, {
      getApiKeys: mocks.getApiKeys,
      getAvailableModels: mocks.getAvailableModels,
      getProviders: mocks.getProviders,
      applyCliToolSettings: mocks.applyCliToolSettings,
    }],
    [dependencyPaths.input, {
      pause: mocks.pause,
      prompt: mocks.prompt,
      clearScreen: mocks.clearScreen,
      confirm: vi.fn(),
      select: vi.fn(),
    }],
    [dependencyPaths.display, { showStatus: mocks.showStatus, clearScreen: mocks.clearScreen }],
    [dependencyPaths.menuHelper, { showMenuWithBack: mocks.showMenuWithBack }],
    [dependencyPaths.endpoint, { getEndpoint: mocks.getEndpoint }],
  ]);

  for (const path of Object.values(dependencyPaths)) previousModules.set(path, require.cache[path]);
  for (const [path, exports] of exportsByPath) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  }
  delete require.cache[dependencyPaths.modelSelector];
  delete require.cache[cliToolsPath];
  return require(cliToolsPath);
}

afterEach(() => {
  delete require.cache[cliToolsPath];
  for (const [path, cachedModule] of previousModules || []) {
    if (cachedModule) require.cache[path] = cachedModule;
    else delete require.cache[path];
  }
  vi.restoreAllMocks();
});

describe("Codex CLI quick setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeys.mockResolvedValue({ success: true, data: { keys: [{ key: "router-key" }] } });
    mocks.getAvailableModels.mockResolvedValue({
      success: true,
      data: { data: [{ id: "cx/gpt-6.1-sol", owned_by: "cx" }] },
    });
    mocks.getProviders.mockResolvedValue({ success: true, data: { connections: [{ provider: "codex" }] } });
    mocks.applyCliToolSettings.mockResolvedValue({ success: true });
    mocks.getEndpoint.mockResolvedValue({ endpoint: "http://localhost:20128/v1" });
    mocks.prompt.mockResolvedValue("");
    mocks.showMenuWithBack.mockImplementation(async ({ title, items }) => {
      if (title === "🔧 CLI Tools") {
        await items.find((item) => item.label === "Codex CLI").action();
      } else if (title === "🤖 Codex CLI Settings") {
        await items.find((item) => item.label === "⚡ Quick Setup").action();
      }
    });
  });

  it("shows and applies a Codex model by default", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const { showCliToolsMenu } = loadCliToolsWithMocks();
    await showCliToolsMenu(20128);
    const output = consoleLog.mock.calls.map(([line]) => String(line)).join("\n");

    expect(output).toContain("Default: cx/gpt-6.1-sol");
    expect(mocks.applyCliToolSettings).toHaveBeenCalledWith("codex", {
      baseUrl: "http://localhost:20128/v1",
      apiKey: "router-key",
      model: "cx/gpt-6.1-sol",
    });
  });
  it("keeps explicit cancellation separate from accepting the default", async () => {
    mocks.prompt.mockResolvedValue("0");
    const { showCliToolsMenu } = loadCliToolsWithMocks();

    await showCliToolsMenu(20128);

    expect(mocks.applyCliToolSettings).not.toHaveBeenCalled();
  });

});
