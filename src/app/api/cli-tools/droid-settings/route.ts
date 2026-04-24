import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getDroidDir = () => path.join(os.homedir(), ".droid");
const getDroidConfigPath = () => path.join(getDroidDir(), "config.json");

// Check if droid CLI is installed (via which/where or config file exists)
const checkDroidInstalled = async (): Promise<boolean> => {
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
      await fs.access(getDroidConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.json
const readConfig = async (): Promise<any> => {
  try {
    const configPath = getDroidConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const has8RouterConfig = (config: any): boolean => {
  if (!config) return false;
  return config.openai_base_url && (config.openai_base_url.includes("localhost") || config.openai_base_url.includes("127.0.0.1"));
};

// GET - Check droid CLI and read current settings
export async function GET(): Promise<NextResponse> {
  try {
    const isInstalled = await checkDroidInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Droid CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has8Router: has8RouterConfig(config),
      configPath: getDroidConfigPath(),
    });
  } catch (error) {
    console.log("Error checking droid settings:", error);
    return NextResponse.json({ error: "Failed to check droid settings" }, { status: 500 });
  }
}

// POST - Update 8Router settings (merge with existing config)
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const droidDir = getDroidDir();
    const configPath = getDroidConfigPath();

    // Ensure directory exists
    await fs.mkdir(droidDir, { recursive: true });

    // Read and parse existing config
    let config: any = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existingConfig);
    } catch { /* No existing config */ }

    // Update settings
    // Droid uses openai_base_url and openai_api_key for its openai provider
    // and openai_model_id for the model
    config.openai_base_url = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    config.openai_api_key = apiKey;
    config.openai_model_id = model;

    // Write merged config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Droid settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error updating droid settings:", error);
    return NextResponse.json({ error: "Failed to update droid settings" }, { status: 500 });
  }
}

// DELETE - Remove 8Router settings only (keep other settings)
export async function DELETE(): Promise<NextResponse> {
  try {
    const configPath = getDroidConfigPath();

    // Read and parse existing config
    let config: any = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existingConfig);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove 8Router related fields
    delete config.openai_base_url;
    delete config.openai_api_key;
    delete config.openai_model_id;

    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "8Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting droid settings:", error);
    return NextResponse.json({ error: "Failed to reset droid settings" }, { status: 500 });
  }
}
