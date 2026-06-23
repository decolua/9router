"use server";

import { NextRequest, NextResponse } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getDroidDir = () => path.join(os.homedir(), ".factory");
const getDroidSettingsPath = () => path.join(getDroidDir(), "settings.json");

// Check if droid CLI is installed (via which/where or config file exists)
const checkDroidInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where droid" : "which droid";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getDroidSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current settings.json
const readSettings = async () => {
  try {
    const settingsPath = getDroidSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    // Tolerate JSONC (trailing commas) and treat unparseable files as "no config"
    // rather than throwing a 500 that the UI misreads as "tool not installed".
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as Record<string, JsonValue>;
  } catch {
    return null;
  }
};

type CustomModel = {
  model: string;
  id: string;
  index: number;
  baseUrl: string;
  apiKey: string;
  displayName: string;
  maxOutputTokens: number;
  noImageSupport: boolean;
  provider: string;
};

// Check if settings has 9Router customModels
const has9RouterConfig = (settings: Record<string, JsonValue> | null) => {
  if (!settings || !settings["customModels"]) return false;
  return (settings["customModels"] as CustomModel[]).some((m) => m.id?.startsWith("custom:9Router"));
};

// GET - Check droid CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkDroidInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Factory Droid CLI is not installed",
      });
    }

    const settings = await readSettings();

    return NextResponse.json({
      installed: true,
      settings,
      has9Router: has9RouterConfig(settings),
      settingsPath: getDroidSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking droid settings:", error);
    return NextResponse.json({ error: "Failed to check droid settings" }, { status: 500 });
  }
}

// POST - Update 9Router customModels (merge with existing settings)
// Accepts either `model` (string, legacy single-model) or `models` (array of strings, multi-model)
// Also accepts `activeModel` to set which model is active/primary
export async function POST(request: NextRequest) {
  try {
    const { baseUrl, apiKey, model, models, activeModel } = await request.json() as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      models?: string[];
      activeModel?: string;
    };

    // Accept either `models` (array) or `model` (string, legacy)
    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const droidDir = getDroidDir();
    const settingsPath = getDroidSettingsPath();

    // Ensure directory exists
    await fs.mkdir(droidDir, { recursive: true });

    // Read existing settings or create new
    let settings: Record<string, JsonValue> = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings) as Record<string, JsonValue>;
    } catch { /* No existing settings */ }

    // Ensure customModels array exists
    if (!settings["customModels"]) {
      settings["customModels"] = [];
    }

    // Remove all existing 9Router configs
    settings["customModels"] = (settings["customModels"] as CustomModel[]).filter((m) => !m.id?.startsWith("custom:9Router"));

    // Normalize baseUrl to ensure /v1 suffix
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "your_api_key";

    // Determine active model: prefer explicit activeModel, else first of modelsArray
    // If activeModel is explicitly empty string, no model will be set as default
    let defaultIndex = 0;
    if (typeof activeModel === "string") {
      if (activeModel === "") {
        defaultIndex = -1; // signal: don't set a default
      } else {
        const idx = modelsArray.indexOf(activeModel);
        defaultIndex = idx >= 0 ? idx : 0;
      }
    }

    // Add entries for all requested models
    for (let i = 0; i < modelsArray.length; i++) {
      const m = modelsArray[i];
      if (!m || typeof m !== "string") continue;
      (settings["customModels"] as CustomModel[]).push({
        model: m,
        id: `custom:9Router-${i}`,
        index: i,
        baseUrl: normalizedBaseUrl,
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      });
    }

    // Set default model if applicable
    const customModels = settings["customModels"] as CustomModel[];
    if (defaultIndex >= 0 && customModels[defaultIndex]) {
      const [defaultEntry] = customModels.splice(defaultIndex, 1);
      customModels.unshift({ ...defaultEntry!, index: 0 });
      // Re-index the rest
      customModels.forEach((m, i) => { m.index = i; });
    }

    // Write settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Factory Droid settings applied successfully!",
      settingsPath,
    });
  } catch (error) {
    console.log("Error updating droid settings:", error);
    return NextResponse.json({ error: "Failed to update droid settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router customModels only (keep other settings)
export async function DELETE() {
  try {
    const settingsPath = getDroidSettingsPath();

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

    // Remove 9Router customModels
    if (settings["customModels"]) {
      settings["customModels"] = (settings["customModels"] as CustomModel[]).filter((m) => !m.id?.startsWith("custom:9Router"));

      // Remove customModels array if empty
      if ((settings["customModels"] as CustomModel[]).length === 0) {
        delete settings["customModels"];
      }
    }

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    return NextResponse.json({
      success: true,
      message: "9Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting droid settings:", error);
    return NextResponse.json({ error: "Failed to reset droid settings" }, { status: 500 });
  }
}
