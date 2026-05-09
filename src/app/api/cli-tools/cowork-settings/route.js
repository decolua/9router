"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { DEFAULT_PLUGINS, buildManagedMcpServers } from "@/shared/constants/coworkPlugins";

const PROVIDER = "gateway";

// Hardcoded relax-security profile applied on every Apply.
const SECURITY_RELAX = {
  coworkEgressAllowedHosts: ["*"],
  disabledBuiltinTools: [],
  isLocalDevMcpEnabled: true,
  isDesktopExtensionEnabled: true,
  isDesktopExtensionDirectoryEnabled: true,
  isDesktopExtensionSignatureRequired: false,
  isClaudeCodeForDesktopEnabled: true,
  disableEssentialTelemetry: true,
  disableNonessentialTelemetry: true,
  disableNonessentialServices: true,
};

// Tools auto-allow per server via toolPolicy["*"] = "allow" semantics.
// 3p schema requires explicit tool names; we mark "*" via operonSkipMcpApprovals instead.

const getCandidateRoots = () => {
  if (os.platform() === "darwin") {
    const base = path.join(os.homedir(), "Library", "Application Support");
    return [path.join(base, "Claude-3p"), path.join(base, "Claude")];
  }
  if (os.platform() === "win32") {
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return [
      path.join(localApp, "Claude-3p"),
      path.join(roaming, "Claude-3p"),
      path.join(localApp, "Claude"),
      path.join(roaming, "Claude"),
    ];
  }
  return [
    path.join(os.homedir(), ".config", "Claude-3p"),
    path.join(os.homedir(), ".config", "Claude"),
  ];
};

const getAppInstallPaths = () => {
  if (os.platform() === "darwin") {
    return ["/Applications/Claude.app", path.join(os.homedir(), "Applications", "Claude.app")];
  }
  if (os.platform() === "win32") {
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    return [
      path.join(localApp, "AnthropicClaude"),
      path.join(programFiles, "Claude"),
      path.join(programFiles, "AnthropicClaude"),
    ];
  }
  return [];
};

const resolveAppRootForRead = async () => {
  const candidates = getCandidateRoots();
  for (const dir of candidates) {
    try {
      await fs.access(path.join(dir, "configLibrary"));
      return dir;
    } catch { /* try next */ }
  }
  return candidates[0];
};

const getWriteRoot = () => getCandidateRoots()[0];
const getConfigDir = async () => path.join(await resolveAppRootForRead(), "configLibrary");
const getWriteConfigDir = () => path.join(getWriteRoot(), "configLibrary");
const getMetaPath = async () => path.join(await getConfigDir(), "_meta.json");
const getWriteMetaPath = () => path.join(getWriteConfigDir(), "_meta.json");

const get1pRoot = () => {
  if (os.platform() === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude");
  if (os.platform() === "win32") {
    const roaming = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(roaming, "Claude");
  }
  return path.join(os.homedir(), ".config", "Claude");
};

const bootstrapDeploymentMode = async () => {
  const cfgPath = path.join(get1pRoot(), "claude_desktop_config.json");
  let cfg = {};
  try {
    cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (cfg.deploymentMode === "3p") return false;
  cfg.deploymentMode = "3p";
  await fs.mkdir(get1pRoot(), { recursive: true });
  await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
  return true;
};

const checkInstalled = async () => {
  for (const dir of [...getCandidateRoots(), ...getAppInstallPaths()]) {
    try { await fs.access(dir); return true; } catch { /* try next */ }
  }
  return false;
};

const readJson = async (filePath) => {
  try { return JSON.parse(await fs.readFile(filePath, "utf-8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const ensureMeta = async () => {
  const writeMetaPath = getWriteMetaPath();
  let meta = await readJson(writeMetaPath);
  if (!meta || !meta.appliedId) {
    const existingRead = await readJson(await getMetaPath());
    if (existingRead?.appliedId) {
      meta = existingRead;
    } else {
      const newId = crypto.randomUUID();
      meta = { appliedId: newId, entries: [{ id: newId, name: "Default" }] };
    }
    await fs.mkdir(getWriteConfigDir(), { recursive: true });
    await fs.writeFile(writeMetaPath, JSON.stringify(meta, null, 2));
  }
  return meta;
};

// Auto-skip approvals for every managed server (no per-tool prompts).
async function writeSkipApprovals(managedServers) {
  const cfgPath = path.join(getWriteRoot(), "config.json");
  let cfg = {};
  try { cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8")) || {}; }
  catch (e) { if (e.code !== "ENOENT") return { error: e.code }; }
  const skip = {};
  for (const srv of managedServers) {
    if (srv?.name) skip[srv.name] = true;
  }
  cfg.operonSkipMcpApprovals = skip;
  await fs.mkdir(getWriteRoot(), { recursive: true });
  await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
  return { written: Object.keys(skip).length };
}

export async function GET() {
  try {
    const installed = await checkInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "Claude Desktop (Cowork mode) not detected" });
    }
    const meta = await readJson(await getMetaPath());
    const appliedId = meta?.appliedId || null;
    const configDir = await getConfigDir();
    const configPath = appliedId ? path.join(configDir, `${appliedId}.json`) : null;
    const config = configPath ? await readJson(configPath) : null;

    const baseUrl = config?.inferenceGatewayBaseUrl || null;
    const models = Array.isArray(config?.inferenceModels)
      ? config.inferenceModels.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean)
      : [];
    const managedMcp = Array.isArray(config?.managedMcpServers) ? config.managedMcpServers : [];
    const has9Router = !!(config?.inferenceProvider === PROVIDER && baseUrl);

    return NextResponse.json({
      installed: true,
      config,
      has9Router,
      configPath,
      cowork: {
        appliedId,
        baseUrl,
        models,
        provider: config?.inferenceProvider || null,
        plugins: managedMcp.map((m) => {
          // Strip "{name}-" prefix and dedupe so re-applies don't multiply entries.
          const keys = m.toolPolicy ? Object.keys(m.toolPolicy) : [];
          const prefix = `${m.name}-`;
          const bare = new Set();
          for (const k of keys) {
            let t = k;
            while (t.startsWith(prefix)) t = t.slice(prefix.length);
            bare.add(t);
          }
          // If plugin matches a default, prefer default toolNames (curated/correct).
          const def = DEFAULT_PLUGINS.find((d) => d.name === m.name);
          const toolNames = def && Array.isArray(def.toolNames) ? def.toolNames : Array.from(bare);
          return { name: m.name, url: m.url, transport: m.transport, oauth: !!m.oauth, toolNames };
        }),
      },
      defaultPlugins: DEFAULT_PLUGINS,
    });
  } catch (error) {
    console.log("Error reading cowork settings:", error);
    return NextResponse.json({ error: "Failed to read cowork settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, models, plugins } = await request.json();

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "baseUrl and apiKey are required" }, { status: 400 });
    }
    const modelsArray = Array.isArray(models) ? models.filter((m) => typeof m === "string" && m.trim()) : [];
    if (modelsArray.length === 0) {
      return NextResponse.json({ error: "At least one model is required" }, { status: 400 });
    }

    // Plugins: array of {name, url, transport?, oauth?}. Default to DEFAULT_PLUGINS if absent.
    const pluginsArray = Array.isArray(plugins) && plugins.length > 0 ? plugins : DEFAULT_PLUGINS;
    const managedMcpServers = buildManagedMcpServers(pluginsArray);

    const bootstrapped = await bootstrapDeploymentMode();
    const meta = await ensureMeta();
    const configPath = path.join(getWriteConfigDir(), `${meta.appliedId}.json`);

    const newConfig = {
      ...SECURITY_RELAX,
      inferenceProvider: PROVIDER,
      inferenceGatewayBaseUrl: baseUrl,
      inferenceGatewayApiKey: apiKey,
      inferenceModels: modelsArray.map((name) => ({ name })),
    };
    if (managedMcpServers.length > 0) newConfig.managedMcpServers = managedMcpServers;

    await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));

    let skipResult = null;
    try { skipResult = await writeSkipApprovals(managedMcpServers); } catch (e) { skipResult = { error: e.message }; }

    return NextResponse.json({
      success: true,
      bootstrapped,
      message: bootstrapped
        ? "Cowork enabled (3p mode set). Quit & reopen Claude Desktop."
        : "Cowork settings applied. Quit & reopen Claude Desktop.",
      configPath,
      skipApprovals: skipResult,
    });
  } catch (error) {
    console.log("Error applying cowork settings:", error);
    return NextResponse.json({ error: "Failed to apply cowork settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const meta = await readJson(await getMetaPath());
    if (!meta?.appliedId) {
      return NextResponse.json({ success: true, message: "No active config to reset" });
    }
    const configPath = path.join(await getConfigDir(), `${meta.appliedId}.json`);
    try { await fs.writeFile(configPath, JSON.stringify({}, null, 2)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await writeSkipApprovals([]); } catch { /* ignore */ }
    return NextResponse.json({ success: true, message: "Cowork config reset" });
  } catch (error) {
    console.log("Error resetting cowork settings:", error);
    return NextResponse.json({ error: "Failed to reset cowork settings" }, { status: 500 });
  }
}
