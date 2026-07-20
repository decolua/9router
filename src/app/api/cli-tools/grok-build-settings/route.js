"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";
const MODEL_SLOT = "9router";
const BUILTIN_DEFAULT = "grok-build";

// [model.9router] ... until next [section] header or EOF
const MODEL_SECTION_RE = new RegExp(
  `^\\[model\\.${MODEL_SLOT}\\][ \\t]*\\r?\\n(?:(?!\\[)[^\\r\\n]*\\r?\\n?)*`,
  "m"
);

const MODELS_SECTION_RE = /^\[models\][ \t]*\r?\n((?:(?!\[)[^\r\n]*\r?\n?)*)/m;

// Marker written on Apply so Reset can restore the previous [models].default
const PREV_DEFAULT_RE = /^# 9router-prev-default = "([^"]*)"[ \t]*\r?\n?/m;

const getGrokDir = () => path.join(os.homedir(), ".grok");
const getGrokConfigPath = () => path.join(getGrokDir(), "config.toml");
const getGrokBinPath = () => path.join(getGrokDir(), "bin", "grok");

const checkGrokInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where grok" : "which grok";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getGrokBinPath());
      return true;
    } catch {
      try {
        await fs.access(getGrokConfigPath());
        return true;
      } catch {
        return false;
      }
    }
  }
};

const readConfigToml = async () => {
  try {
    return await fs.readFile(getGrokConfigPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const getTomlField = (body, key) => {
  const m = body.match(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*"([^"]*)"`, "m"));
  return m ? m[1] : null;
};

const parseModelSection = (toml) => {
  const match = toml.match(MODEL_SECTION_RE);
  if (!match) return null;
  const body = match[0].replace(/^\[model\.[^\]]+\][ \t]*\r?\n/, "");
  return {
    model: getTomlField(body, "model"),
    base_url: getTomlField(body, "base_url"),
    name: getTomlField(body, "name"),
    api_key: getTomlField(body, "api_key"),
    api_backend: getTomlField(body, "api_backend"),
  };
};

const parseModelsDefault = (toml) => {
  const match = toml.match(MODELS_SECTION_RE);
  if (!match) return null;
  return getTomlField(match[1] || "", "default");
};

const buildModelSection = (model, baseUrl, apiKey) => {
  const lines = [
    `[model.${MODEL_SLOT}]`,
    `model = "${model}"`,
    `base_url = "${baseUrl}"`,
    `name = "9Router"`,
    `description = "Routed via 9Router gateway"`,
    `api_backend = "chat_completions"`,
  ];
  if (apiKey) lines.push(`api_key = "${apiKey}"`);
  return `${lines.join("\n")}\n`;
};

const upsertModelSection = (toml, section) => {
  if (MODEL_SECTION_RE.test(toml)) return toml.replace(MODEL_SECTION_RE, section);
  const needsNl = toml.length > 0 && !toml.endsWith("\n");
  return `${toml}${needsNl ? "\n" : ""}\n${section}`;
};

const removeModelSection = (toml) =>
  toml.replace(MODEL_SECTION_RE, "").replace(/\n{3,}/g, "\n\n");

// Set or insert default = "..." inside existing [models], or create the section
const setModelsDefault = (toml, value) => {
  const match = toml.match(MODELS_SECTION_RE);
  if (match) {
    const body = match[1] || "";
    let newBody;
    if (/^[ \t]*default[ \t]*=/m.test(body)) {
      newBody = body.replace(/^[ \t]*default[ \t]*=[ \t]*"[^"]*"/m, `default = "${value}"`);
    } else {
      newBody = `default = "${value}"\n${body}`;
    }
    return toml.replace(match[0], `[models]\n${newBody}`);
  }
  const block = `[models]\ndefault = "${value}"\n\n`;
  return toml.length > 0 ? block + toml : block;
};

// Remember the previous default once (so re-Apply does not overwrite it with "9router")
const rememberPrevDefault = (toml) => {
  if (PREV_DEFAULT_RE.test(toml)) return toml;
  const current = parseModelsDefault(toml);
  if (!current || current === MODEL_SLOT) return toml;
  const marker = `# 9router-prev-default = "${current}"\n`;
  // Prefer placing the marker just above [model.9router] if present, else at EOF
  if (MODEL_SECTION_RE.test(toml)) {
    return toml.replace(MODEL_SECTION_RE, (section) => marker + section);
  }
  const needsNl = toml.length > 0 && !toml.endsWith("\n");
  return `${toml}${needsNl ? "\n" : ""}${marker}`;
};

// If default points at our slot, restore previous (or built-in) default and drop marker
const clearModelsDefaultIfOurs = (toml) => {
  const prevMatch = toml.match(PREV_DEFAULT_RE);
  const restoreTo = prevMatch?.[1] || BUILTIN_DEFAULT;
  let next = toml.replace(PREV_DEFAULT_RE, "");
  const current = parseModelsDefault(next);
  if (current === MODEL_SLOT) {
    next = setModelsDefault(next, restoreTo);
  }
  return next;
};

const has9RouterConfig = (modelCfg) => {
  if (!modelCfg?.base_url) return false;
  return true;
};

export async function GET() {
  try {
    const installed = await checkGrokInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Grok Build is not installed",
      });
    }

    const toml = await readConfigToml();
    const model = parseModelSection(toml);
    const defaultModel = parseModelsDefault(toml);

    return NextResponse.json({
      installed: true,
      settings: {
        model,
        default: defaultModel,
      },
      has9Router: has9RouterConfig(model),
      configPath: getGrokConfigPath(),
    });
  } catch (error) {
    console.log("Error checking grok-build settings:", error);
    return NextResponse.json({ error: "Failed to check grok-build settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const dir = getGrokDir();
    await fs.mkdir(dir, { recursive: true });

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToWrite = apiKey || "sk_9router";

    let toml = await readConfigToml();
    toml = rememberPrevDefault(toml);
    toml = upsertModelSection(toml, buildModelSection(model, normalizedBaseUrl, keyToWrite));
    toml = setModelsDefault(toml, MODEL_SLOT);

    await fs.writeFile(getGrokConfigPath(), toml);

    return NextResponse.json({
      success: true,
      message: "Grok Build settings applied successfully!",
      configPath: getGrokConfigPath(),
      modelSlot: MODEL_SLOT,
    });
  } catch (error) {
    console.log("Error updating grok-build settings:", error);
    return NextResponse.json({ error: "Failed to update grok-build settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getGrokConfigPath();
    let toml = "";
    try {
      toml = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    toml = removeModelSection(toml);
    toml = clearModelsDefaultIfOurs(toml);
    await fs.writeFile(configPath, toml);

    return NextResponse.json({
      success: true,
      message: `${PROVIDER_NAME} model slot removed from Grok Build`,
    });
  } catch (error) {
    console.log("Error resetting grok-build settings:", error);
    return NextResponse.json({ error: "Failed to reset grok-build settings" }, { status: 500 });
  }
}
