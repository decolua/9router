import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const cli = "../../cli/src/cli/";
const api = require(cli + "api/client");
const input = require(cli + "utils/input");
const key = { id: "key/1", name: "Build", key: "test-secret", allowedConnections: ["a"] };
let picker, log, list, save;

async function openAction() {
  await require(cli + "menus/apiKeys").showApiKeysMenu(20128);
}

beforeEach(() => {
  for (const file of ["menus/apiKeys", "utils/menuHelper"]) {
    delete require.cache[require.resolve(cli + file)];
  }
  vi.spyOn(api, "getTunnelStatus").mockResolvedValue({ success: false });
  vi.spyOn(api, "getApiKeys").mockResolvedValue({ success: true, data: { keys: [{ ...key }] } });
  vi.spyOn(input, "selectMenu")
    .mockImplementationOnce(async (_, items) => items.findIndex(item => item.label.startsWith("Build (")))
    .mockImplementationOnce(async (_, items) => items.findIndex(item => item.label === "Allowed accounts"))
    .mockResolvedValue(0);
  vi.spyOn(input, "pause").mockResolvedValue();
  picker = vi.spyOn(input, "multiSelect");
  list = vi.spyOn(api, "getProviders").mockResolvedValue({
    success: true,
    data: { connections: [
      { id: "a", provider: "codex", name: "Build", email: "me@example.org" },
      { id: "b", provider: "node", providerSpecificData: { nodeName: "Research" }, name: "Lab" },
    ] },
  });
  save = vi.spyOn(api, "setAllowedAccounts").mockResolvedValue({ success: true });
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it.each([["b"], []].map(selected => ({ selected })))("saves exactly the selected IDs: $selected", async ({ selected }) => {
  picker.mockResolvedValue(selected);
  await openAction();
  expect(log).toHaveBeenCalledWith("Allowed accounts: codex · Build · me@example.org");
  expect(picker.mock.calls[0][0]).toMatchObject({
    initial: ["a"],
    choices: [
      { name: "a", message: "codex · Build · me@example.org" },
      { name: "b", message: "Research · Lab" },
    ],
  });
  expect(save).toHaveBeenCalledWith(key.id, selected);
});

it("does not clear the policy on cancel", async () => {
  picker.mockResolvedValue(null);
  await openAction();
  expect(save).not.toHaveBeenCalled();
});

it.each(["list", "save"])("explains denied %s requests", async step => {
  const failure = { success: false, statusCode: step === "list" ? 401 : 403 };
  (step === "list" ? list : save).mockResolvedValue(failure);
  picker.mockResolvedValue([]);
  await openAction();
  expect(log.mock.calls.flat().join(" ")).toContain(`Administrator access required (HTTP ${failure.statusCode})`);
  if (step === "list") expect(save).not.toHaveBeenCalled();
});
