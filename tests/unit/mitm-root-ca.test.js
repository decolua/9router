import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);

function loadRootCAWithDataDir(dataDir) {
  const rootCAPath = require.resolve("../../src/mitm/cert/rootCA.js");
  const pathsPath = require.resolve("../../src/mitm/paths.js");
  delete require.cache[rootCAPath];
  delete require.cache[pathsPath];

  const oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    return require("../../src/mitm/cert/rootCA.js");
  } finally {
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
  }
}

describe("MITM Root CA generation", () => {
  it("creates Root CA files synchronously for direct server startup", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mitm-ca-"));
    const { generateRootCA } = loadRootCAWithDataDir(dataDir);

    generateRootCA();

    expect(fs.existsSync(path.join(dataDir, "mitm", "rootCA.key"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "mitm", "rootCA.crt"))).toBe(true);
  });
});
