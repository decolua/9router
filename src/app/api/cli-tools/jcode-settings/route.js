"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { parseTOML, stringifyTOML } from "confbox";

import { resolveCliApiKey, CliKeySelectionError } from "../resolveApiKey.js";
import { readOptionalFile, writePrivateFile } from "../privateSettingsFile.js";

const execAsync = promisify(exec);

const getJcodeConfigDir = () => path.join(os.homedir(), ".jcode");
const getConfigPath = () => path.join(getJcodeConfigDir(), "config.toml");

const getProviderEnvPath = () => {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "jcode", "provider-9router.env");
};

const checkJcodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where jcode" : "which jcode";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getJcodeConfigDir());
      return true;
    } catch {
      return false;
    }
  }
};

const keyName = "JCODE_9ROUTER_API_KEY";
const envFile = "provider-9router.env";
const staleLockMs = 60_000;
const isTable = value => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

async function readConfig() {
  const raw = await readOptionalFile(getConfigPath());
  const config = raw === null ? {} : parseTOML(raw);
  if (config.providers !== undefined && !isTable(config.providers) ||
      config.providers?.["9router"] !== undefined && !isTable(config.providers["9router"])) {
    throw new Error("Invalid provider configuration");
  }
  return config;
}

// Keep unrelated assignments, comments and quoting verbatim. Unsupported or
// ambiguous input must be corrected before either settings file is changed.
async function readProviderEnv() {
  const raw = await readOptionalFile(getProviderEnvPath());
  const lines = raw?.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let index = -1;
  let key;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^'"#]*?))\s*(?:#.*)?$/.exec(line);
    if (!assignment) throw new Error("Invalid provider environment");
    if (assignment[1] !== keyName) continue;
    if (index !== -1) throw new Error("Duplicate provider key");
    index = i;
    key = assignment[2] ?? assignment[3] ?? assignment[4];
  }
  return { key, withoutKey: lines.filter((_, i) => i !== index).join("") };
}

function envWithKey(withoutKey, key) {
  // Emit a literal value, including for consumers that expand double quotes.
  const quote = /["\\$`]/.test(key) ? "'" : '"';
  if (key.includes(quote) || /[\x00-\x1f\x7f]/.test(key)) throw new CliKeySelectionError("Select a key that can be stored in the provider environment.");
  const eol = withoutKey.includes("\r\n") ? "\r\n" : "\n";
  const prefix = withoutKey && !withoutKey.endsWith("\n") ? withoutKey + eol : withoutKey;
  return prefix + keyName + "=" + quote + key + quote + eol;
}

// Two settings requests must not interleave their config and env writes.
async function withSettingsLock(update) {
  await fs.mkdir(getJcodeConfigDir(), { recursive: true });
  const lock = getConfigPath() + ".9router-lock";
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt === 0) {
        try {
          const entry = await fs.lstat(lock);
          if (entry.isDirectory() && Date.now() - entry.mtimeMs > staleLockMs) {
            await fs.rmdir(lock);
            continue;
          }
        } catch (lockError) {
          if (lockError.code === "ENOENT") continue;
          throw lockError;
        }
      }
      return NextResponse.json({ error: "Jcode settings are locked by another update." }, { status: 409 });
    }
  }
  try {
    return await update();
  } finally {
    await fs.rmdir(lock);
  }
}

export async function GET() {
  try {
    if (!await checkJcodeInstalled()) {
      return NextResponse.json({ installed: false, message: "jcode not installed" });
    }
    const provider = (await readConfig()).providers?.["9router"];
    return NextResponse.json({
      installed: true,
      config: { providers: provider ? { "9router": { base_url: provider.base_url, default_model: provider.default_model } } : {} },
      has9Router: Boolean(provider),
      configPath: getConfigPath(),
    });
  } catch {
    return NextResponse.json({ error: "Failed to check jcode settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, models } = await request.json();
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }
    if (models !== undefined && (!Array.isArray(models) || models.some(m => typeof m !== "string" || !m.trim()))) {
      return NextResponse.json({ error: "models must contain model names" }, { status: 400 });
    }
    const url = baseUrl.trim().replace(/\/+$/, "");
    const destination = url.endsWith("/v1") ? url : url + "/v1";
    return await withSettingsLock(async () => {
      const config = await readConfig();
      const env = await readProviderEnv();
      config.providers ??= {};
      const saved = config.providers["9router"];
      const bound = saved?.api_key_env === keyName && saved.env_file === envFile;
      const selected = resolveCliApiKey(apiKey, destination, bound ? saved.base_url : undefined, env.key);
      if (saved && saved.base_url !== destination &&
          (saved.api_key || Object.keys(saved.headers ?? {}).length || Object.keys(saved.extra_headers ?? {}).length)) {
        throw new CliKeySelectionError("Review inline credentials and headers in Jcode settings before switching endpoints.");
      }
      const envContent = envWithKey(env.withoutKey, selected);
      config.providers["9router"] = {
        ...saved,
        type: "openai-compatible", base_url: destination, auth: "bearer",
        api_key_env: keyName, env_file: envFile,
        default_model: models?.[0] || "cc/claude-opus-4-7",
        requires_api_key: true,
      };
      const configContent = stringifyTOML(config);
      const envPath = getProviderEnvPath();
      await fs.mkdir(path.dirname(envPath), { recursive: true });
      // Revoke the old pairing before publishing the new endpoint. If a
      // later write fails, the new endpoint can never read the previous key.
      if (env.key !== undefined && (!bound || saved.base_url !== destination)) {
        await writePrivateFile(envPath, env.withoutKey);
      }
      await writePrivateFile(getConfigPath(), configContent);
      await writePrivateFile(envPath, envContent);
      return NextResponse.json({ success: true, message: "jcode configured successfully. Use: jcode --provider-profile 9router", configPath: getConfigPath() });
    });
  } catch (error) {
    if (error instanceof CliKeySelectionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to update jcode settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    return await withSettingsLock(async () => {
      const config = await readConfig();
      const env = await readProviderEnv();
      if (config.providers?.["9router"]) {
        delete config.providers["9router"];
        await writePrivateFile(getConfigPath(), stringifyTOML(config));
      }
      if (env.key !== undefined) await writePrivateFile(getProviderEnvPath(), env.withoutKey);
      return NextResponse.json({ success: true, message: "9router configuration removed from jcode" });
    });
  } catch {
    return NextResponse.json({ error: "Failed to reset jcode settings" }, { status: 500 });
  }
}
