import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let testApi;
try {
  testApi = await import("vitest");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  testApi = await import("node:test");
}
const { afterEach, describe, it } = testApi;

const require = createRequire(import.meta.url);
const {
  assertNoBuildHomeArtifacts,
  assertRequiredApiArtifacts,
  copyStandaloneBuild,
  mergeServerArtifacts,
} = require("../../cli/scripts/build-cli.js");

const tempDirs = [];

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cli-build-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeFixture(root, relativePath, contents = relativePath) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function createCompleteServer(buildDistDir) {
  const serverDir = path.join(buildDistDir, "server");
  writeFixture(serverDir, "app/api/v1/chat/completions/route.js", "chat route");
  writeFixture(serverDir, "app/api/v1/messages/route.js", "messages route");
  writeFixture(serverDir, "chunks/openai-provider.js", "openai chunk");
  writeFixture(serverDir, "chunks/anthropic-provider.js", "anthropic chunk");
  return serverDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("CLI build server artifacts", () => {
  for (const { name, standalonePath } of [
    {
      name: "legacy nested app",
      standalonePath: (appDir, buildDistDir) => path.join(appDir, ".next", "standalone", "app"),
    },
    {
      name: "Next 16 workspace",
      standalonePath: (appDir, buildDistDir) => path.join(buildDistDir, "standalone", path.basename(appDir)),
    },
  ]) {
    it(`merges complete API routes and provider chunks for the ${name} layout`, () => {
      const root = createTempDir();
      const appDir = path.join(root, "9router");
      const buildDistDir = path.join(appDir, ".next-cli-build");
      const cliAppDir = path.join(root, "cli-app");
      const standaloneDir = standalonePath(appDir, buildDistDir);

      writeFixture(standaloneDir, "server.js", "standalone server");
      writeFixture(
        standaloneDir,
        ".next-cli-build/server/app/api/v1/chat/completions/route.js",
        "standalone chat route",
      );
      createCompleteServer(buildDistDir);

      copyStandaloneBuild(appDir, buildDistDir, cliAppDir);
      mergeServerArtifacts(buildDistDir, cliAppDir);
      assertRequiredApiArtifacts(cliAppDir);

      const packagedServer = path.join(cliAppDir, ".next-cli-build", "server");
      assert.equal(
        fs.readFileSync(path.join(packagedServer, "app/api/v1/messages/route.js"), "utf8"),
        "messages route",
      );
      assert.equal(
        fs.readFileSync(path.join(packagedServer, "chunks/openai-provider.js"), "utf8"),
        "openai chunk",
      );
      assert.equal(
        fs.readFileSync(path.join(packagedServer, "chunks/anthropic-provider.js"), "utf8"),
        "anthropic chunk",
      );
    });
  }

  it("merges idempotently without removing standalone-generated files", () => {
    const root = createTempDir();
    const buildDistDir = path.join(root, ".next-cli-build");
    const cliAppDir = path.join(root, "cli-app");
    const packagedServer = path.join(cliAppDir, ".next-cli-build", "server");

    createCompleteServer(buildDistDir);
    writeFixture(packagedServer, "standalone-only.js", "keep me");

    mergeServerArtifacts(buildDistDir, cliAppDir);
    mergeServerArtifacts(buildDistDir, cliAppDir);

    assert.equal(
      fs.readFileSync(path.join(packagedServer, "standalone-only.js"), "utf8"),
      "keep me",
    );
    assert.equal(
      fs.readFileSync(path.join(packagedServer, "app/api/v1/messages/route.js"), "utf8"),
      "messages route",
    );
  });

  it("reports the missing required API route artifact path", () => {
    const root = createTempDir();
    const buildDistDir = path.join(root, ".next-cli-build");
    const cliAppDir = path.join(root, "cli-app");

    writeFixture(
      path.join(buildDistDir, "server"),
      "app/api/v1/chat/completions/route.js",
      "chat route",
    );
    mergeServerArtifacts(buildDistDir, cliAppDir);

    assert.throws(
      () => assertRequiredApiArtifacts(cliAppDir),
      (error) => error.message.includes(path.join(
        cliAppDir,
        ".next-cli-build/server/app/api/v1/messages/route.js",
      )),
    );
  });
});

// The CLI build points HOME/USERPROFILE at cli/.build-home so the dashboard build
// cannot touch the operator's real ~/.9router. With NEXT_TRACING_ROOT_MODE=workspace
// the tracing root is the repo's parent, so that fake home sits INSIDE the trace
// scope and Next.js lists its files in .nft.json — which is how a build-machine
// jwt-secret, machine-id and data.sqlite ended up in the published tarball.
describe("CLI build never ships the build-machine home", () => {
  const LEAK_PATHS = [
    "cli/.build-home/AppData/Roaming/9router/jwt-secret",
    "cli/.build-home/AppData/Roaming/9router/machine-id",
    "cli/.build-home/AppData/Roaming/9router/db/data.sqlite",
    "cli/.build-home/AppData/Roaming/9router/db/data.sqlite-wal",
  ];

  it("drops a traced .build-home tree while copying the standalone build", () => {
    const root = createTempDir();
    const appDir = path.join(root, "9router");
    const buildDistDir = path.join(appDir, ".next-cli-build");
    const cliAppDir = path.join(root, "cli-app");
    const standaloneDir = path.join(buildDistDir, "standalone", path.basename(appDir));

    writeFixture(standaloneDir, "server.js", "standalone server");
    writeFixture(standaloneDir, "server.js.nft.json", '{"files":[]}');
    writeFixture(
      standaloneDir,
      ".next-cli-build/server/app/api/v1/chat/completions/route.js",
      "standalone chat route",
    );
    // Exactly the layout Next.js produced: the fake home nested under the bundle root.
    for (const leakPath of LEAK_PATHS) {
      writeFixture(path.join(standaloneDir, "cli"), leakPath.slice("cli/".length), "secret");
    }

    copyStandaloneBuild(appDir, buildDistDir, cliAppDir);

    assert.equal(fs.existsSync(path.join(cliAppDir, "server.js")), true, "server.js must survive");
    for (const leakPath of LEAK_PATHS) {
      const copied = path.join(cliAppDir, leakPath);
      assert.equal(fs.existsSync(copied), false, `${leakPath} must not be copied into the bundle`);
    }
  });

  it("scrubs .nft.json entries that point at the build-machine home", () => {
    const root = createTempDir();
    const appDir = path.join(root, "9router");
    const buildDistDir = path.join(appDir, ".next-cli-build");
    const cliAppDir = path.join(root, "cli-app");
    const standaloneDir = path.join(buildDistDir, "standalone", path.basename(appDir));

    writeFixture(standaloneDir, "server.js", "standalone server");
    writeFixture(
      standaloneDir,
      "server.js.nft.json",
      JSON.stringify({
        version: 1,
        files: [
          "../../../../../../cli/.build-home/AppData/Roaming/9router/jwt-secret",
          "server.js",
        ],
      }),
    );

    copyStandaloneBuild(appDir, buildDistDir, cliAppDir);

    const trace = JSON.parse(fs.readFileSync(path.join(cliAppDir, "server.js.nft.json"), "utf8"));
    assert.deepEqual(trace.files, ["server.js"], "leaked trace entries are removed, real ones kept");
  });

  it("leaves an unrelated home directory alone", () => {
    const root = createTempDir();
    const appDir = path.join(root, "9router");
    const buildDistDir = path.join(appDir, ".next-cli-build");
    const cliAppDir = path.join(root, "cli-app");
    const standaloneDir = path.join(buildDistDir, "standalone", path.basename(appDir));

    writeFixture(standaloneDir, "server.js", "standalone server");
    writeFixture(standaloneDir, "home/notes.md", "keep");

    copyStandaloneBuild(appDir, buildDistDir, cliAppDir);

    assert.equal(
      fs.readFileSync(path.join(cliAppDir, "home/notes.md"), "utf8"),
      "keep",
      "only .build-home is scrubbed, not every folder named home",
    );
  });

  it("fails the build when a stray .build-home survives", () => {
    const root = createTempDir();
    const cliAppDir = path.join(root, "cli-app");
    writeFixture(cliAppDir, "server.js", "standalone server");

    assert.doesNotThrow(() => assertNoBuildHomeArtifacts(cliAppDir));

    writeFixture(cliAppDir, "cli/.build-home/AppData/Roaming/9router/jwt-secret", "secret");

    assert.throws(
      () => assertNoBuildHomeArtifacts(cliAppDir),
      (error) =>
        error.message.includes("build-machine home") &&
        error.message.includes("jwt-secret"),
    );
  });
});
