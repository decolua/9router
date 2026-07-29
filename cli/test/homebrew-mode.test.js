const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const { getUpdateCommand, isHomebrewManaged } = require("../hooks/packageManager");
const { buildEnvWithRuntime } = require("../hooks/sqliteRuntime");

test("Homebrew mode selects Homebrew update guidance", () => {
  const env = { NINEROUTER_PACKAGE_MANAGER: "homebrew" };
  assert.strictEqual(isHomebrewManaged(env), true);
  assert.strictEqual(getUpdateCommand("9router", env), "brew update && brew upgrade 9router");
});

test("npm mode retains npm update guidance", () => {
  assert.strictEqual(isHomebrewManaged({}), false);
  assert.strictEqual(getUpdateCommand("9router", {}), "npm i -g 9router@latest --prefer-online");
});

test("Homebrew mode excludes the user runtime from NODE_PATH", () => {
  const home = path.join(os.tmpdir(), "9router-homebrew-node-path");
  const environment = buildEnvWithRuntime({
    HOME: home,
    NODE_PATH: "/existing/node-path",
    NINEROUTER_PACKAGE_MANAGER: "homebrew",
  });

  assert.strictEqual(environment.NODE_PATH.includes(path.join(home, ".9router", "runtime")), false);
  assert.match(environment.NODE_PATH, /\/existing\/node-path$/);
});

test("Homebrew mode does not create a runtime dependency directory", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "9router-homebrew-mode-"));
  try {
    const output = execFileSync(process.execPath, ["cli.js", "--version"], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APPDATA: home,
        HOME: home,
        NINEROUTER_PACKAGE_MANAGER: "homebrew",
      },
    });

    assert.match(output, /^0\.5\.40\s*$/);
    assert.strictEqual(fs.existsSync(path.join(home, ".9router", "runtime")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Homebrew postinstall does not warm up runtime dependencies", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "9router-homebrew-postinstall-"));
  try {
    const output = execFileSync(process.execPath, ["hooks/postinstall.js"], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APPDATA: home,
        HOME: home,
        NINEROUTER_PACKAGE_MANAGER: "homebrew",
      },
    });

    assert.match(output, /skipping npm runtime warm-up/);
    assert.strictEqual(fs.existsSync(path.join(home, ".9router", "runtime")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
