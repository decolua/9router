"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// Get amp settings paths based on OS
const getAmpSettingsPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, ".config", "amp", "settings.json");
};

const getAmpSecretsPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, ".local", "share", "amp", "secrets.json");
};

// Check if amp CLI is installed
const checkAmpInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where amp" : "command -v amp";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

// Read current settings
const readSettings = async () => {
  try {
    const settingsPath = getAmpSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

// Read current secrets
const readSecrets = async () => {
  try {
    const secretsPath = getAmpSecretsPath();
    const content = await fs.readFile(secretsPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

// GET - Check amp CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkAmpInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        secrets: null,
        message: "Amp CLI is not installed",
      });
    }

    const settings = await readSettings();
    const secrets = await readSecrets();
    const has9Router = !!(settings?.["amp.url"]);

    // Also load model mappings from 9router settings
    const { getSettings } = await import("@/lib/localDb");
    const routerSettings = await getSettings();

    return NextResponse.json({
      installed: true,
      settings: settings,
      secrets: secrets,
      has9Router: has9Router,
      settingsPath: getAmpSettingsPath(),
      secretsPath: getAmpSecretsPath(),
      modelMappings: routerSettings.ampModelMappings || {},
    });
  } catch (error) {
    console.log("Error checking amp settings:", error);
    return NextResponse.json(
      { error: "Failed to check amp settings" },
      { status: 500 }
    );
  }
}

// POST - Write new settings and secrets
export async function POST(request) {
  try {
    const { url, apiKey, modelMappings } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Invalid URL" },
        { status: 400 }
      );
    }

    const settingsPath = getAmpSettingsPath();
    const secretsPath = getAmpSecretsPath();
    const settingsDir = path.dirname(settingsPath);
    const secretsDir = path.dirname(secretsPath);

    // Ensure directories exist
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.mkdir(secretsDir, { recursive: true });

    // Read current settings
    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    // Update settings with new URL and API key
    const localApiKey = apiKey || "sk_9router";
    const newSettings = {
      ...currentSettings,
      "amp.url": url,
      "amp.apiKey": localApiKey,
    };

    // Write settings
    await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));

    // Always save model mappings to 9router settings (even if empty)
    const { updateSettings } = await import("@/lib/localDb");
    await updateSettings({
      ampModelMappings: modelMappings || {},
    });

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    console.log("Error updating amp settings:", error);
    return NextResponse.json(
      { error: "Failed to update amp settings" },
      { status: 500 }
    );
  }
}

// DELETE - Reset settings (remove amp.url and related secrets)
export async function DELETE() {
  try {
    const settingsPath = getAmpSettingsPath();
    const secretsPath = getAmpSecretsPath();

    // Read and update settings
    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    // Remove amp.url
    const oldUrl = currentSettings["amp.url"];
    delete currentSettings["amp.url"];

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(currentSettings, null, 2));

    // Remove related secrets
    if (oldUrl) {
      try {
        const content = await fs.readFile(secretsPath, "utf-8");
        const currentSecrets = JSON.parse(content);
        const secretKey = `apiKey@${oldUrl}`;
        delete currentSecrets[secretKey];
        await fs.writeFile(secretsPath, JSON.stringify(currentSecrets, null, 2));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Settings reset successfully",
    });
  } catch (error) {
    console.log("Error resetting amp settings:", error);
    return NextResponse.json(
      { error: "Failed to reset amp settings" },
      { status: 500 }
    );
  }
}
