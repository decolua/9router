"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

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
    } catch {
      /* No existing config */
    }

    if (!existing.providers) existing.providers = {};

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    // Existing provider block (may have hand-tuned model metadata we must not erase).
    const existingProvider = existing.providers["9router"] || {};
    // Build a map of existing models keyed by id for O(1) merge.
    const existingModelsMap = {};
    for (const em of existingProvider.models || []) {
      if (em?.id) existingModelsMap[em.id] = em;
    }

    // Normalize an incoming model entry to a Pi model object.
    // Handles both plain strings and objects from GenericCliToolCard.
    // Also normalises snake_case keys (context_window, max_tokens) sent by
    // one frontend branch (GenericCliToolCard.js L291) to camelCase (#4268).
    const DEFAULT_CONTEXT = 128000;
    const DEFAULT_MAX_TOKENS = 16384;
    function normalizeModel(m) {
      if (typeof m === "string") {
        // Plain id string — check if we already have richer metadata saved.
        const existing = existingModelsMap[m];
        return {
          ...(existing || {}),
          id: m,
          name: (existing?.name) || m,
          contextWindow: existing?.contextWindow || DEFAULT_CONTEXT,
          maxTokens: existing?.maxTokens || DEFAULT_MAX_TOKENS,
        };
      }
      const id = m.id || "provider/model-id";
      const prev = existingModelsMap[id] || {};
      // Accept both camelCase and snake_case from the frontend (#4268).
      const contextWindow = m.contextWindow || m.context_window || prev.contextWindow || DEFAULT_CONTEXT;
      const maxTokens = m.maxTokens || m.max_tokens || prev.maxTokens || DEFAULT_MAX_TOKENS;
      return {
        ...prev,
        id,
        name: m.name || m.id || prev.name || id,
        contextWindow,
        maxTokens,
      };
    }

    let newModels = [];
    if (Array.isArray(rawBody.models) && rawBody.models.length > 0) {
      newModels = rawBody.models.map(normalizeModel);
    } else {
      const modelId = model || "provider/model-id";
      newModels = [normalizeModel(modelId)];
    }

    // Merge: keep existing models not in the new selection, then add/update
    // the ones the user just selected. This way hand-tuned metadata for
    // models not touched by this save is never erased (#4268).
    const newModelIds = new Set(newModels.map((m) => m.id));
    const keptModels = (existingProvider.models || []).filter(
      (m) => m?.id && !newModelIds.has(m.id)
    );
    const modelList = [...keptModels, ...newModels];

    // Merge into the existing provider block rather than replacing it wholesale.
    existing.providers["9router"] = {
      ...existingProvider,
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || existingProvider.apiKey || "sk_9router",
      api: existingProvider.api || "openai-completions",
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
