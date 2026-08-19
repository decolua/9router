/**
 * Security + transaction tests for omp scoped role storage.
 *
 * Project scope writes OUTSIDE the app's own data dir, so the trust model is:
 *   - no path is ever accepted from the client (index selection only)
 *   - project scope is disabled unless the operator sets OMP_PROJECT_ROOTS
 *   - reads/writes use O_NOFOLLOW; symlinked configs are refused both ways
 *   - DELETE is transactional across every role layer plus the catalog
 *
 * A regression here is an arbitrary-write or data-loss bug.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import os from "os";
import { parse as parseYAML } from "yaml";

const tmpHome = mkdtempSync(join(tmpdir(), "omp-scope-home-"));
const tmpWork = mkdtempSync(join(tmpdir(), "omp-scope-work-"));
const projectRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const routePath = join(projectRoot, "src/app/api/cli-tools/omp-settings/route.js").replace(/\\/g, "/");

const allowedRoot = join(tmpWork, "allowed-project");
const outsideRoot = join(tmpWork, "outside");
const agentDir = () => join(tmpHome, ".omp", "agent");
const globalConfig = () => join(agentDir(), "config.yml");
const modelsFile = () => join(agentDir(), "models.yml");
const projectConfig = () => join(allowedRoot, ".omp", "config.yml");

let route;
const origRoots = process.env.OMP_PROJECT_ROOTS;

// Injectable failure seam. writeConfigAtomic() finishes with fs.rename(), so
// failing rename for one specific destination fails exactly that write and
// nothing else — letting the earlier role writes succeed and the catalog write
// throw mid-commit, which is otherwise unreachable from the filesystem.
let failRenameTo = null;

beforeAll(async () => {
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(payload, init) {
        const status = init?.status ?? 200;
        return { status, async json() { return payload; } };
      },
    },
  }));

  vi.doMock("fs/promises", async () => {
    const actual = await vi.importActual("fs/promises");
    return {
      ...actual,
      default: {
        ...actual.default,
        rename: async (from, to) => {
          if (failRenameTo && to === failRenameTo) {
            const err = new Error("injected rename failure");
            err.code = "EIO";
            throw err;
          }
          return actual.default.rename(from, to);
        },
      },
    };
  });

  route = await import(routePath);
});

afterAll(() => {
  if (origRoots === undefined) delete process.env.OMP_PROJECT_ROOTS;
  else process.env.OMP_PROJECT_ROOTS = origRoots;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpWork, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(tmpHome, ".omp"), { recursive: true, force: true });
  rmSync(allowedRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
  mkdirSync(agentDir(), { recursive: true });
  mkdirSync(allowedRoot, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  writeFileSync(
    modelsFile(),
    "providers:\n  9router:\n    baseUrl: http://x/v1\n    models:\n      - id: m1\n      - id: m2\n",
  );
  delete process.env.OMP_PROJECT_ROOTS;
});

const patch = (body) => route.PATCH({ json: async () => body });
const del = (qs = "") => route.DELETE({ url: `http://localhost/api/cli-tools/omp-settings${qs}` });
const get = (qs = "") => route.GET({ url: `http://localhost/api/cli-tools/omp-settings${qs}` });

describe("project scope is opt-in", () => {
  it("refuses project scope when OMP_PROJECT_ROOTS is unset", async () => {
    const res = await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not enabled|OMP_PROJECT_ROOTS/i);
  });

  it("does not fall back to a global write when project scope is unavailable", async () => {
    await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(existsSync(globalConfig())).toBe(false);
  });
});

describe("no client-supplied paths", () => {
  beforeEach(() => { process.env.OMP_PROJECT_ROOTS = allowedRoot; });

  it("ignores a projectPath in the body entirely", async () => {
    const res = await patch({
      scope: "project", projectIndex: 0, projectPath: outsideRoot, roles: { default: "m1" },
    });
    expect(res.status).toBe(200);
    expect(existsSync(projectConfig())).toBe(true);
    expect(existsSync(join(outsideRoot, ".omp", "config.yml"))).toBe(false);
  });

  it("rejects an out-of-range projectIndex", async () => {
    for (const idx of [1, 99, -1]) {
      const res = await patch({ scope: "project", projectIndex: idx, roles: { default: "m1" } });
      expect(res.status).toBe(400);
    }
  });

  it("ignores relative entries in the allowlist", async () => {
    process.env.OMP_PROJECT_ROOTS = "relative/path";
    const res = await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(res.status).toBe(400);
  });
});

describe("symlink refusal", () => {
  beforeEach(() => { process.env.OMP_PROJECT_ROOTS = allowedRoot; });

  it("refuses a symlinked .omp directory pointing outside the root", async () => {
    const escape = join(outsideRoot, "escape-omp");
    mkdirSync(escape, { recursive: true });
    symlinkSync(escape, join(allowedRoot, ".omp"), "dir");

    const res = await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(escape, "config.yml"))).toBe(false);
  });

  it("refuses a symlinked config.yml inside a legitimate .omp", async () => {
    const target = join(outsideRoot, "victim.yml");
    writeFileSync(target, "secret: value\n");
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    symlinkSync(target, projectConfig());

    const res = await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // The linked file must be neither rewritten nor disclosed.
    expect(readFileSync(target, "utf-8")).toBe("secret: value\n");
  });

  it("does not leak a symlinked config's contents through GET", async () => {
    const target = join(outsideRoot, "victim.yml");
    writeFileSync(target, "modelRoles:\n  default: 9router/leaked\n");
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    symlinkSync(target, projectConfig());

    const body = await (await get("?projectIndex=0")).json();
    const proj = body.omp?.roleScope?.projects?.[0];
    expect(proj?.unsafe).toBe(true);
    expect(JSON.stringify(proj?.roles || {})).not.toMatch(/leaked/);
  });
});

describe("scope isolation", () => {
  beforeEach(() => { process.env.OMP_PROJECT_ROOTS = allowedRoot; });

  it("writes project roles only to <root>/.omp/config.yml", async () => {
    const res = await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(res.status).toBe(200);
    expect(parseYAML(readFileSync(projectConfig(), "utf-8")).modelRoles.default).toBe("9router/m1");
    expect(existsSync(globalConfig())).toBe(false);
  });

  it("never writes the provider catalog into a project config", async () => {
    await patch({ scope: "project", projectIndex: 0, roles: { default: "m1" } });
    expect(parseYAML(readFileSync(projectConfig(), "utf-8")).providers).toBeUndefined();
  });

  it("keeps global and project layers independent", async () => {
    await patch({ scope: "global", roles: { default: "m1" } });
    await patch({ scope: "project", projectIndex: 0, roles: { default: "m2" } });
    expect(parseYAML(readFileSync(globalConfig(), "utf-8")).modelRoles.default).toBe("9router/m1");
    expect(parseYAML(readFileSync(projectConfig(), "utf-8")).modelRoles.default).toBe("9router/m2");
  });
});

describe("GET never guesses the active project", () => {
  beforeEach(() => { process.env.OMP_PROJECT_ROOTS = allowedRoot; });

  it("reports no roles when storage is project but none was selected", async () => {
    writeFileSync(globalConfig(), "modelRoleStorage: project\nmodelRoles:\n  default: 9router/m1\n");
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    writeFileSync(projectConfig(), "modelRoles:\n  default: 9router/m2\n");

    const body = await (await get()).json();
    expect(body.omp.roleScope.effectiveScope).toBeNull();
    expect(body.omp.roles).toEqual({});
    // Both layers are still reported for the UI to render.
    expect(body.omp.roleScope.global.roles.default).toBe("m1");
    expect(body.omp.roleScope.projects[0].roles.default).toBe("m2");
  });

  it("rejects a malformed projectIndex instead of coercing it", async () => {
    for (const q of ["?projectIndex=1x", "?projectIndex=", "?projectIndex=-1"]) {
      expect((await get(q)).status).toBe(400);
    }
  });
});

describe("POST is catalog-only", () => {
  it("refuses role assignments", async () => {
    const res = await route.POST({
      json: async () => ({ baseUrl: "http://x", models: ["m1"], roles: { default: "m1" } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PATCH/);
  });
});

describe("DELETE transaction", () => {
  beforeEach(() => {
    process.env.OMP_PROJECT_ROOTS = allowedRoot;
    writeFileSync(globalConfig(), "modelRoles:\n  default: 9router/m1\n  slow: 9router/m2\n");
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    writeFileSync(projectConfig(), "modelRoles:\n  default: 9router/m1\n  myCustomRole: 9router/m1\n");
  });

  it("cleans role references in BOTH scopes", async () => {
    const res = await del("?model=m1");
    expect(res.status).toBe(200);
    expect(parseYAML(readFileSync(globalConfig(), "utf-8")).modelRoles.default).toBeUndefined();
    expect(parseYAML(readFileSync(projectConfig(), "utf-8")).modelRoles.default).toBeUndefined();
  });

  it("cleans custom roles, not just the ten built-ins", async () => {
    await del("?model=m1");
    const doc = parseYAML(readFileSync(projectConfig(), "utf-8"));
    expect(doc.modelRoles?.myCustomRole).toBeUndefined();
  });

  it("leaves roles pointing at surviving models untouched", async () => {
    await del("?model=m1");
    expect(parseYAML(readFileSync(globalConfig(), "utf-8")).modelRoles.slow).toBe("9router/m2");
  });

  it("aborts with no writes when any layer is corrupt", async () => {
    writeFileSync(projectConfig(), "modelRoles:\n  default: [unclosed\n");
    const before = readFileSync(globalConfig(), "utf-8");
    const modelsBefore = readFileSync(modelsFile(), "utf-8");

    const res = await del("?model=m1");
    expect(res.status).toBe(409);
    expect(readFileSync(globalConfig(), "utf-8")).toBe(before);
    expect(readFileSync(modelsFile(), "utf-8")).toBe(modelsBefore);
  });

  it("migrates legacy JSON into models.yml and leaves the JSON untouched", async () => {
    rmSync(modelsFile(), { force: true });
    const legacy = join(agentDir(), "models.json");
    const legacyBytes = JSON.stringify(
      { providers: { "9router": { baseUrl: "http://x/v1", models: [{ id: "m1" }, { id: "m2" }] } } },
      null,
      2,
    );
    writeFileSync(legacy, legacyBytes);

    const res = await del("?model=m1");
    expect(res.status).toBe(200);

    // Canonical target created as YAML, never a byte-copy of the JSON source.
    expect(existsSync(modelsFile())).toBe(true);
    const migrated = parseYAML(readFileSync(modelsFile(), "utf-8"));
    expect(migrated.providers["9router"].models.map((m) => m.id)).toEqual(["m2"]);
    // Legacy source is read-only input; the writer must not touch it.
    expect(readFileSync(legacy, "utf-8")).toBe(legacyBytes);
  });

  it("aborts at preflight when the catalog path is not a regular file", async () => {
    const globalBefore = readFileSync(globalConfig(), "utf-8");
    const projectBefore = readFileSync(projectConfig(), "utf-8");

    rmSync(modelsFile(), { force: true });
    mkdirSync(modelsFile(), { recursive: true });

    const res = await del("?model=m1");
    expect(res.status).toBe(400);

    // Refusal happens before any write, so both role layers are byte-identical.
    expect(readFileSync(globalConfig(), "utf-8")).toBe(globalBefore);
    expect(readFileSync(projectConfig(), "utf-8")).toBe(projectBefore);
  });

  it("refuses when the canonical catalog target is a symlink", async () => {
    const victim = join(outsideRoot, "catalog-victim.yml");
    writeFileSync(victim, "untouched: true\n");
    rmSync(modelsFile(), { force: true });
    symlinkSync(victim, modelsFile());

    const res = await del("?model=m1");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(victim, "utf-8")).toBe("untouched: true\n");
  });

  it("rolls back role layers byte-exact when the catalog write fails mid-commit", async () => {
    const globalBefore = readFileSync(globalConfig(), "utf-8");
    const projectBefore = readFileSync(projectConfig(), "utf-8");
    const modelsBefore = readFileSync(modelsFile(), "utf-8");

    // Fail only the catalog's atomic rename. Role writes succeed first, so the
    // commit phase is genuinely entered and then aborted.
    failRenameTo = modelsFile();
    try {
      const res = await del("?model=m1");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.rollback).toBe("ok");
    } finally {
      failRenameTo = null;
    }

    // Byte-exact restoration, not a YAML reserialization.
    expect(readFileSync(globalConfig(), "utf-8")).toBe(globalBefore);
    expect(readFileSync(projectConfig(), "utf-8")).toBe(projectBefore);
    // Custom roles restored along with the built-ins.
    expect(parseYAML(readFileSync(projectConfig(), "utf-8")).modelRoles.myCustomRole).toBe("9router/m1");
    // The catalog never changed.
    expect(readFileSync(modelsFile(), "utf-8")).toBe(modelsBefore);
  });
});

describe("custom role discovery", () => {
  beforeEach(() => { process.env.OMP_PROJECT_ROOTS = allowedRoot; });

  it("reports a foreign-backed custom role as available without assigning it", async () => {
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    writeFileSync(projectConfig(), "modelRoles:\n  reviewer: local/x\n  default: 9router/m1\n");

    const body = await (await get("?projectIndex=0")).json();
    const proj = body.omp.roleScope.projects[0];

    // Visible in the picker...
    expect(proj.availableRoles).toContain("reviewer");
    // ...but not reported as a 9Router assignment, since another provider owns it.
    expect(proj.roles.reviewer).toBeUndefined();
    expect(proj.roles.default).toBe("m1");
  });

  it("still lists the ten built-ins when the config has no modelRoles", async () => {
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    writeFileSync(projectConfig(), "someOtherSetting: true\n");
    const body = await (await get("?projectIndex=0")).json();
    expect(body.omp.roleScope.projects[0].availableRoles).toEqual(
      expect.arrayContaining(["default", "smol", "slow", "vision", "plan", "designer", "commit", "tiny", "task", "advisor"]),
    );
  });

  it("can assign a 9Router model to a foreign-backed custom role", async () => {
    mkdirSync(join(allowedRoot, ".omp"), { recursive: true });
    writeFileSync(projectConfig(), "modelRoles:\n  reviewer: local/x\n");
    const res = await patch({ scope: "project", projectIndex: 0, roles: { reviewer: "m1" } });
    expect(res.status).toBe(200);
    expect(parseYAML(readFileSync(projectConfig(), "utf-8")).modelRoles.reviewer).toBe("9router/m1");
  });
});
