"use server";

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseTOML, stringifyTOML } from "confbox";
import { DATA_DIR } from "@/lib/dataDir.js";
import { getInstalledCodexClientVersion } from "@/lib/codexNative/clientVersion.js";
import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";

const BRIDGE_SECRET_PATH = path.join(DATA_DIR, "secrets", "codex-bridge-token");
const BRIDGE_STATE_PATH = path.join(DATA_DIR, "state", "codex-bridge.json");
const NATIVE_READINESS_PATH = path.join(DATA_DIR, "codex-native", "readiness.json");

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

const parsedToWritable = (obj) => obj ?? {};

const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let current = obj;
  for (let index = 0; index < keys.length - 1; index++) {
    if (current[keys[index]] == null || typeof current[keys[index]] !== "object") {
      current[keys[index]] = {};
    }
    current = current[keys[index]];
  }
  current[keys[keys.length - 1]] = value;
};

const getNestedSection = (obj, dottedKey) =>
  dottedKey.split(".").reduce((value, key) => value?.[key], obj);

const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let current = obj;
  for (let index = 0; index < keys.length - 1; index++) {
    current = current?.[keys[index]];
    if (current == null) return;
  }
  delete current[keys[keys.length - 1]];
};

async function atomicWrite(filePath, content, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content, { mode });
  await fs.rename(temporaryPath, filePath);
  try { await fs.chmod(filePath, mode); } catch { /* Windows and restricted filesystems */ }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readConfig() {
  try {
    return await fs.readFile(getCodexConfigPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function has9RouterConfig(config) {
  if (!config) return false;
  return config.includes('model_provider = "9router"')
    || config.includes('model_provider = "9router_codex"')
    || config.includes("[model_providers.9router]")
    || config.includes("[model_providers.9router_codex]");
}

function normalizeUniversalBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function authConfig() {
  return {
    command: "9router",
    args: ["codex", "auth-token", "--data-dir", DATA_DIR],
    refresh_interval_ms: 0,
  };
}

async function writeBridgeState(parsed, managed) {
  const existing = await readJson(BRIDGE_STATE_PATH);
  const previous = existing?.previous || {
    model: parsed.model ?? null,
    modelProvider: parsed.model_provider ?? null,
    subagent: getNestedSection(parsed, "agents.subagent") ?? null,
  };
  await atomicWrite(BRIDGE_STATE_PATH, JSON.stringify({
    version: 1,
    previous,
    managed,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

async function migrateOwnedLegacyAuth(apiKey) {
  const authPath = getCodexAuthPath();
  const auth = await readJson(authPath);
  if (!auth || auth.OPENAI_API_KEY !== apiKey || auth.auth_mode !== "apikey") return false;
  delete auth.OPENAI_API_KEY;
  delete auth.auth_mode;
  if (Object.keys(auth).length === 0) {
    await fs.unlink(authPath).catch(() => {});
  } else {
    await atomicWrite(authPath, JSON.stringify(auth, null, 2));
  }
  return true;
}

export async function GET() {
  try {
    const [versionInfo, config, secretConfigured, nativeReadiness] = await Promise.all([
      getInstalledCodexClientVersion(),
      readConfig(),
      fs.access(BRIDGE_SECRET_PATH).then(() => true).catch(() => false),
      readJson(NATIVE_READINESS_PATH),
    ]);
    const parsed = config ? parsedToWritable(parseTOML(config)) : {};
    const provider = parsed.model_provider || null;
    const mode = provider === CODEX_NATIVE_CONFIG.providerConfigId
      ? "native"
      : (provider === "9router" ? "universal" : null);

    return NextResponse.json({
      installed: versionInfo.installed || !!config,
      codexVersion: versionInfo.version,
      codexVersionRaw: versionInfo.raw,
      nativeSupported: nativeReadiness?.supportsWebSockets ?? null,
      nativeReadiness,
      config,
      mode,
      has9Router: has9RouterConfig(config),
      secretConfigured,
      dataDir: DATA_DIR,
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const {
      baseUrl,
      apiKey,
      model,
      subagentModel,
      mode = "universal",
    } = await request.json();
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }
    if (!["universal", "native"].includes(mode)) {
      return NextResponse.json({ error: "mode must be universal or native" }, { status: 400 });
    }

    const configPath = getCodexConfigPath();
    let parsed = {};
    try {
      parsed = parsedToWritable(parseTOML(await fs.readFile(configPath, "utf8")));
    } catch {
      // First setup.
    }

    const universalBaseUrl = normalizeUniversalBaseUrl(baseUrl);
    const nativeBaseUrl = `${universalBaseUrl}/codex`;
    const readiness = await readJson(NATIVE_READINESS_PATH);
    const wsDisabled = /^(1|true|yes|on)$/i.test(process.env.CODEX_NATIVE_WS_DISABLED || "");
    const supportsWebSockets = !wsDisabled
      && readiness?.supportsWebSockets === true
      && readiness?.configuredBaseUrl === nativeBaseUrl;
    const effectiveSubagentModel = subagentModel || model;
    const provider = mode === "native" ? CODEX_NATIVE_CONFIG.providerConfigId : "9router";
    const managed = { model, modelProvider: provider, subagent: { model: effectiveSubagentModel } };
    await writeBridgeState(parsed, managed);

    parsed.model = model;
    parsed.model_provider = provider;
    setNestedSection(parsed, "model_providers.9router", {
      name: "9Router Universal",
      base_url: universalBaseUrl,
      wire_api: "responses",
      auth: authConfig(),
    });
    setNestedSection(parsed, `model_providers.${CODEX_NATIVE_CONFIG.providerConfigId}`, {
      name: "9Router Codex Native",
      base_url: nativeBaseUrl,
      wire_api: "responses",
      supports_websockets: supportsWebSockets,
      auth: authConfig(),
    });
    setNestedSection(parsed, "agents.subagent", { model: effectiveSubagentModel });

    await atomicWrite(configPath, stringifyTOML(parsed));
    await atomicWrite(BRIDGE_SECRET_PATH, `${apiKey.trim()}\n`);
    const migratedLegacyAuth = await migrateOwnedLegacyAuth(apiKey.trim());

    return NextResponse.json({
      success: true,
      mode,
      migratedLegacyAuth,
      message: mode === "native"
        ? "Codex Native pool configured successfully"
        : "Codex Universal bridge configured successfully",
      configPath,
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();
    let parsed = {};
    try {
      parsed = parsedToWritable(parseTOML(await fs.readFile(configPath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const bridgeState = await readJson(BRIDGE_STATE_PATH);
    const managed = bridgeState?.managed;
    const previous = bridgeState?.previous;

    if (managed && parsed.model === managed.model && parsed.model_provider === managed.modelProvider) {
      if (previous?.model == null) delete parsed.model;
      else parsed.model = previous.model;
      if (previous?.modelProvider == null) delete parsed.model_provider;
      else parsed.model_provider = previous.modelProvider;
    } else if (parsed.model_provider === "9router" || parsed.model_provider === CODEX_NATIVE_CONFIG.providerConfigId) {
      delete parsed.model;
      delete parsed.model_provider;
    }

    const currentSubagent = getNestedSection(parsed, "agents.subagent");
    if (managed && JSON.stringify(currentSubagent) === JSON.stringify(managed.subagent)) {
      if (previous?.subagent == null) deleteNestedSection(parsed, "agents.subagent");
      else setNestedSection(parsed, "agents.subagent", previous.subagent);
    }

    deleteNestedSection(parsed, "model_providers.9router");
    deleteNestedSection(parsed, `model_providers.${CODEX_NATIVE_CONFIG.providerConfigId}`);
    await atomicWrite(configPath, stringifyTOML(parsed));
    await Promise.all([
      fs.unlink(BRIDGE_SECRET_PATH).catch(() => {}),
      fs.unlink(BRIDGE_STATE_PATH).catch(() => {}),
    ]);

    return NextResponse.json({
      success: true,
      message: "9Router Codex providers removed; previous Codex defaults restored when unchanged",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
