import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../cli/src/cli/menus/combos.js", import.meta.url), "utf8");

// Exercise the public menu action, replacing terminal I/O and API calls only.
async function createFromMenu(models, answers, success = true) {
  const queue = [...answers];
  const api = {
    getModels: vi.fn(async () => ({ success, data: { models }, error: "offline" })),
    createCombo: vi.fn(async () => ({ success: true })),
  };
  const showStatus = vi.fn();
  const dependencies = {
    "../api/client": api,
    "../utils/input": {
      prompt: async () => {
        if (!queue.length) throw new Error("Unexpected extra prompt");
        return queue.shift();
      },
      pause: async () => {},
    },
    "../utils/display": { clearScreen() {}, showStatus },
    "../utils/format": {},
    "../utils/modelSelector": {},
    "../utils/menuHelper": {
      showListMenu: async ({ createAction }) => createAction.action(),
    },
  };
  const cjsModule = { exports: {} };
  runInNewContext(source, {
    module: cjsModule,
    require: (id) => {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    console: { log() {} },
  });
  await cjsModule.exports.showCombosMenu();
  return { api, showStatus };
}

describe("TUI combo creation", () => {
  it("submits model identifiers rather than catalog objects, preserving selection order", async () => {
    const models = [
      { provider: "antigravity", model: "gemini-test", fullModel: "antigravity/gemini-test", routedModel: "ag/gemini-test", name: "Friendly label", caps: { vision: true } },
      { provider: "custom", model: "org/model", fullModel: "custom/org/model", name: "Another label" },
    ];
    const { api } = await createFromMenu(models, ["test-combo", "2", "1", "done"]);
    expect(api.createCombo).toHaveBeenCalledExactlyOnceWith({
      name: "test-combo",
      models: ["custom/org/model", "ag/gemini-test"],
    });
  });

  it("supports catalogs without fullModel or routedModel and retains repeated selections", async () => {
    const { api } = await createFromMenu(
      [{ provider: "ag", model: "org/model" }],
      ["legacy", "1", "1", "done"],
    );
    expect(api.createCombo).toHaveBeenCalledExactlyOnceWith({
      name: "legacy", models: ["ag/org/model", "ag/org/model"],
    });
  });

  it("does not save a cancelled selection", async () => {
    const { api } = await createFromMenu([{ provider: "ag", model: "test" }], ["cancelled", "1", "cancel"]);
    expect(api.createCombo).not.toHaveBeenCalled();
  });

  it("keeps the minimum-two-model guard", async () => {
    const { api, showStatus } = await createFromMenu([{ provider: "ag", model: "test" }], ["short", "1", "done", "cancel"]);
    expect(showStatus).toHaveBeenCalledWith("Please select at least 2 models", "error");
    expect(api.createCombo).not.toHaveBeenCalled();
  });

  it("does not save when model discovery fails", async () => {
    const { api } = await createFromMenu([], ["offline"], false);
    expect(api.createCombo).not.toHaveBeenCalled();
  });
});
