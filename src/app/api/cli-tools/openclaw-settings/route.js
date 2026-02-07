"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import {
  ensureCliConfigWriteAllowed,
  getCliPrimaryConfigPath,
  getCliRuntimeStatus,
} from "@/shared/services/cliRuntime";

const getOpenClawSettingsPath = () => getCliPrimaryConfigPath("openclaw");
const getOpenClawDir = () => path.dirname(getOpenClawSettingsPath());

// Read current settings.json
const readSettings = async () => {
  try {
    const settingsPath = getOpenClawSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if settings has 9Router config
const has9RouterConfig = (settings) => {
  if (!settings || !settings.models || !settings.models.providers) return false;
  return !!settings.models.providers["9router"];
};

// GET - Check openclaw CLI and read current settings
export async function GET() {
  try {
    const runtime = await getCliRuntimeStatus("openclaw");

    if (!runtime.installed || !runtime.runnable) {
      return NextResponse.json({
        installed: runtime.installed,
        runnable: runtime.runnable,
        command: runtime.command,
        commandPath: runtime.commandPath,
        runtimeMode: runtime.runtimeMode,
        reason: runtime.reason,
        settings: null,
        message:
          runtime.installed && !runtime.runnable
            ? "Open Claw CLI is installed but not runnable"
            : "Open Claw CLI is not installed",
      });
    }

    const settings = await readSettings();

    return NextResponse.json({
      installed: runtime.installed,
      runnable: runtime.runnable,
      command: runtime.command,
      commandPath: runtime.commandPath,
      runtimeMode: runtime.runtimeMode,
      reason: runtime.reason,
      settings,
      has9Router: has9RouterConfig(settings),
      settingsPath: getOpenClawSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking openclaw settings:", error);
    return NextResponse.json({ error: "Failed to check openclaw settings" }, { status: 500 });
  }
}

// POST - Update 9Router settings (merge with existing settings)
export async function POST(request) {
  try {
    const writeGuard = ensureCliConfigWriteAllowed();
    if (writeGuard) {
      return NextResponse.json({ error: writeGuard }, { status: 403 });
    }

    const { baseUrl, apiKey, model } = await request.json();
    
    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const openclawDir = getOpenClawDir();
    const settingsPath = getOpenClawSettingsPath();

    // Ensure directory exists
    await fs.mkdir(openclawDir, { recursive: true });

    // Read existing settings or create new
    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch { /* No existing settings */ }

    // Ensure structure exists
    if (!settings.agents) settings.agents = {};
    if (!settings.agents.defaults) settings.agents.defaults = {};
    if (!settings.agents.defaults.model) settings.agents.defaults.model = {};
    if (!settings.models) settings.models = {};
    if (!settings.models.providers) settings.models.providers = {};

    // Normalize baseUrl to ensure /v1 suffix
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    // Update agents.defaults.model.primary
    settings.agents.defaults.model.primary = `9router/${model}`;

    // Update models.providers.9router
    settings.models.providers["9router"] = {
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || "your_api_key",
      api: "openai-completions",
      models: [
        {
          id: model,
          name: model.split("/").pop() || model,
        },
      ],
    };

    // Write settings
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
    const writeGuard = ensureCliConfigWriteAllowed();
    if (writeGuard) {
      return NextResponse.json({ error: writeGuard }, { status: 403 });
    }

    const settingsPath = getOpenClawSettingsPath();

    // Read existing settings
    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    // Remove 9Router from models.providers
    if (settings.models && settings.models.providers) {
      delete settings.models.providers["9router"];
      
      // Remove providers object if empty
      if (Object.keys(settings.models.providers).length === 0) {
        delete settings.models.providers;
      }
    }

    // Reset agents.defaults.model.primary if it uses 9router
    if (settings.agents?.defaults?.model?.primary?.startsWith("9router/")) {
      delete settings.agents.defaults.model.primary;
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
