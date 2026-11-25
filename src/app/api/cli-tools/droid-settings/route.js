"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { parseJSONC } from "confbox";
import { resolveCliApiKey, CliKeySelectionError } from "../resolveApiKey.js";
import { readOptionalFile, writePrivateFile } from "../privateSettingsFile.js";

const execAsync = promisify(exec);

const getDroidDir = () => path.join(os.homedir(), ".factory");
const getDroidSettingsPath = () => path.join(getDroidDir(), "settings.json");

// Check if droid CLI is installed (via which/where or config file exists)
const checkDroidInstalled = async () => {
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
      await fs.access(getDroidSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

const isManaged = m => /^custom:9Router(?:-\d+)?$/.test(m?.id);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

async function readSettings() {
  const raw = await readOptionalFile(getDroidSettingsPath());
  if (raw === null) return null;
  const errors = [];
  const settings = parseJSONC(raw, { allowTrailingComma: true, errors });
  if (errors.length || !isObject(settings) ||
      ("customModels" in settings && !Array.isArray(settings.customModels))) {
    throw new Error("Invalid Droid settings");
  }
  return settings;
}

export async function GET() {
  try {
    if (!await checkDroidInstalled()) {
      return NextResponse.json({ installed: false, settings: null, message: "Factory Droid CLI is not installed" });
    }
    const settings = await readSettings();
    const customModels = (settings?.customModels ?? []).filter(isManaged)
      .map(({ id, model, index, baseUrl }) => ({ id, model, index, baseUrl }));
    return NextResponse.json({
      installed: true, settings: settings && { customModels },
      has9Router: customModels.length > 0, settingsPath: getDroidSettingsPath(),
    });
  } catch {
    return NextResponse.json({ error: "Failed to check droid settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel } = await request.json();
    const requested = Array.isArray(models) ? [...models] : [model];
    if (typeof baseUrl !== "string" || !baseUrl.trim() || !requested.length ||
        requested.some(m => typeof m !== "string" || !m.trim()) || new Set(requested).size !== requested.length) {
      return NextResponse.json({ error: "baseUrl and distinct model names are required" }, { status: 400 });
    }
    const url = baseUrl.trim().replace(/\/+$/, "");
    const destination = url.endsWith("/v1") ? url : url + "/v1";
    const settings = await readSettings() ?? {};
    const existing = settings.customModels ?? [];
    const managed = existing.filter(isManaged);
    const others = existing.filter(m => !isManaged(m));
    const activeIndex = requested.indexOf(activeModel);
    if (activeIndex > 0) requested.unshift(...requested.splice(activeIndex, 1));

    const entries = requested.map((name, index) => {
      const matches = managed.filter(m => m.model === name);
      if (matches.length > 1) throw new Error("Ambiguous Droid model");
      const saved = matches[0];
      const savedKey = saved?.apiKey === "your_api_key" ? undefined : saved?.apiKey;
      const selected = resolveCliApiKey(apiKey, destination, saved?.baseUrl, savedKey);
      if (saved && saved.baseUrl !== destination && Object.keys(saved.extraHeaders ?? {}).length) {
        throw new CliKeySelectionError("Review custom headers in Droid settings before switching endpoints.");
      }
      return {
        displayName: name, maxOutputTokens: 131072, noImageSupport: false, provider: "openai",
        ...saved,
        model: name, id: `custom:9Router-${index}`, index,
        baseUrl: destination,
        apiKey: selected,
      };
    });
    settings.customModels = activeModel === "" ? [...others, ...entries] : [...entries, ...others];
    await fs.mkdir(getDroidDir(), { recursive: true });
    await writePrivateFile(getDroidSettingsPath(), JSON.stringify(settings, null, 2));
    return NextResponse.json({ success: true, message: "Factory Droid settings applied successfully!", settingsPath: getDroidSettingsPath() });
  } catch (error) {
    if (error instanceof CliKeySelectionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to update droid settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const settings = await readSettings();
    if (settings?.customModels?.some(isManaged)) {
      settings.customModels = settings.customModels.filter(m => !isManaged(m));
      if (!settings.customModels.length) delete settings.customModels;
      await writePrivateFile(getDroidSettingsPath(), JSON.stringify(settings, null, 2));
    }
    return NextResponse.json({ success: true, message: "9Router settings removed successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to reset droid settings" }, { status: 500 });
  }
}
