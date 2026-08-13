"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import YAML from "yaml";
import { OMP_ROLE_IDS } from "../../../../shared/constants/ompRoles.js";


const execAsync = promisify(exec);

const PROVIDER_KEY = "9router";

// Oh My Pi (omp) keeps its agent config under ~/.omp/agent:
//   models.yml  → provider catalog (custom OpenAI-compatible providers)
//   config.yml  → runtime settings, including modelRoles.<role>
// Official roles: default, smol, slow, vision, plan, designer, commit, tiny, task, advisor
// Docs: https://github.com/can1357/oh-my-pi/blob/main/docs/models.md

const getConfigDir = () => path.join(os.homedir(), ".omp", "agent");
const getModelsPath = () => path.join(getConfigDir(), "models.yml");
const getConfigPath = () => path.join(getConfigDir(), "config.yml");

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
// Returns { doc, missing, corrupt }:
//   missing → file does not exist yet (safe to create)
//   corrupt → file exists but does not parse (fail closed, never overwrite)
const readYamlDoc = async (filePath) => {
  let content;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return { doc: new YAML.Document({}), missing: true, corrupt: false };
    throw error;
  }

  try {
    const doc = YAML.parseDocument(content);
    // A YAML file that parses into errors is corrupt — refuse to touch it.
    if (doc.errors?.length > 0) return { doc: null, missing: false, corrupt: true };
    // Empty file parses to null contents; treat as a fresh document.
    if (doc.contents === null) return { doc: new YAML.Document({}), missing: false, corrupt: false };
    return { doc, missing: false, corrupt: false };
  } catch {
    return { doc: null, missing: false, corrupt: true };
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
    try {
      const raw = JSON.parse(await fs.readFile(resolved.path, "utf-8"));
      // Read-only: backup is the writer's responsibility, after validation.
      const canonical = path.join(getConfigDir(), "models.yml");
      return {
        doc: YAML.parseDocument(JSON.stringify(raw)),
        missing: false,
        corrupt: false,
        path: canonical,
        sourcePath: resolved.path,
      };
    } catch {
      return { doc: null, missing: false, corrupt: true, path: resolved.path };
    }
  }
  const result = await readYamlDoc(resolved.path);
  return { ...result, path: resolved.path };
};

// Back up before rewriting so a bad merge is always recoverable. omp itself
// uses the same `.bak.<timestamp>` convention for its own config rewrites.
const backupFile = async (filePath) => {
  try {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
    await fs.copyFile(filePath, `${filePath}.bak.${stamp}`);
  } catch (error) {
    // Nothing to back up on first write.
    if (error.code !== "ENOENT") throw error;
  }
};

const getProviderNode = (doc) => doc?.getIn(["providers", PROVIDER_KEY]);

const has9RouterConfig = (doc) => !!getProviderNode(doc);

// Map a 9Router /v1/models capability payload onto the omp model schema.
// Capability values are copied verbatim from the gateway — never invented.
// Callers pass capabilities through from GET /v1/models when available.
const buildModelEntry = (modelId, capabilities) => {
  const entry = { id: modelId, name: modelId };

  const input = ["text"];
  if (capabilities?.vision) input.push("image");
  entry.input = input;

  if (capabilities?.reasoning) entry.reasoning = true;
  if (Number.isFinite(capabilities?.contextWindow)) entry.contextWindow = capabilities.contextWindow;
  if (Number.isFinite(capabilities?.maxOutput)) entry.maxTokens = capabilities.maxOutput;

  return entry;
};

const nineRouterModelId = (value) => {
  if (typeof value !== "string" || !value.startsWith(`${PROVIDER_KEY}/`)) return null;
  return value.slice(PROVIDER_KEY.length + 1);
};

const readNineRouterRoles = (settingsDoc) => {
  const roles = {};
  if (!settingsDoc) return roles;
  for (const role of OMP_ROLE_IDS) {
    const modelId = nineRouterModelId(settingsDoc.getIn(["modelRoles", role]));
    if (modelId) roles[role] = modelId;
  }
  return roles;
};

const applyNineRouterRoles = ({ settingsDoc, roles, knownIds }) => {
  const next = roles && typeof roles === "object" && !Array.isArray(roles) ? roles : {};
  const unknown = Object.keys(next).filter((role) => !OMP_ROLE_IDS.includes(role));
  if (unknown.length) {
    return { error: `Unknown OMP role(s): ${unknown.join(", ")}` };
  }
  for (const role of OMP_ROLE_IDS) {
    if (!Object.prototype.hasOwnProperty.call(next, role)) continue;
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


// GET - Check omp CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOmpInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Oh My Pi (omp) CLI is not installed",
      });
    }

    const { doc, corrupt, path: modelsPath } = await readModelsDoc();

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

    let roles = {};
    const { doc: settingsDoc, corrupt: settingsCorrupt } = await readYamlDoc(getConfigPath());
    if (!settingsCorrupt) roles = readNineRouterRoles(settingsDoc);

    return NextResponse.json({
      installed: true,
      config: doc?.toJSON?.() || null,
      has9Router: has9RouterConfig(doc),
      modelsPath,
      configPath: getConfigPath(),
      omp: {
        models,
        roles,
        activeModel: roles.default || null,
        baseURL: provider?.baseUrl || null,
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

    // Pre-flight: read both files up front so we either apply cleanly or
    // refuse up front. Never leave models.yml written but config.yml
    // untouched because that half-state is the hardest to recover from.
    let modelsDocInfo;
    try {
      modelsDocInfo = await readModelsDoc();
    } catch (error) {
      return NextResponse.json({ error: "Failed to read models file: " + (error.message || "unknown") }, { status: 500 });
    }
    const requestedRoles = (roles && typeof roles === "object" && !Array.isArray(roles)) ? { ...roles } : {};
    if (activeModel !== undefined && requestedRoles.default === undefined) requestedRoles.default = activeModel;
    const wantsRoleWrite = Object.keys(requestedRoles).length > 0;
    let configDocInfo = { doc: null, missing: true, corrupt: false };
    if (wantsRoleWrite) {
      configDocInfo = await readYamlDoc(getConfigPath());
    }
    const modelsCorrupt = modelsDocInfo.corrupt;
    const modelsMissing = modelsDocInfo.missing;
    const doc = modelsDocInfo.doc;
    const modelsPath = modelsDocInfo.path;

    if (modelsCorrupt) {
      return NextResponse.json(
        { error: "~/.omp/agent/models file could not be parsed. Fix or remove it before applying, so existing providers are not lost." },
        { status: 409 }
      );
    }
    if (configDocInfo.corrupt) {
      return NextResponse.json(
        { error: "~/.omp/agent/config.yml could not be parsed. Fix or remove it before applying; models.yml was NOT modified." },
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
    const unknownRoles = Object.keys(requestedRoles).filter((role) => !OMP_ROLE_IDS.includes(role));
    if (unknownRoles.length) {
      return NextResponse.json({ error: `Unknown OMP role(s): ${unknownRoles.join(", ")}` }, { status: 400 });
    }
    for (const role of Object.keys(requestedRoles)) {
      const value = requestedRoles[role];
      if (value && !byId.has(value)) {
        return NextResponse.json({ error: `modelRoles.${role} must be one of the selected 9Router models` }, { status: 400 });
      }
    }

    if (wantsRoleWrite) {
      const applied = applyNineRouterRoles({ settingsDoc: configDocInfo.doc, roles: requestedRoles, knownIds: byId });
      if (applied.error) {
        return NextResponse.json({ error: applied.error }, { status: 400 });
      }
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
    await fs.writeFile(modelsPath, String(doc));

    const configPath = getConfigPath();
    if (wantsRoleWrite) {
      if (!configDocInfo.missing) await backupFile(configPath);
      await fs.writeFile(configPath, String(configDocInfo.doc));
    }

    return NextResponse.json({
      success: true,
      message: "Oh My Pi settings applied successfully!",
      modelsPath,
      configPath,
    });
  } catch (error) {
    console.log("Error applying omp settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update role assignments without rewriting the provider catalog
export async function PATCH(request) {
  try {
    const { clearActiveModel, roles } = await request.json();
    const configPath = getConfigPath();

    const requestedRoles = (roles && typeof roles === "object" && !Array.isArray(roles)) ? { ...roles } : {};
    if (clearActiveModel === true && requestedRoles.default === undefined) requestedRoles.default = "";
    if (Object.keys(requestedRoles).length === 0) {
      return NextResponse.json({ success: true, message: "Settings updated" });
    }

    const { doc, missing, corrupt } = await readYamlDoc(configPath);
    if (corrupt) {
      return NextResponse.json({ error: "~/.omp/agent/config.yml could not be parsed" }, { status: 409 });
    }
    if (missing && Object.values(requestedRoles).every((value) => !value)) {
      return NextResponse.json({ success: true, message: "No config file found" });
    }

    const modelsDocInfo = await readModelsDoc();
    const provider = !modelsDocInfo.corrupt && modelsDocInfo.doc
      ? getProviderNode(modelsDocInfo.doc)?.toJSON?.()
      : null;
    const knownIds = new Set(
      (Array.isArray(provider?.models) ? provider.models : []).map((m) => m?.id).filter(Boolean)
    );

    const applied = applyNineRouterRoles({ settingsDoc: doc, roles: requestedRoles, knownIds });
    if (applied.error) return NextResponse.json({ error: applied.error }, { status: 400 });

    if (!missing) await backupFile(configPath);
    await fs.writeFile(configPath, String(doc));
    return NextResponse.json({ success: true, message: "Settings updated" });
  } catch (error) {
    console.log("Error patching omp settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove the 9Router provider, or a single model from it
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");

    const modelsDocInfo = await readModelsDoc();
    if (modelsDocInfo.corrupt) {
      return NextResponse.json({ error: "~/.omp/agent/models file could not be parsed" }, { status: 409 });
    }
    if (modelsDocInfo.missing) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    const configPath = getConfigPath();
    const configDocInfo = await readYamlDoc(configPath);
    if (configDocInfo.corrupt) {
      return NextResponse.json(
        { error: "~/.omp/agent/config.yml could not be parsed. Fix or remove it before reset; models file was NOT modified." },
        { status: 409 }
      );
    }

    const doc = modelsDocInfo.doc;
    const modelsPath = modelsDocInfo.path;
    const provider = getProviderNode(doc)?.toJSON?.();
    if (!provider) return NextResponse.json({ success: true, message: "No 9Router provider configured" });

    await backupFile(modelsDocInfo.sourcePath || modelsPath);

    let remainingIds = [];
    if (modelToRemove) {
      const kept = (Array.isArray(provider.models) ? provider.models : []).filter((m) => m?.id !== modelToRemove);
      remainingIds = kept.map((m) => m.id);
      if (kept.length === 0) {
        doc.deleteIn(["providers", PROVIDER_KEY]);
      } else {
        doc.setIn(["providers", PROVIDER_KEY], doc.createNode({ ...provider, models: kept }));
      }
    } else {
      doc.deleteIn(["providers", PROVIDER_KEY]);
    }

    const providers = doc.getIn(["providers"])?.toJSON?.();
    if (providers && Object.keys(providers).length === 0) doc.deleteIn(["providers"]);

    await fs.writeFile(modelsPath, String(doc));

    if (!configDocInfo.missing) {
      const settingsDoc = configDocInfo.doc;
      let changed = false;
      for (const role of OMP_ROLE_IDS) {
        const modelId = nineRouterModelId(settingsDoc.getIn(["modelRoles", role]));
        if (!modelId) continue;
        if (!modelToRemove || (modelId === modelToRemove && !remainingIds.includes(modelId))) {
          settingsDoc.deleteIn(["modelRoles", role]);
          changed = true;
        }
      }
      if (changed) {
        await backupFile(configPath);
        await fs.writeFile(configPath, String(settingsDoc));
      }
    }

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from Oh My Pi",
    });
  } catch (error) {
    console.log("Error resetting omp settings:", error);
    return NextResponse.json({ error: "Failed to reset omp settings" }, { status: 500 });
  }
}
