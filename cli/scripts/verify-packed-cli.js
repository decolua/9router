#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const expectedDependencies = packageJson.bundleDependencies || [];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "9router-packed-cli-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function resolveTarball() {
  const outputDirectory = process.argv[2];
  if (outputDirectory) {
    return path.resolve(outputDirectory, `${packageJson.name}-${packageJson.version}.tgz`);
  }

  const packOutput = run("npm", ["pack", "--json", "--pack-destination", temporaryRoot]);
  const [{ filename }] = JSON.parse(packOutput);
  return path.join(temporaryRoot, filename);
}

try {
  const tarball = resolveTarball();
  if (!fs.existsSync(tarball)) {
    throw new Error(`npm pack did not produce ${tarball}`);
  }

  const entries = run("tar", ["-tzf", tarball]).split(/\r?\n/);
  for (const dependency of expectedDependencies) {
    const manifest = `package/node_modules/${dependency}/package.json`;
    if (!entries.includes(manifest)) {
      throw new Error(`packed tarball is missing bundled dependency: ${dependency}`);
    }
  }

  const installPrefix = path.join(temporaryRoot, "install");
  run("npm", [
    "install",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
    "--prefix",
    installPrefix,
    tarball,
  ]);

  const home = path.join(temporaryRoot, "home");
  const binary = path.join(installPrefix, "node_modules", ".bin", "9router");
  const version = run(binary, ["--version"], {
    cwd: installPrefix,
    env: {
      ...process.env,
      APPDATA: home,
      HOME: home,
      NINEROUTER_PACKAGE_MANAGER: "homebrew",
    },
  }).trim();

  if (version !== packageJson.version) {
    throw new Error(`packed CLI reported ${version}, expected ${packageJson.version}`);
  }

  console.log(`Verified packed ${packageJson.name}@${packageJson.version} installs and runs offline.`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
