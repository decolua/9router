"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { constants as fsc } from "fs";
import path from "path";
import os from "os";
import YAML from "yaml";
import { OMP_ROLE_IDS } from "../../../../shared/constants/ompRoles.js";
import { buildOmpModelEntry } from "../../../../shared/constants/ompModelSchema.js";


const execAsync = promisify(exec);

const PROVIDER_KEY = "9router";

// Oh My Pi (omp) splits its state across two files with *different* scopes:
//
//   ~/.omp/agent/models.yml   provider catalog — ALWAYS global, never scoped
//   ~/.omp/agent/config.yml   settings + modelRoles — the GLOBAL role layer
//   <project>/.omp/config.yml modelRoles — the PROJECT role layer
//
// Which role layer omp actually reads is decided by the `modelRoleStorage`
// setting in the global config ("global" | "project", default "global").
// Writing roles to the wrong layer is silent: omp keeps reading the other
// file and the assignment appears to do nothing.
//
// Official roles: default, smol, slow, vision, plan, designer, commit, tiny, task, advisor
// Docs: https://github.com/can1357/oh-my-pi/blob/main/docs/models.md

const ROLE_SCOPES = ["global", "project"];
const DEFAULT_ROLE_SCOPE = "global";

const getConfigDir = () => path.join(os.homedir(), ".omp", "agent");
const getModelsPath = () => path.join(getConfigDir(), "models.yml");
const getConfigPath = () => path.join(getConfigDir(), "config.yml");

// Project role storage is a filesystem write outside the app's own data dir,
// so it is DISABLED unless the operator explicitly opts in.
//
// There is no project registry in this app, and process.cwd() is the dashboard's
// own install root — not the user's project — so neither can be trusted as a
// project root. The only accepted source is OMP_PROJECT_ROOTS, an explicit
// operator-configured allowlist (os.delimiter-separated absolute paths).
// When unset, project scope is unavailable and the API says so; it never
// silently falls back to writing somewhere plausible.
//
// The client selects a root by *index*. No path crosses the wire as an
// instruction — paths are returned for display only.
const getProjectRootCandidates = () => {
  const raw = process.env.OMP_PROJECT_ROOTS || "";
  const seen = new Set();
  const out = [];
  for (const entry of raw.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) continue;
    const abs = path.resolve(trimmed);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
};

const projectScopeEnabled = () => getProjectRootCandidates().length > 0;

// Resolve `<root>/.omp` and prove it is a real directory contained by its root.
// Called once during resolution AND again immediately before every write, so a
// `.omp` that becomes a symlink in between cannot redirect the write (TOCTOU).
const assertContainedOmpDir = async (realRoot) => {
  const expected = path.join(realRoot, ".omp");
  let realDir;
  try {
    realDir = await fs.realpath(expected);
  } catch (error) {
    if (error?.code === "ENOENT") return { path: expected, existed: false };
    return { error: "Project .omp directory could not be resolved" };
  }
  // Strict equality against the realpath'd root: any symlink that points
  // elsewhere — inside or outside the root — is refused.
  if (realDir !== expected) {
    return { error: "Project .omp directory is a link; refusing to write through it" };
  }
  return { path: realDir, existed: true };
};

// Create <root>/.omp up front so later writes target a directory this code
// made inside an already-validated root, rather than one that appeared later.
const ensureProjectOmpDir = async (realRoot) => {
  const pre = await assertContainedOmpDir(realRoot);
  if (pre.error) return pre;
  if (!pre.existed) {
    await fs.mkdir(pre.path, { recursive: true });
  }
  // Re-assert after creation: mkdir on a pre-existing symlink is a no-op.
  return assertContainedOmpDir(realRoot);
};

const resolveProjectTarget = async (projectIndex) => {
  const roots = getProjectRootCandidates();
  if (roots.length === 0) {
    return {
      error:
        "Project role storage is not enabled on this server. Set OMP_PROJECT_ROOTS to the absolute project path(s) allowed to receive omp role writes.",
    };
  }
  const idx = Number.isInteger(projectIndex) ? projectIndex : 0;
  if (idx < 0 || idx >= roots.length) {
    return { error: `projectIndex must be between 0 and ${roots.length - 1}` };
  }

  let realRoot;
  try {
    const stat = await fs.stat(roots[idx]);
    if (!stat.isDirectory()) return { error: "Project root is not a directory" };
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT") {
      return { error: "Project root does not exist on this machine", code };
    }
    return {
      error: `Project root is unreadable (${code || "unknown"}): ${roots[idx]}`,
      code: code || "unknown",
    };
  }
  try {
    realRoot = await fs.realpath(roots[idx]);
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT") {
      return { error: "Project root does not exist on this machine", code };
    }
    return {
      error: `Project root is unreadable (${code || "unknown"}): ${roots[idx]}`,
      code: code || "unknown",
    };
  }

  const dir = path.join(realRoot, ".omp");
  const configPath = path.join(dir, "config.yml");

  if (path.resolve(configPath) === path.resolve(getConfigPath())) {
    return { error: "Project config resolves to the global agent config; use scope \"global\"", code: "EGLOBALALIAS" };
  }

  return { scope: "project", path: configPath, dir, root: realRoot };
};

// Resolve which config.yml a role read/write should target.
const resolveRoleTarget = async ({ scope, projectIndex }) => {
  const requested = scope || DEFAULT_ROLE_SCOPE;
  if (!ROLE_SCOPES.includes(requested)) {
    return { error: `scope must be one of: ${ROLE_SCOPES.join(", ")}` };
  }
  if (requested === "global") {
    return { scope: "global", path: getConfigPath(), dir: getConfigDir(), root: null };
  }
  return resolveProjectTarget(projectIndex);
};

// Re-validate immediately before writing a project config, then hand back a
// writer that performs the mutation itself.
//
// Scope of the guarantee, stated precisely: the directory is re-resolved and
// the target file is `lstat`-checked (rejecting symlinks and non-regular
// files) immediately before the write, and the write itself is an atomic
// same-directory `rename` over a freshly created temp file. That closes the
// symlinked-config redirect and makes readers see either the old or the new
// file, never a partial one. It does NOT make the sequence fully atomic
// against a concurrent attacker with write access to the project directory —
// POSIX offers no portable no-follow directory-relative replace from Node —
// so this narrows the window rather than eliminating it. Project scope is
// opt-in for exactly that reason.
const assertWritableConfigFile = async (configPath) => {
  try {
    const st = await fs.lstat(configPath);
    if (st.isSymbolicLink()) {
      return { error: "Project config.yml is a symlink; refusing to write through it" };
    }
    if (!st.isFile()) {
      return { error: "Project config.yml exists but is not a regular file" };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { error: "Project config.yml could not be inspected" };
    }
    // Absent is fine — it is created by the atomic rename below.
  }
  return { path: configPath };
};

// Atomic same-directory replace: write a temp file beside the target, then
// rename over it. `wx` fails if the temp name already exists, so a planted
// symlink at that name cannot be followed.
const writeConfigAtomic = async (configPath, contents) => {
  const dir = path.dirname(configPath);
  const tmp = path.join(dir, `.config.yml.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await fs.open(tmp, "wx", 0o600);
    await handle.writeFile(contents, "utf-8");
    await handle.close();
    handle = null;
    await fs.rename(tmp, configPath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
};

const prepareRoleWrite = async (target) => {
  if (target.scope === "global") {
    await fs.mkdir(getConfigDir(), { recursive: true });
    return { path: target.path, write: (c) => writeConfigAtomic(target.path, c) };
  }
  const dir = await ensureProjectOmpDir(target.root);
  if (dir.error) return dir;
  const configPath = path.join(dir.path, "config.yml");
  const checked = await assertWritableConfigFile(configPath);
  if (checked.error) return checked;
  return { path: configPath, write: (c) => writeConfigAtomic(configPath, c) };
};

// omp reads `modelRoleStorage` from the global config only. Absent = "global".
const readRoleStorageMode = (settingsDoc) => {
  const raw = settingsDoc?.getIn?.(["modelRoleStorage"]);
  const value = typeof raw === "string" ? raw : null;
  return ROLE_SCOPES.includes(value) ? value : DEFAULT_ROLE_SCOPE;
};

// Check if the omp CLI is installed (via which/where or config file exists)
const checkOmpInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where omp" : "which omp";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getModelsPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read a YAML file as a mutable document so comments and unrelated providers
// survive the round-trip. Unlike the JSON/JSONC CLI routes, omp configs are
// hand-edited YAML — silently reformatting them would be destructive.
//
// Returns { doc, missing, corrupt, unsafe }:
//   missing → file does not exist yet (safe to create)
//   corrupt → file exists but does not parse (fail closed, never overwrite)
//   unsafe  → not a regular file (symlink, fifo, device). Refuse both ways:
//             reading through a symlink leaks arbitrary file contents into the
//             API response, and writing through one redirects the write.
// --- safe file primitives -------------------------------------------------
//
// Every read of an omp config goes through openRegularForRead(). Opening with
// O_NOFOLLOW makes the kernel refuse a symlink at the final path component, so
// there is no lstat/read window in which the file can be swapped. The handle is
// then stat'd to reject fifos/devices, and all bytes are read from that same
// handle — the data provably comes from the object that was validated.
//
// Returns { handle } | { missing: true } | { unsafe: true }.
const openRegularForRead = async (filePath) => {
  const flags = typeof fsc.O_NOFOLLOW === "number"
    ? fsc.O_RDONLY | fsc.O_NOFOLLOW
    : fsc.O_RDONLY;
  let handle;
  try {
    handle = await fs.open(filePath, flags);
    const st = await handle.stat();
    if (!st.isFile()) {
      await handle.close().catch(() => {});
      return { unsafe: true };
    }
    return { handle };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    // ELOOP: O_NOFOLLOW refused a symlink. EMLINK: some BSDs use this instead.
    if (error?.code === "ELOOP" || error?.code === "EMLINK") return { unsafe: true };
    if (error?.code === "ENOENT") return { missing: true };
    throw error;
  }
};

const readRegularFile = async (filePath) => {
  const opened = await openRegularForRead(filePath);
  if (opened.missing || opened.unsafe) return opened;
  try {
    return { content: await opened.handle.readFile("utf-8") };
  } finally {
    await opened.handle.close().catch(() => {});
  }
};

// `content` is the exact bytes read from disk. Rollback must restore those,
// never String(doc) — YAML reserialization can normalize quoting, indentation
// and comment placement, so "restoring" via the document would silently
// rewrite a user's hand-edited file.
const readYamlDoc = async (filePath) => {
  const read = await readRegularFile(filePath);
  if (read.unsafe) return { doc: null, missing: false, corrupt: false, unsafe: true, content: null };
  if (read.missing) return { doc: new YAML.Document({}), missing: true, corrupt: false, unsafe: false, content: null };
  const content = read.content;
  try {
    const doc = YAML.parseDocument(content);
    // A YAML file that parses into errors is corrupt — refuse to touch it.
    if (doc.errors?.length > 0) return { doc: null, missing: false, corrupt: true, unsafe: false, content };
    // Empty file parses to null contents; treat as a fresh document.
    if (doc.contents === null) return { doc: new YAML.Document({}), missing: false, corrupt: false, unsafe: false, content };
    return { doc, missing: false, corrupt: false, unsafe: false, content };
  } catch {
    return { doc: null, missing: false, corrupt: true, unsafe: false, content };
  }
};
// Resolve the actual models file: models.yml (canonical), models.yaml (alt),
// then legacy models.json leftover. Absence is not corruption. Legacy json is
// re-hydrated into a mutable YAML document so the merge logic stays uniform.
const resolveModelsFile = async () => {
  const candidates = [
    path.join(getConfigDir(), "models.yml"),
    path.join(getConfigDir(), "models.yaml"),
    path.join(getConfigDir(), "models.json"),
  ];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return { path: candidate, isLegacyJson: candidate.endsWith(".json"), exists: true }; }
    catch { /* try next */ }
  }
  return { path: candidates[0], isLegacyJson: false, exists: false };
};

const readModelsDoc = async () => {
  const resolved = await resolveModelsFile();
  if (resolved.isLegacyJson && resolved.exists) {
    const read = await readRegularFile(resolved.path);
    if (read.unsafe) {
      return { doc: null, missing: false, corrupt: false, unsafe: true, path: resolved.path };
    }
    if (read.missing) {
      return { doc: new YAML.Document({}), missing: true, corrupt: false, unsafe: false, path: resolved.path };
    }
    try {
      const raw = JSON.parse(read.content);
      // Read-only: backup is the writer's responsibility, after validation.
      const canonical = path.join(getConfigDir(), "models.yml");
      return {
        doc: YAML.parseDocument(JSON.stringify(raw)),
        missing: false,
        corrupt: false,
        unsafe: false,
        path: canonical,
        sourcePath: resolved.path,
      };
    } catch {
      return { doc: null, missing: false, corrupt: true, unsafe: false, path: resolved.path };
    }
  }
  const result = await readYamlDoc(resolved.path);
  return { ...result, path: resolved.path };
};

// Back up before rewriting so a bad merge is always recoverable. omp itself
// uses the same `.bak.<timestamp>` convention for its own config rewrites.
//
// The source is opened through openRegularForRead() (O_NOFOLLOW + stat), and
// the destination is created with "wx" so an existing name — including a
// planted symlink — cannot be written through. Path-based copyFile would
// follow links on both ends.
const backupFile = async (filePath) => {
  const opened = await openRegularForRead(filePath);
  // Nothing to back up on first write; refuse to back up a non-regular file.
  if (opened.missing || opened.unsafe) return;

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
  const dest = `${filePath}.bak.${stamp}`;
  let out;
  try {
    const content = await opened.handle.readFile("utf-8");
    out = await fs.open(dest, "wx", 0o600);
    await out.writeFile(content, "utf-8");
  } catch (error) {
    // A backup name collision within the same second is not fatal.
    if (error?.code !== "EEXIST") throw error;
  } finally {
    if (out) await out.close().catch(() => {});
    await opened.handle.close().catch(() => {});
  }
};

const getProviderNode = (doc) => doc?.getIn(["providers", PROVIDER_KEY]);

const has9RouterConfig = (doc) => !!getProviderNode(doc);

// Map a 9Router /v1/models capability payload onto the omp model schema.
// Capability values are copied verbatim from the gateway — never invented.
// Callers pass capabilities through from GET /v1/models when available.
// The mapping itself lives in shared/constants/ompModelSchema.js so the
// dashboard and this route cannot drift apart.
const buildModelEntry = (modelId, capabilities) => buildOmpModelEntry(modelId, capabilities);

const nineRouterModelId = (value) => {
  if (typeof value !== "string" || !value.startsWith(`${PROVIDER_KEY}/`)) return null;
  return value.slice(PROVIDER_KEY.length + 1);
};

// A role id is writable if it is a built-in, or already exists in the target
// config (a custom role the user created in omp). Inventing brand-new custom
// roles from the dashboard is refused — omp owns that vocabulary — but an
// existing one must remain assignable, otherwise the UI can read a role it
// cannot then change.
const ROLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Keys that must never reach an object index, even though they match the
// pattern above and can appear in a parsed YAML map.
const FORBIDDEN_ROLE_IDS = new Set(["__proto__", "constructor", "prototype"]);

const isSafeRoleId = (role) =>
  typeof role === "string" && ROLE_ID_PATTERN.test(role) && !FORBIDDEN_ROLE_IDS.has(role);

// Read every 9Router-backed role, including custom ones. omp's own
// getKnownRoleIds() treats the built-ins as a floor, not a ceiling: any key
// under modelRoles is a usable role, so reporting only the ten would hide
// assignments the user can see in omp.

const readNineRouterRoles = (settingsDoc) => {
  const roles = Object.create(null);
  if (!settingsDoc) return { ...roles };
  const present = settingsDoc.getIn(["modelRoles"])?.toJSON?.() || {};
  const ids = new Set([...OMP_ROLE_IDS, ...Object.keys(present)]);
  for (const role of ids) {
    if (!isSafeRoleId(role)) continue;
    const modelId = nineRouterModelId(settingsDoc.getIn(["modelRoles", role]));
    if (modelId) roles[role] = modelId;
  }
  return { ...roles };
};

// Every role id present in a config, regardless of which provider backs it.
// `readNineRouterRoles` deliberately reports only 9Router-backed assignments
// (those are the ones this UI can set), but the picker still has to *show* a
// custom role like `reviewer: local/whatever` — otherwise it is invisible and
// unassignable from the dashboard.
const readAvailableRoleIds = (settingsDoc) => {
  const present = settingsDoc?.getIn?.(["modelRoles"])?.toJSON?.() || {};
  const ids = new Set(OMP_ROLE_IDS);
  for (const key of Object.keys(present)) {
    if (isSafeRoleId(key)) ids.add(key);
  }
  return Array.from(ids);
};

const applyNineRouterRoles = ({ settingsDoc, roles, knownIds }) => {
  const next = roles && typeof roles === "object" && !Array.isArray(roles) ? roles : {};
  const existing = settingsDoc.getIn(["modelRoles"])?.toJSON?.() || {};
  const writable = new Set([...OMP_ROLE_IDS, ...Object.keys(existing)]);

  const unknown = Object.keys(next).filter((role) => !writable.has(role));
  if (unknown.length) {
    return {
      error: `Unknown OMP role(s): ${unknown.join(", ")}. Built-in roles are ${OMP_ROLE_IDS.join(", ")}; custom roles must already exist in the target config.`,
    };
  }

  for (const role of Object.keys(next)) {
    if (!ROLE_ID_PATTERN.test(role)) {
      return { error: `Invalid role id: ${role}` };
    }
    const requested = next[role];
    const current = settingsDoc.getIn(["modelRoles", role]);
    if (requested === "" || requested == null) {
      if (nineRouterModelId(current)) settingsDoc.deleteIn(["modelRoles", role]);
      continue;
    }
    if (typeof requested !== "string") {
      return { error: `modelRoles.${role} must be a 9Router model id or empty` };
    }
    if (!knownIds.has(requested)) {
      return { error: `modelRoles.${role} must be one of the selected 9Router models` };
    }
    settingsDoc.setIn(["modelRoles", role], `${PROVIDER_KEY}/${requested}`);
  }
  return { error: null };
};


// GET - Check omp CLI and read current settings.
// `?projectIndex=N` selects which project layer to report as effective. Without
// it, both layers are returned but no project is guessed as active — picking
// "the first available" would silently attribute the wrong project's roles.
export async function GET(request) {
  try {
    const isInstalled = await checkOmpInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Oh My Pi (omp) CLI is not installed",
      });
    }

    const { doc, corrupt, unsafe: modelsUnsafe, path: modelsPath } = await readModelsDoc();

    if (modelsUnsafe) {
      return NextResponse.json({
        installed: true,
        config: null,
        has9Router: false,
        corrupt: true,
        modelsPath: (await resolveModelsFile()).path,
        configPath: getConfigPath(),
        message: "models file is not a regular file (symlink or special file) — refusing to read it",
      });
    }

    if (corrupt) {
      return NextResponse.json({
        installed: true,
        config: null,
        has9Router: false,
        corrupt: true,
        modelsPath: (await resolveModelsFile()).path,
        configPath: getConfigPath(),
        message: "models.yml exists but could not be parsed — fix or remove it before applying",
      });
    }

    const provider = getProviderNode(doc)?.toJSON?.() || null;
    const models = Array.isArray(provider?.models)
      ? provider.models.map((m) => m?.id).filter(Boolean)
      : [];

    // Report BOTH role layers plus which one omp actually reads, so the UI can
    // show the effective assignment instead of guessing.
    const {
      doc: globalSettings,
      corrupt: globalCorrupt,
      unsafe: globalUnsafe,
    } = await readYamlDoc(getConfigPath());
    const globalReadable = !globalCorrupt && !globalUnsafe;
    const globalRoles = globalReadable ? readNineRouterRoles(globalSettings) : {};
    const storageMode = globalReadable ? readRoleStorageMode(globalSettings) : DEFAULT_ROLE_SCOPE;

    const projectRoots = getProjectRootCandidates();
    const projects = [];
    for (let i = 0; i < projectRoots.length; i++) {
      const target = await resolveProjectTarget(i);
      if (target.error) {
        projects.push({ index: i, path: projectRoots[i], available: false, reason: target.error });
        continue;
      }
      const { doc: projDoc, corrupt: projCorrupt, unsafe: projUnsafe } = await readYamlDoc(target.path);
      const readable = !projCorrupt && !projUnsafe;
      projects.push({
        index: i,
        path: target.root,
        configPath: target.path,
        available: true,
        corrupt: !!projCorrupt,
        unsafe: !!projUnsafe,
        roles: readable ? readNineRouterRoles(projDoc) : {},
        availableRoles: readable ? readAvailableRoleIds(projDoc) : OMP_ROLE_IDS,
      });
    }

    // Only an explicitly requested project can be treated as effective.
    // `request` may be absent (direct GET() calls in tests) and its url may be
    // relative, so parsing is defensive on both counts.
    let rawIndex = null;
    try {
      const url = new URL(request?.url ?? "", "http://localhost");
      rawIndex = url.searchParams.get("projectIndex");
    } catch {
      rawIndex = null;
    }

    let selectedIndex = null;
    if (rawIndex !== null) {
      // Strict: "1x", "", " 1" and negatives are input errors, not index 1.
      if (!/^\d+$/.test(rawIndex)) {
        return NextResponse.json({ error: "projectIndex must be a non-negative integer" }, { status: 400 });
      }
      selectedIndex = Number.parseInt(rawIndex, 10);
      if (selectedIndex >= projects.length) {
        return NextResponse.json(
          { error: `projectIndex must be between 0 and ${Math.max(projects.length - 1, 0)}` },
          { status: 400 }
        );
      }
    }

    const selectedProject =
      selectedIndex === null
        ? null
        : projects.find((p) => p.index === selectedIndex && p.available && !p.corrupt && !p.unsafe) || null;

    // When omp reads project roles but no project was selected, there is no
    // honest answer — report no roles rather than attributing global ones.
    const scopeUnresolved = storageMode === "project" && !selectedProject;
    const usingProjectRoles = storageMode === "project" && !!selectedProject;
    const effectiveRoles = scopeUnresolved ? {} : (usingProjectRoles ? selectedProject.roles : globalRoles);

    return NextResponse.json({
      installed: true,
      config: doc?.toJSON?.() || null,
      has9Router: has9RouterConfig(doc),
      modelsPath,
      configPath: getConfigPath(),
      omp: {
        models,
        roles: effectiveRoles,
        activeModel: effectiveRoles.default || null,
        baseURL: provider?.baseUrl || null,
        roleScope: {
          storageMode,
          projectScopeEnabled: projectScopeEnabled(),
          // null when storage is "project" but no project was selected: the
          // caller must choose one before the effective roles are meaningful.
          effectiveScope: usingProjectRoles ? "project" : (storageMode === "project" ? null : "global"),
          selectedProjectIndex: selectedProject ? selectedProject.index : null,
          global: {
            configPath: getConfigPath(),
            roles: globalRoles,
            availableRoles: globalReadable ? readAvailableRoleIds(globalSettings) : OMP_ROLE_IDS,
            unsafe: !!globalUnsafe,
          },
          projects,
        },
      },
    });
  } catch (error) {
    console.log("Error checking omp settings:", error);
    return NextResponse.json({ error: "Failed to check omp settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as an openai-completions provider in ~/.omp/agent/models.yml
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, roles, capabilities } = await request.json();

    // Accept either `model` (string, legacy) or `models` (array of strings)
    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    await fs.mkdir(getConfigDir(), { recursive: true });

    // Catalog-only: models.yml is always global, so this handler reads and
    // writes exactly one file. Role writes live in PATCH, where a scope is
    // supplied explicitly.
    let modelsDocInfo;
    try {
      modelsDocInfo = await readModelsDoc();
    } catch (error) {
      return NextResponse.json({ error: "Failed to read models file: " + (error.message || "unknown") }, { status: 500 });
    }
    // Catalog-only. Roles are scoped and belong to PATCH — writing them here
    // would force a scope decision onto a request that has none, and would
    // couple the always-global catalog to a possibly-project role layer.
    if (roles !== undefined || activeModel !== undefined) {
      return NextResponse.json(
        {
          error:
            "Role assignments are no longer accepted by POST. Apply the catalog first, then PATCH roles with an explicit { scope, projectIndex }.",
        },
        { status: 400 }
      );
    }

    const modelsCorrupt = modelsDocInfo.corrupt;
    const modelsMissing = modelsDocInfo.missing;
    const doc = modelsDocInfo.doc;
    const modelsPath = modelsDocInfo.path;

    if (modelsDocInfo.unsafe) {
      return NextResponse.json(
        { error: "~/.omp/agent/models file is not a regular file (symlink or special file). Refusing to read or write through it." },
        { status: 400 }
      );
    }
    if (modelsCorrupt) {
      return NextResponse.json(
        { error: "~/.omp/agent/models file could not be parsed. Fix or remove it before applying, so existing providers are not lost." },
        { status: 409 }
      );
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";

    // Preserve any existing 9router provider entry and its models
    const existing = getProviderNode(doc)?.toJSON?.() || {};
    const existingModels = Array.isArray(existing.models) ? existing.models : [];
    const byId = new Map(existingModels.filter((m) => m?.id).map((m) => [m.id, m]));

    for (const id of modelsArray) {
      if (!id || typeof id !== "string") continue;
      const prev = byId.get(id) || {};
      const next = buildModelEntry(id, capabilities?.[id]);
      byId.set(id, { ...prev, ...next, name: prev.name || next.name });
    }
    const provider = {
      ...existing,
      baseUrl: normalizedBaseUrl,
      api: "openai-completions",
      apiKey: keyToUse,
      authHeader: true,
      discovery: { type: "openai-models-list" },
      models: Array.from(byId.values()),
    };

    const backupTarget = modelsDocInfo.sourcePath || (modelsMissing ? null : modelsPath);
    if (backupTarget) await backupFile(backupTarget);
    doc.setIn(["providers", PROVIDER_KEY], doc.createNode(provider));
    await writeConfigAtomic(modelsPath, String(doc));

    return NextResponse.json({
      success: true,
      message: "Oh My Pi model catalog updated",
      modelsPath,
    });
  } catch (error) {
    console.log("Error applying omp settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update role assignments without rewriting the provider catalog.
// Roles are scoped: { scope: "global" | "project", projectIndex } selects the
// layer. The provider catalog is never touched here.
export async function PATCH(request) {
  try {
    const { clearActiveModel, roles, scope, projectIndex } = await request.json();

    const target = await resolveRoleTarget({ scope, projectIndex });
    if (target.error) return NextResponse.json({ error: target.error }, { status: 400 });
    const configPath = target.path;

    const requestedRoles = (roles && typeof roles === "object" && !Array.isArray(roles)) ? { ...roles } : {};
    if (clearActiveModel === true && requestedRoles.default === undefined) requestedRoles.default = "";
    if (Object.keys(requestedRoles).length === 0) {
      return NextResponse.json({ success: true, message: "Settings updated", scope: target.scope, configPath });
    }

    const { doc, missing, corrupt, unsafe } = await readYamlDoc(configPath);
    if (unsafe) {
      return NextResponse.json({ error: `${configPath} is not a regular file` }, { status: 400 });
    }
    if (corrupt) {
      return NextResponse.json({ error: `${configPath} could not be parsed` }, { status: 409 });
    }
    if (missing && Object.values(requestedRoles).every((value) => !value)) {
      return NextResponse.json({ success: true, message: "No config file found", scope: target.scope, configPath });
    }

    // Role targets are validated against the GLOBAL catalog — models.yml is
    // never scoped, so a project role still has to name a real 9Router model.
    const modelsDocInfo = await readModelsDoc();
    const provider = !modelsDocInfo.corrupt && modelsDocInfo.doc
      ? getProviderNode(modelsDocInfo.doc)?.toJSON?.()
      : null;
    const knownIds = new Set(
      (Array.isArray(provider?.models) ? provider.models : []).map((m) => m?.id).filter(Boolean)
    );

    const applied = applyNineRouterRoles({ settingsDoc: doc, roles: requestedRoles, knownIds });
    if (applied.error) return NextResponse.json({ error: applied.error }, { status: 400 });

    // Re-validate the destination immediately before mutating it.
    const writer = await prepareRoleWrite(target);
    if (writer.error) return NextResponse.json({ error: writer.error }, { status: 400 });

    if (!missing) await backupFile(writer.path);
    await writer.write(String(doc));
    return NextResponse.json({
      success: true,
      message: "Settings updated",
      scope: target.scope,
      configPath: writer.path,
    });
  } catch (error) {
    console.log("Error patching omp settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove the 9Router provider, or a single model from it
export async function DELETE(request) {
  try {
    const url = new URL(request?.url ?? "", "http://localhost");
    const modelToRemove = url.searchParams.get("model");

    const modelsDocInfo = await readModelsDoc();
    if (modelsDocInfo.unsafe) {
      return NextResponse.json(
        { error: "~/.omp/agent/models file is not a regular file (symlink or special file)" },
        { status: 400 }
      );
    }
    if (modelsDocInfo.corrupt) {
      return NextResponse.json({ error: "~/.omp/agent/models file could not be parsed" }, { status: 409 });
    }
    if (modelsDocInfo.missing) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    // Removing a model from the (global) catalog invalidates any role pointing
    // at it in EVERY scope — cleaning only the active layer would leave the
    // other referencing a model that no longer exists.
    //
    // PREFLIGHT: read and validate every role layer before touching anything.
    // Any corrupt/unsafe layer aborts the whole operation with no writes.
    const roleTargets = [{ scope: "global", path: getConfigPath(), root: null }];
    const projectRoots = getProjectRootCandidates();
    for (let i = 0; i < projectRoots.length; i++) {
      const target = await resolveProjectTarget(i);
      // This layer IS the global layer, already in roleTargets — skipping it
      // loses nothing. Every other failure must abort: a configured root we
      // cannot read keeps a role pointing at the model we are about to delete.
      if (target.code === "EGLOBALALIAS") continue;
      if (target.error) {
        return NextResponse.json(
          { error: `${projectRoots[i]} could not be resolved (${target.error}). Fix it before reset; nothing was modified.` },
          { status: 409 }
        );
      }
      roleTargets.push(target);
    }

    const layers = [];
    for (const target of roleTargets) {
      const info = await readYamlDoc(target.path);
      if (info.unsafe) {
        return NextResponse.json(
          { error: `${target.path} is not a regular file. Fix it before reset; nothing was modified.` },
          { status: 400 }
        );
      }
      if (info.corrupt) {
        return NextResponse.json(
          { error: `${target.path} could not be parsed. Fix or remove it before reset; nothing was modified.` },
          { status: 409 }
        );
      }
      layers.push({ target, info });
    }

    const doc = modelsDocInfo.doc;
    const modelsPath = modelsDocInfo.path;
    const provider = getProviderNode(doc)?.toJSON?.();
    if (!provider) return NextResponse.json({ success: true, message: "No 9Router provider configured" });

    let remainingIds = [];
    if (modelToRemove) {
      const kept = (Array.isArray(provider.models) ? provider.models : []).filter((m) => m?.id !== modelToRemove);
      remainingIds = kept.map((m) => m.id);
    }

    // Stage every role edit in memory, and resolve each write target, before
    // committing anything. Only roles pointing at the removed model(s) are
    // touched — unrelated role values are never deleted.
    const pending = [];
    for (const { target, info } of layers) {
      if (info.missing) continue;
      const settingsDoc = info.doc;
      // Exact bytes from disk — the rollback source. String(doc) would
      // reserialize and could normalize a hand-edited file.
      const original = info.content;
      let changed = false;
      // Iterate the roles actually present in the file, not just the ten
      // built-ins: omp supports custom roles (getKnownRoleIds), and a custom
      // role pointing at a deleted model would otherwise dangle.
      const roleMap = settingsDoc.getIn(["modelRoles"])?.toJSON?.() || {};
      for (const role of Object.keys(roleMap)) {
        const modelId = nineRouterModelId(settingsDoc.getIn(["modelRoles", role]));
        if (!modelId) continue;
        if (!modelToRemove || (modelId === modelToRemove && !remainingIds.includes(modelId))) {
          settingsDoc.deleteIn(["modelRoles", role]);
          changed = true;
        }
      }
      if (!changed) continue;

      const writer = await prepareRoleWrite(target);
      if (writer.error) {
        return NextResponse.json(
          { error: `${writer.error} — nothing was modified.` },
          { status: 409 }
        );
      }
      pending.push({ target, writer, contents: String(settingsDoc), original });
    }

    // Stage the catalog edit in memory too, so the commit phase is pure I/O.
    if (modelToRemove) {
      const kept = (Array.isArray(provider.models) ? provider.models : []).filter((m) => m?.id !== modelToRemove);
      if (kept.length === 0) doc.deleteIn(["providers", PROVIDER_KEY]);
      else doc.setIn(["providers", PROVIDER_KEY], doc.createNode({ ...provider, models: kept }));
    } else {
      doc.deleteIn(["providers", PROVIDER_KEY]);
    }
    const providers = doc.getIn(["providers"])?.toJSON?.();
    if (providers && Object.keys(providers).length === 0) doc.deleteIn(["providers"]);

    // COMMIT: roles first, catalog last. Each entry is recorded only AFTER its
    // write succeeds, and carries an `undo` that restores that exact file.
    const written = [];
    const cleanedScopes = [];

    try {
      for (const { target, writer, contents, original } of pending) {
        await backupFile(writer.path);
        await writer.write(contents);
        written.push({ path: writer.path, undo: () => writer.write(original) });
        cleanedScopes.push(target.scope === "global" ? "global" : writer.path);
      }

      // The catalog's rollback source is the WRITE TARGET's own prior bytes —
      // never modelsDocInfo.content, which for a legacy models.json is JSON
      // read from a different file. If the target does not exist yet (legacy
      // migration creating models.yml), undo removes what we created rather
      // than fabricating a file.
      const targetBefore = await readRegularFile(modelsPath);
      if (targetBefore.unsafe) {
        throw new Error(`${modelsPath} is not a regular file`);
      }
      const targetExisted = !targetBefore.missing;
      const targetOriginal = targetExisted ? targetBefore.content : null;

      await backupFile(modelsDocInfo.sourcePath || modelsPath);
      await writeConfigAtomic(modelsPath, String(doc));
      written.push({
        path: modelsPath,
        undo: targetExisted
          ? () => writeConfigAtomic(modelsPath, targetOriginal)
          : () => fs.rm(modelsPath, { force: true }),
      });
    } catch (error) {
      // Restore newest-first so each file returns to its pre-commit state.
      const restoreFailures = [];
      for (const entry of [...written].reverse()) {
        try {
          await entry.undo();
        } catch (restoreError) {
          restoreFailures.push(`${entry.path} (${restoreError?.message || "unknown"})`);
        }
      }
      const detail = error?.message || "unknown error";
      if (restoreFailures.length) {
        // Never report this as a clean failure — the tree is inconsistent.
        return NextResponse.json(
          {
            error: `Removal failed: ${detail}. ROLLBACK ALSO FAILED for: ${restoreFailures.join("; ")}. These files may be inconsistent — timestamped .bak copies sit alongside each one.`,
            rollback: "failed",
            unrestored: restoreFailures,
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: `Removal failed: ${detail}. All files were rolled back to their previous contents.`, rollback: "ok" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from Oh My Pi",
      cleanedScopes,
    });
  } catch (error) {
    console.log("Error resetting omp settings:", error);
    return NextResponse.json({ error: "Failed to reset omp settings" }, { status: 500 });
  }
}
