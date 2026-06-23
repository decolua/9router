"use server";

import { NextRequest, NextResponse } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// OpenClaw 2026.5.x writes agents[].model as either a plain string
// (legacy) or as an object `{ primary, fallbacks }`. Normalize to the
// string id so downstream consumers can call `.startsWith()` safely.
const resolveAgentModel = (m: JsonValue) => {
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && !Array.isArray(m)) return String((m as Record<string, JsonValue>)["primary"] ?? "");
  return "";
};

const getOpenClawDir = () => path.join(os.homedir(), ".openclaw");
const getOpenClawSettingsPath = () => path.join(getOpenClawDir(), "openclaw.json");

// Check if openclaw CLI is installed (via which/where or config file exists)
const checkOpenClawInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where openclaw" : "which openclaw";
    // On Windows, inject %APPDATA%\npm into PATH so npm global packages are found
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getOpenClawSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current settings.json
const readSettings = async () => {
  try {
    const settingsPath = getOpenClawSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    // Tolerate JSONC (trailing commas) and treat unparseable files as "no config"
    // rather than throwing a 500 that the UI misreads as "tool not installed".
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as Record<string, JsonValue>;
  } catch {
    return null;
  }
};

// Check if settings has 9Router config
const has9RouterConfig = (settings: Record<string, JsonValue> | null) => {
  if (!settings || !settings["models"]) return false;
  const models = settings["models"] as Record<string, JsonValue>;
  return !!(models["providers"] && (models["providers"] as Record<string, JsonValue>)["9router"]);
};

// Read per-agent models.json and return current model id (without "9router/" prefix)
const readAgentModel = async (agentDir: string) => {
  try {
    const modelsPath = path.join(agentDir, "models.json");
    const content = await fs.readFile(modelsPath, "utf-8");
    const data = JSON.parse(content) as Record<string, JsonValue>;
    const providers = data?.["providers"] as Record<string, JsonValue> | undefined;
    const r9 = providers?.["9router"] as Record<string, JsonValue> | undefined;
    const models = r9?.["models"] as Array<Record<string, string>> | undefined;
    return models?.[0]?.["id"] ?? null;
  } catch {
    return null;
  }
};

// GET - Check openclaw CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenClawInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Open Claw CLI is not installed",
      });
    }

    const settings = await readSettings();

    // Enrich agents list with current per-agent model from models.json.
    const agentListRaw = settings?.["agents"];
    const agentList = (agentListRaw && typeof agentListRaw === "object" && !Array.isArray(agentListRaw))
      ? ((agentListRaw as Record<string, JsonValue>)["list"] as Array<Record<string, JsonValue>> ?? [])
      : [];
    const enrichedAgents = await Promise.all(
      agentList.map(async (agent) => {
        const agentDir = agent["agentDir"];
        const agentModel = typeof agentDir === "string" ? await readAgentModel(agentDir) : null;
        return { ...agent, model: resolveAgentModel(agent["model"] as JsonValue), currentModel: agentModel };
      })
    );

    return NextResponse.json({
      installed: true,
      settings,
      agents: enrichedAgents,
      has9Router: has9RouterConfig(settings),
      settingsPath: getOpenClawSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking openclaw settings:", error);
    return NextResponse.json({ error: "Failed to check openclaw settings" }, { status: 500 });
  }
}

// Write per-agent models.json
const writeAgentModels = async (agentDir: string, model: string, baseUrl: string, apiKey: string) => {
  await fs.mkdir(agentDir, { recursive: true });
  const modelsPath = path.join(agentDir, "models.json");
  let existing: Record<string, JsonValue> = {};
  try {
    const content = await fs.readFile(modelsPath, "utf-8");
    existing = JSON.parse(content) as Record<string, JsonValue>;
  } catch { /* No existing */ }

  if (!existing["providers"]) existing["providers"] = {};
  (existing["providers"] as Record<string, JsonValue>)["9router"] = {
    baseUrl,
    apiKey: apiKey || "your_api_key",
    api: "openai-completions",
    models: [{ id: model, name: model.split("/").pop() ?? model }],
  };
  await fs.writeFile(modelsPath, JSON.stringify(existing, null, 2));
};

// POST - Update 9Router settings (merge with existing settings)
export async function POST(request: NextRequest) {
  try {
    // agentModels: { [agentId]: modelId } for per-agent override
    const { baseUrl, apiKey, model, agentModels = {} } = await request.json() as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      agentModels?: Record<string, string>;
    };

    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const openclawDir = getOpenClawDir();
    const settingsPath = getOpenClawSettingsPath();

    await fs.mkdir(openclawDir, { recursive: true });

    let settings: Record<string, JsonValue> = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings) as Record<string, JsonValue>;
    } catch { /* No existing settings */ }

    if (!settings["agents"]) settings["agents"] = {};
    const agentsObj = settings["agents"] as Record<string, JsonValue>;
    if (!agentsObj["defaults"]) agentsObj["defaults"] = {};
    const defaults = agentsObj["defaults"] as Record<string, JsonValue>;
    if (!defaults["model"]) defaults["model"] = {};
    if (!defaults["models"]) defaults["models"] = {};
    if (!settings["models"]) settings["models"] = {};
    const modelsObj = settings["models"] as Record<string, JsonValue>;
    if (!modelsObj["providers"]) modelsObj["providers"] = {};

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const fullModelId = `9router/${model}`;

    // Remove all old 9router/* entries from agents.defaults.models
    const defaultModels = defaults["models"] as Record<string, JsonValue>;
    Object.keys(defaultModels)
      .filter((k) => k.startsWith("9router/"))
      .forEach((k) => { delete defaultModels[k]; });

    // Update default model
    (defaults["model"] as Record<string, JsonValue>)["primary"] = fullModelId;

    // Collect all unique models (default + per-agent)
    const allModelIds = new Set<string>([model]);
    Object.values(agentModels).forEach((m) => { if (m) allModelIds.add(m); });

    // Add fresh 9router models to allowlist
    allModelIds.forEach((m) => {
      defaultModels[`9router/${m}`] = {};
    });

    // Remove old 9router model from each agent in agents.list.
    const agentList = agentsObj["list"] as Array<Record<string, JsonValue>> | undefined;
    if (agentList) {
      agentsObj["list"] = agentList.map((agent) => {
        if (resolveAgentModel(agent["model"] as JsonValue).startsWith("9router/")) {
          const { model: _, ...rest } = agent;
          return rest;
        }
        return agent;
      });
    }

    // Update models.providers.9router with all models
    (modelsObj["providers"] as Record<string, JsonValue>)["9router"] = {
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || "your_api_key",
      api: "openai-completions",
      models: [...allModelIds].map((m) => ({ id: m, name: m.split("/").pop() ?? m })),
    };

    // Set per-agent model in agents.list and write models.json
    const updatedAgentList = agentsObj["list"] as Array<Record<string, JsonValue>> | undefined;
    if (updatedAgentList) {
      agentsObj["list"] = updatedAgentList.map((agent) => {
        const agentModel = agentModels[agent["id"] as string];
        if (agentModel) return { ...agent, model: `9router/${agentModel}` };
        return agent;
      });

      // Write per-agent models.json for agents with agentDir
      await Promise.all(
        (agentsObj["list"] as Array<Record<string, JsonValue>>).map(async (agent) => {
          const agentDir = agent["agentDir"];
          if (!agentDir || typeof agentDir !== "string") return;
          const agentModel = agentModels[agent["id"] as string];
          const modelToWrite = agentModel ?? model; // fallback to default
          await writeAgentModels(agentDir, modelToWrite, normalizedBaseUrl, apiKey ?? "");
        })
      );
    }

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Open Claw settings applied successfully!",
      settingsPath,
    });
  } catch (error) {
    console.log("Error updating openclaw settings:", error);
    return NextResponse.json({ error: "Failed to update openclaw settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router settings only (keep other settings)
export async function DELETE() {
  try {
    const settingsPath = getOpenClawSettingsPath();

    // Read existing settings
    let settings: Record<string, JsonValue> = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings) as Record<string, JsonValue>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    // Remove 9Router from models.providers
    const modelsObj = settings["models"] as Record<string, JsonValue> | undefined;
    if (modelsObj?.["providers"]) {
      delete (modelsObj["providers"] as Record<string, JsonValue>)["9router"];

      if (Object.keys(modelsObj["providers"] as Record<string, JsonValue>).length === 0) {
        delete modelsObj["providers"];
      }
    }

    // Remove 9router models from agents.defaults.models allowlist
    const agentsObj = settings["agents"] as Record<string, JsonValue> | undefined;
    const agentDefaults = agentsObj?.["defaults"] as Record<string, JsonValue> | undefined;
    const agentDefaultModels = agentDefaults?.["models"] as Record<string, JsonValue> | undefined;
    if (agentDefaultModels) {
      const keysToRemove = Object.keys(agentDefaultModels).filter((k) => k.startsWith("9router/"));
      for (const key of keysToRemove) {
        delete agentDefaultModels[key];
      }
      if (Object.keys(agentDefaultModels).length === 0) {
        delete agentDefaults!["models"];
      }
    }

    // Reset agents.defaults.model.primary if it uses 9router
    const agentDefaultModel = agentDefaults?.["model"] as Record<string, JsonValue> | undefined;
    if (typeof agentDefaultModel?.["primary"] === "string" && agentDefaultModel["primary"].startsWith("9router/")) {
      delete agentDefaultModel["primary"];
    }

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "9Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting openclaw settings:", error);
    return NextResponse.json({ error: "Failed to reset openclaw settings" }, { status: 500 });
  }
}
