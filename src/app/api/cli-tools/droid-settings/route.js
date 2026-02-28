"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getDroidDir = () => path.join(os.homedir(), ".factory");
const getDroidSettingsPath = () => path.join(getDroidDir(), "settings.json");

// Check if droid CLI is installed
const checkDroidInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where droid" : "command -v droid";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

// Read current settings.json
const readSettings = async () => {
  try {
    const settingsPath = getDroidSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if settings has 9Router customModels
const has9RouterConfig = (settings) => {
  if (!settings || !settings.customModels) return false;
  return settings.customModels.some(m => m.id === "custom:9Router-0");
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
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    
    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const droidDir = getDroidDir();
    const settingsPath = getDroidSettingsPath();

    // Ensure directory exists
    await fs.mkdir(droidDir, { recursive: true });

    // Read existing settings or create new
    let settings = {};
    try {
      const existingSettings = await fs.readFile(settingsPath, "utf-8");
      settings = JSON.parse(existingSettings);
    } catch { /* No existing settings */ }

    // Ensure customModels array exists
    if (!settings.customModels) {
      settings.customModels = [];
    }

    // Remove existing 9Router config if any
    settings.customModels = settings.customModels.filter(m => m.id !== "custom:9Router-0");

    // Normalize baseUrl to ensure /v1 suffix
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    // Add new 9Router config
    const customModel = {
      model: model,
      id: "custom:9Router-0",
      index: 0,
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || "your_api_key",
      displayName: model,
      maxOutputTokens: 131072,
      noImageSupport: false,
      provider: "openai",
    };

    settings.customModels.unshift(customModel);

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

    // Remove 9Router customModels
    if (settings.customModels) {
      settings.customModels = settings.customModels.filter(m => m.id !== "custom:9Router-0");
      
      // Remove customModels array if empty
      if (settings.customModels.length === 0) {
        delete settings.customModels;
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
