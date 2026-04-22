"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getSafeExecCwd } from "../_lib/safeExec";

const execAsync = promisify(exec);
const SAFE_EXEC_CWD = getSafeExecCwd();

const getConfigDir = () => path.join(os.homedir(), ".pi", "agent");
const getConfigPath = () => path.join(getConfigDir(), "models.json");

// Check if pi CLI is installed
const checkPiInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where pi" : "which pi";
    await execAsync(command, { cwd: SAFE_EXEC_CWD, windowsHide: true });
    return true;
  } catch {
    // Also check if config file exists
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
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const has9RouterConfig = (config) => {
  if (!config?.providers) return false;
  return !!config.providers["9router"];
};

// GET - Check pi CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkPiInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Pi CLI is not installed",
      });
    }

    const config = await readConfig();
    const providerConfig = config?.providers?.["9router"];
    const models = providerConfig?.models || [];

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getConfigPath(),
      pi: {
        models: models.map(m => m.id),
        baseURL: providerConfig?.baseUrl || null,
        apiKey: providerConfig?.apiKey || null,
      },
    });
  } catch (error) {
    console.log("Error checking pi settings:", error);
    return NextResponse.json({ error: "Failed to check pi settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as custom provider in models.json
export async function POST(request) {
  try {
    const { baseUrl, apiKey, models } = await request.json();

    if (!baseUrl || !Array.isArray(models) || models.length === 0) {
      return NextResponse.json({ error: "baseUrl and models array are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or start fresh
    let config = { providers: {} };
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
      if (!config.providers) config.providers = {};
    } catch { /* No existing config */ }

    // Backup original if this is first time
    const backupPath = `${configPath}.backup`;
    try {
      await fs.access(backupPath);
    } catch {
      if (config.providers && Object.keys(config.providers).length > 0) {
        await fs.writeFile(backupPath, JSON.stringify(config, null, 2));
      }
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";

    // Create 9router provider config
    config.providers["9router"] = {
      baseUrl: normalizedBaseUrl,
      api: "openai-completions",
      apiKey: keyToUse,
      models: models.map(modelId => ({ id: modelId })),
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Pi configuration updated successfully",
      configPath,
    });
  } catch (error) {
    console.log("Error applying pi settings:", error);
    return NextResponse.json({ error: "Failed to apply pi settings" }, { status: 500 });
  }
}

// DELETE - Restore original config
export async function DELETE() {
  try {
    const configPath = getConfigPath();
    const backupPath = `${configPath}.backup`;

    try {
      await fs.access(backupPath);
      const backup = await fs.readFile(backupPath, "utf-8");
      await fs.writeFile(configPath, backup);
      await fs.unlink(backupPath);

      return NextResponse.json({
        success: true,
        message: "Original configuration restored",
      });
    } catch {
      return NextResponse.json({ error: "No backup found" }, { status: 404 });
    }
  } catch (error) {
    console.log("Error restoring pi settings:", error);
    return NextResponse.json({ error: "Failed to restore pi settings" }, { status: 500 });
  }
}
