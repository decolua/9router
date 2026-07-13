"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);
const PROVIDER_NAME = "9router";

const getCrushConfigPath = () => {
  const platform = os.platform();
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "crush", "crush.json");
  }
  return path.join(os.homedir(), ".local", "share", "crush", "crush.json");
};

const checkInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where crush" : "which crush";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCrushConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readJson = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const has9RouterConfig = (config) => {
  const provider = config?.providers?.[PROVIDER_NAME];
  if (!provider) return false;
  if (provider.type !== "openai") return false;
  const baseUrl = provider.base_url || "";
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|9router/i.test(baseUrl);
};

const getProviderModels = (provider) => {
  if (!Array.isArray(provider?.models)) return [];
  return provider.models.map((m) => m?.id).filter(Boolean);
};

export async function GET() {
  try {
    const installed = await checkInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Crush is not installed" });
    }

    const configPath = getCrushConfigPath();
    const config = await readJson(configPath);
    const provider = config?.providers?.[PROVIDER_NAME] || null;

    return NextResponse.json({
      installed: true,
      has9Router: has9RouterConfig(config),
      configPath,
      settings: provider ? {
        type: provider.type,
        base_url: provider.base_url || "",
        model: getProviderModels(provider)[0] || "",
        models: getProviderModels(provider),
      } : null,
    });
  } catch (error) {
    console.log("Error checking crush settings:", error);
    return NextResponse.json({ error: "Failed to check crush settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models } = await request.json();
    const normalizedModels = Array.isArray(models)
      ? models.map((m) => String(m || "").trim()).filter(Boolean)
      : [String(model || "").trim()].filter(Boolean);

    if (!baseUrl || !apiKey || normalizedModels.length === 0) {
      return NextResponse.json({ error: "baseUrl, apiKey and at least one model are required" }, { status: 400 });
    }

    const configPath = getCrushConfigPath();
    const configDir = path.dirname(configPath);
    await fs.mkdir(configDir, { recursive: true });

    const existing = (await readJson(configPath)) || {};
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    const nextConfig = {
      ...existing,
      $schema: existing.$schema || "https://charm.land/crush.json",
      providers: {
        ...(existing.providers || {}),
        [PROVIDER_NAME]: {
          type: "openai",
          base_url: normalizedBaseUrl,
          api_key: apiKey,
          models: normalizedModels.map((modelId) => ({
            id: modelId,
            name: modelId,
            context_window: 128000,
            default_max_tokens: 4096,
          })),
        },
      },
    };

    await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2));

    return NextResponse.json({
      success: true,
      message: "Crush settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error updating crush settings:", error);
    return NextResponse.json({ error: "Failed to update crush settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getCrushConfigPath();
    const existing = await readJson(configPath);
    if (!existing) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    const providers = { ...(existing.providers || {}) };
    delete providers[PROVIDER_NAME];

    const nextConfig = { ...existing, providers };
    await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2));

    return NextResponse.json({ success: true, message: "9Router settings removed from Crush" });
  } catch (error) {
    console.log("Error resetting crush settings:", error);
    return NextResponse.json({ error: "Failed to reset crush settings" }, { status: 500 });
  }
}
