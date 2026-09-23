"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { getCombos } from "@/lib/localDb";
import { getModelInfo } from "@/sse/services/model";
import { getCapabilitiesForModel, aggregateComboCapabilities } from "open-sse/providers/capabilities.js";

const execAsync = promisify(exec);

const getPiModelsJsonPath = () => {
  const agentPath = path.join(os.homedir(), ".pi", "agent", "models.json");
  return agentPath;
};

const getPiDir = () => path.dirname(getPiModelsJsonPath());

const checkPiInstalled = async () => {
  const isWindows = os.platform() === "win32";
  try {
    const command = isWindows ? "where pi" : "which pi";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getPiModelsJsonPath());
      return true;
    } catch {
      try {
        await fs.access(path.join(os.homedir(), ".pi", "models.json"));
        return true;
      } catch {
        return false;
      }
    }
  }
};

const has9RouterConfig = (settings) => {
  if (!settings || !settings.providers) return false;
  const p = settings.providers["9router"];
  if (p && p.baseUrl) return true;
  for (const prov of Object.values(settings.providers)) {
    if (prov.baseUrl && prov.baseUrl.includes("20128")) return true;
  }
  return false;
};

const resolveModelsJsonPath = async () => {
  const agentPath = path.join(os.homedir(), ".pi", "agent", "models.json");
  const rootPath = path.join(os.homedir(), ".pi", "models.json");
  try {
    await fs.access(agentPath);
    return agentPath;
  } catch {
    try {
      await fs.access(rootPath);
      return rootPath;
    } catch {
      return agentPath;
    }
  }
};

const readConfig = async () => {
  try {
    const targetPath = await resolveModelsJsonPath();
    const content = await fs.readFile(targetPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export async function GET() {
  try {
    const installed = await checkPiInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Pi CLI is not installed",
      });
    }

    const config = await readConfig();
    const configPath = await resolveModelsJsonPath();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath,
    });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  try {
    const { baseUrl, apiKey, model } = rawBody || {};
    if (!baseUrl) {
      return NextResponse.json({ error: { message: "baseUrl is required" } }, { status: 400 });
    }

    const configPath = await resolveModelsJsonPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    let existing = {};
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      existing = JSON.parse(raw);
    } catch (error) {
      // A malformed or unreadable file is not an empty configuration.
      if (error.code !== "ENOENT") throw error;
    }

    if (!existing.providers) existing.providers = {};

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const previousProvider = existing.providers["9router"] || {};
    const previousModels = new Map((previousProvider.models || []).map(m => [m.id, m]));
    const selected = Array.isArray(rawBody.models) && rawBody.models.length > 0
      ? rawBody.models : [model || "provider/model-id"];
    const validLimit = value => Number.isFinite(value) && value > 0;
    let comboLookup;
    const modelList = [];
    for (const entry of selected) {
      const supplied = typeof entry === "string" ? { id: entry } : entry;
      const id = supplied.id || "provider/model-id";
      const merged = { ...previousModels.get(id), ...supplied, id };
      let caps;
      if (!validLimit(merged.contextWindow) || !validLimit(merged.maxTokens)) {
        // Reuse the same capability aggregation as /v1/models, including
        // nested combos. Existing per-model overrides take precedence.
        if (!id.includes("/")) {
          comboLookup ??= Object.fromEntries((await getCombos()).map(c => [c.name, c.models]));
          if (comboLookup[id]) caps = aggregateComboCapabilities(comboLookup[id], comboLookup);
        }
        if (!caps) {
          const resolved = await getModelInfo(id);
          caps = getCapabilitiesForModel(resolved.provider, resolved.model || id);
        }
      }
      modelList.push({
        ...merged,
        name: merged.name || id,
        contextWindow: validLimit(merged.contextWindow) ? merged.contextWindow : caps.contextWindow,
        maxTokens: validLimit(merged.maxTokens) ? merged.maxTokens : caps.maxOutput,
      });
    }

    existing.providers["9router"] = {
      ...previousProvider,
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || "sk_9router",
      api: "openai-completions",
      models: modelList,
    };

    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      message: "Pi settings applied! Use /model in Pi to select the 9Router model.",
      configPath,
    });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = await resolveModelsJsonPath();
    let existing = {};
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    if (existing.providers && existing.providers["9router"]) {
      delete existing.providers["9router"];
      if (Object.keys(existing.providers).length === 0) delete existing.providers;
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from Pi" });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
