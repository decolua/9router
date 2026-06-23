"use server";

import { NextRequest, NextResponse } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getConfigDir = () => path.join(os.homedir(), ".config", "opencode");
const getConfigPath = () => path.join(getConfigDir(), "opencode.json");

// Check if opencode CLI is installed (via which/where or config file exists)
const checkOpenCodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where opencode" : "which opencode";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfig = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    // opencode config files may use JSONC format (trailing commas, comments).
    // Strip trailing commas before parsing to avoid SyntaxError on valid JSONC.
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as Record<string, JsonValue>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // If the config file exists but is unparseable (corrupted, exotic JSONC),
    // treat it as "no config" rather than throwing a 500 that the UI
    // misinterprets as "opencode not installed".
    return null;
  }
};

const has9RouterConfig = (config: Record<string, JsonValue> | null) => {
  if (!config?.["provider"]) return false;
  return !!(config["provider"] as Record<string, JsonValue>)["9router"];
};

// GET - Check opencode CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenCodeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "OpenCode CLI is not installed",
      });
    }

    const config = await readConfig();
    const providerConfig = config?.["provider"] ? (config["provider"] as Record<string, JsonValue>)["9router"] as Record<string, JsonValue> | undefined : undefined;
    const modelMap = (providerConfig?.["models"] as Record<string, JsonValue> | undefined) ?? {};

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getConfigPath(),
      opencode: {
        models: Object.keys(modelMap),
        activeModel: typeof config?.["model"] === "string" && config["model"].startsWith("9router/") ? (config["model"] as string).replace(/^9router\//, "") : null,
        baseURL: (providerConfig?.["options"] as Record<string, JsonValue> | undefined)?.["baseURL"] ?? null,
      },
    });
  } catch (error) {
    console.log("Error checking opencode settings:", error);
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as openai-compatible provider (multi-model support)
export async function POST(request: NextRequest) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel } = await request.json() as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      models?: string[];
      activeModel?: string;
      subagentModel?: string;
    };

    // Accept either `model` (string, legacy) or `models` (array of strings)
    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or start fresh
    let config: Record<string, JsonValue> = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing) as Record<string, JsonValue>;
    } catch { /* No existing config */ }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";
    const effectiveSubagentModel = subagentModel ?? modelsArray[0];

    // Ensure provider object
    if (!config["provider"]) config["provider"] = {};

    // Preserve any existing 9router provider entry and its models
    const existingProvider = (config["provider"] as Record<string, JsonValue>)["9router"] as Record<string, JsonValue> | undefined
      ?? { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };

    // Merge options (overwrite baseURL/apiKey)
    existingProvider["options"] = {
      ...((existingProvider["options"] as Record<string, JsonValue> | undefined) ?? {}),
      baseURL: normalizedBaseUrl,
      apiKey: keyToUse,
    };

    // Ensure models map exists
    if (!existingProvider["models"]) existingProvider["models"] = {};

    // Add or update entries for all requested models
    for (const m of modelsArray) {
      if (!m || typeof m !== "string") continue;
      (existingProvider["models"] as Record<string, JsonValue>)[m] = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
    }

    // Save merged provider back
    (config["provider"] as Record<string, JsonValue>)["9router"] = existingProvider;

    // Set the active model: prefer explicit activeModel, else first of modelsArray
    // If activeModel is explicitly empty string, clear the model
    if (activeModel === "") {
      config["model"] = "";
    } else {
      const finalActive = activeModel ?? modelsArray[0];
      if (finalActive) {
        config["model"] = `9router/${finalActive}`;
      }
    }

    // Add subagent configuration
    if (!config["agent"]) config["agent"] = {};
    (config["agent"] as Record<string, JsonValue>)["explorer"] = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `9router/${effectiveSubagentModel}`,
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying opencode settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update specific settings (e.g., clear active model)
export async function PATCH(request: NextRequest) {
  try {
    const { clearActiveModel } = await request.json() as { clearActiveModel?: boolean };
    const configPath = getConfigPath();

    let config: Record<string, JsonValue> = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing) as Record<string, JsonValue>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file found" });
      }
      throw error;
    }

    if (clearActiveModel === true) {
      // Clear active model but keep models in the list
      if (typeof config["model"] === "string" && config["model"].startsWith("9router/")) {
        config["model"] = "";
      }
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings updated",
    });
  } catch (error) {
    console.log("Error patching opencode settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider or specific models from config
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const configPath = getConfigPath();

    let config: Record<string, JsonValue> = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing) as Record<string, JsonValue>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    // If specific model provided, remove just that model
    const provider9router = config["provider"] ? (config["provider"] as Record<string, JsonValue>)["9router"] as Record<string, JsonValue> | undefined : undefined;
    if (modelToRemove && provider9router?.["models"]) {
      const modelMap = provider9router["models"] as Record<string, JsonValue>;
      delete modelMap[modelToRemove];

      // If no models left, remove the provider
      if (Object.keys(modelMap).length === 0) {
        delete (config["provider"] as Record<string, JsonValue>)["9router"];
        if (typeof config["model"] === "string" && config["model"].startsWith("9router/")) delete config["model"];
      } else if (config["model"] === `9router/${modelToRemove}`) {
        // If removed model was active, switch to first remaining model
        const remainingModels = Object.keys(modelMap);
        config["model"] = `9router/${remainingModels[0]}`;
      }
    } else {
      // No specific model - remove entire 9router provider
      if (config["provider"]) delete (config["provider"] as Record<string, JsonValue>)["9router"];
      if (typeof config["model"] === "string" && config["model"].startsWith("9router/")) delete config["model"];
    }

    // Remove subagent configuration
    const agentObj = config["agent"] as Record<string, JsonValue> | undefined;
    const explorerModel = (agentObj?.["explorer"] as Record<string, JsonValue> | undefined)?.["model"];
    if (typeof explorerModel === "string" && explorerModel.startsWith("9router/")) {
      delete agentObj!["explorer"];
      // Clean up empty agent object
      if (Object.keys(agentObj!).length === 0) delete config["agent"];
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from OpenCode",
    });
  } catch (error) {
    console.log("Error resetting opencode settings:", error);
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
