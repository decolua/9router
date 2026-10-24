// DF-9ROUTER-67 — the documented fresh-machine build must run on the Node the
// docs tell the user to install.
//
// Dogfood run 17 followed the README's no-root toolchain recipe verbatim on a
// bare Debian box (no node/npm in the image), which pinned **Node v22.14.0**.
// `npm ci` succeeded in 38 s, then `npm run build` died in page-data
// collection:
//
//   Error: Failed to collect configuration for /api/oauth/[provider]/[action]
//     [cause]: TypeError: Cannot read properties of undefined (reading 'bind')
//
// Root cause: the app imports `undici` 8, whose decompression coding table is
// built at MODULE LOAD with
// `zlib.createZstdDecompress.bind(null, {...})`. `zlib.createZstdDecompress`
// landed in Node 22.15.0 and undici 8 declares `engines.node >= 22.19.0`, so on
// 22.14 the left side of that `.bind` is `undefined` and every /api route that
// pulls undici in fails to load. The same HEAD built green on the fleet host
// (Node 22.22/22.23) — an environment-drift bug that no gate caught, because
// nothing tied the documented Node version to a declared floor.
//
// This suite pins that tie: package.json owns the floor, README's recipe must
// satisfy it, and the preflight named by `prebuild` must fail loudly (and name
// the requirement) instead of letting `next build` print a bare TypeError.
import { describe, expect, it } from "vitest";
import fs from "fs";
import { spawnSync } from "child_process";

const PKG = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const README = fs.readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const CHECK_SCRIPT = new URL("../../scripts/check-node-version.mjs", import.meta.url);

// Node 22.15.0 introduced zlib zstd, the API undici 8 dereferences at load.
const ZSTD_API_FLOOR = [22, 15, 0];

function parse(parts) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(parts || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

const floorMatch = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(String(PKG?.engines?.node || "").trim());
const floor = floorMatch ? parse(floorMatch[0].slice(2)) : null;

function runCheck(version) {
  return spawnSync(process.execPath, [CHECK_SCRIPT.pathname, `--node-version=${version}`], {
    encoding: "utf8",
  });
}

describe("DF-9ROUTER-67 — Node floor declared, documented, and enforced", () => {
  it("package.json declares a single semver floor at or above the zstd API boundary", () => {
    expect(PKG.engines, "package.json has no engines.node — the runtime floor must live somewhere").toBeTruthy();
    expect(floor, `engines.node must be a ">=X.Y.Z" floor, got ${JSON.stringify(PKG?.engines?.node)}`).toBeTruthy();
    // Why 22.15 and not "22": undici 8 dereferences zlib zstd at module load.
    expect(cmp(floor, ZSTD_API_FLOOR)).toBeGreaterThanOrEqual(0);
    // undici itself declares >= 22.19.0; we must not claim support below it.
    expect(cmp(floor, [22, 19, 0])).toBeGreaterThanOrEqual(0);
  });

  it("every Node version the README tells the user to install satisfies that floor", () => {
    const documented = [...README.matchAll(/nodejs\.org\/dist\/v(\d+\.\d+\.\d+)\//g)].map((m) => m[1]);
    expect(documented.length, "README no longer documents a Node tarball recipe").toBeGreaterThan(0);
    for (const version of documented) {
      expect(
        cmp(parse(version), floor),
        `README pins Node v${version} but the app requires >= ${floor.join(".")} — the DF-9ROUTER-67 regression`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("README states the exact floor and the failure it prevents", () => {
    expect(README).toContain(floor.join("."));
    // The cryptic symptom must be documented next to the prerequisite so a user
    // who hits it on an older runtime can diagnose it without the source.
    expect(README).toMatch(/Cannot read properties of undefined \(reading 'bind'\)/);
  });

  it("`npm run build` is gated by the preflight script", () => {
    expect(PKG.scripts?.prebuild, "prebuild hook removed — npm run build would skip the check").toBe(
      "node scripts/check-node-version.mjs",
    );
    expect(fs.existsSync(CHECK_SCRIPT), "scripts/check-node-version.mjs is missing").toBe(true);
  });

  it("preflight FAILS on the Node the docs used to pin, naming the requirement", () => {
    const pre = runCheck("22.14.0"); // the dogfood box's runtime
    expect(pre.status).toBe(1);
    expect(pre.stderr).toContain(`Node >= ${floor.join(".")}`);
    expect(pre.stderr).toContain("detected : v22.14.0");
    // The diagnostic must explain the symptom the user would otherwise see.
    expect(pre.stderr).toContain("reading 'bind'");
    expect(pre.stderr).not.toMatch(/Failed to collect configuration/);
  });

  it("preflight PASSES on a supported runtime", () => {
    const ok = runCheck(floor.join("."));
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("ok — Node");
  });

  it("a bumped undici cannot silently raise the floor above the declared one", () => {
    let undiciPkgPath;
    try {
      undiciPkgPath = new URL("../../node_modules/undici/package.json", import.meta.url);
      fs.accessSync(undiciPkgPath);
    } catch {
      return; // deps not installed in this checkout — the floor assertions above still hold
    }
    const undici = JSON.parse(fs.readFileSync(undiciPkgPath, "utf8"));
    const undiciFloor = parse(/^>=\s*(\d+\.\d+\.\d+)/.exec(String(undici?.engines?.node || ""))?.[1]);
    if (!undiciFloor) return; // undici stopped declaring a floor; nothing to compare
    expect(
      cmp(floor, undiciFloor),
      `undici ${undici.version} requires Node >= ${undiciFloor.join(".")} but package.json declares ${floor.join(".")}`,
    ).toBeGreaterThanOrEqual(0);
  });
});
