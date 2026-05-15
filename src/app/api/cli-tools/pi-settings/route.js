"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const PROVIDER_ID = "9router";

const getPiDir = () => path.join(os.homedir(), ".pi", "agent");
const getPiModelsPath = () => path.join(getPiDir(), "models.json");

const checkPiInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where pi" : "which pi";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getPiModelsPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readModelsConfig = async () => {
  try {
    const content = await fs.readFile(getPiModelsPath(), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return { providers: {} };
    throw error;
  }
};

const has9RouterConfig = (config) => !!config?.providers?.[PROVIDER_ID];

export async function GET() {
  try {
    const installed = await checkPiInstalled();

    if (!installed) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Pi Agent is not installed",
      });
    }

    const config = await readModelsConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getPiModelsPath(),
    });
  } catch (error) {
    console.log("Error checking Pi settings:", error);
    return NextResponse.json({ error: "Failed to check Pi settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    if (/\/model-id$/.test(model)) {
      return NextResponse.json({ error: "Please select or enter a real model ID before applying" }, { status: 400 });
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    await fs.mkdir(getPiDir(), { recursive: true });

    const config = await readModelsConfig();
    if (!config.providers) config.providers = {};

    const existingModels = Array.isArray(config.providers[PROVIDER_ID]?.models)
      ? config.providers[PROVIDER_ID].models.filter((entry) => entry?.id && entry.id !== model)
      : [];

    config.providers[PROVIDER_ID] = {
      ...config.providers[PROVIDER_ID],
      baseUrl: normalizedBaseUrl,
      api: "openai-completions",
      apiKey,
      authHeader: true,
      models: [
        {
          id: model,
          name: `${model} via 9Router`,
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 200000,
          maxTokens: 32000,
        },
        ...existingModels,
      ],
    };

    await fs.writeFile(getPiModelsPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");

    return NextResponse.json({
      success: true,
      message: "Pi Agent settings applied successfully! Run pi and select the 9router model with /model.",
      configPath: getPiModelsPath(),
    });
  } catch (error) {
    console.log("Error updating Pi settings:", error);
    return NextResponse.json({ error: "Failed to update Pi settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const config = await readModelsConfig();

    if (config.providers) {
      delete config.providers[PROVIDER_ID];
      if (Object.keys(config.providers).length === 0) delete config.providers;
    }

    await fs.mkdir(getPiDir(), { recursive: true });
    await fs.writeFile(getPiModelsPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");

    return NextResponse.json({
      success: true,
      message: "9Router settings removed from Pi Agent",
    });
  } catch (error) {
    console.log("Error resetting Pi settings:", error);
    return NextResponse.json({ error: "Failed to reset Pi settings" }, { status: 500 });
  }
}
