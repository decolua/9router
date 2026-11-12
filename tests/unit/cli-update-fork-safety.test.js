import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const forkPackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "cli", "package.json"), "utf8"));
const { checkForUpdate, createUpdateOffer } = require("../../cli/src/cli/utils/updateCheck.js");

function nextPatchVersion(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

describe("DF-9ROUTER-68 — fork-safe CLI update offer", () => {
  it("labels a mocked newer npm registry version as an upstream install that removes federation", async () => {
    const latestVersion = nextPatchVersion(forkPackage.version);
    const spinner = { start: vi.fn(), stop: vi.fn() };
    spinner.start.mockReturnValue(spinner);
    const httpsGet = vi.fn((_url, _options, onResponse) => {
      const request = new EventEmitter();
      request.destroy = vi.fn();
      queueMicrotask(() => {
        const response = new EventEmitter();
        onResponse(response);
        response.emit("data", JSON.stringify({ version: latestVersion }));
        response.emit("end");
      });
      return request;
    });

    const offer = await checkForUpdate({
      pkg: forkPackage,
      skipUpdate: false,
      createSpinner: () => spinner,
      httpsGet,
    });

    expect(httpsGet).toHaveBeenCalledWith(
      "https://registry.npmjs.org/9router/latest",
      { timeout: 3000 },
      expect.any(Function),
    );
    expect(forkPackage.federationFork).toBe(true);
    expect(offer).toEqual({
      kind: "upstream-replaces-fork",
      latestVersion,
      installCommand: "npm i -g 9router@latest --prefer-online",
      label: `Install upstream v${latestVersion} (removes federation)`,
    });
    expect(offer.label).not.toContain("Update to");
    expect(spinner.stop).toHaveBeenCalledTimes(1);

    const launcher = fs.readFileSync(path.join(REPO_ROOT, "cli", "cli.js"), "utf8");
    expect(launcher).toContain("const updatePromise = checkForUpdate({ pkg, skipUpdate, createSpinner });");
    expect(launcher).toContain("menuItems.push({ label: updateOffer.label, icon: \"⬆\" });");
    expect(launcher).toContain("This replaces this federation fork with upstream 9router.");
  });

  it("keeps the existing update wording for upstream builds", () => {
    expect(createUpdateOffer({ name: "9router", version: "0.5.104" }, "0.5.105")).toEqual({
      kind: "update",
      latestVersion: "0.5.105",
      installCommand: "npm i -g 9router@latest --prefer-online",
      label: "Update to v0.5.105 (current: v0.5.104)",
    });
  });
});
