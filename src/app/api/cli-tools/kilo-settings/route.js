"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getDataDir = () => path.join(os.homedir(), ".local", "share", "kilo");
const getAuthPath = () => path.join(getDataDir(), "auth.json");
const getVscodeSettingsPath = () => path.join(os.homedir(), ".config", "Code", "User", "settings.json");

const checkInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where kilo" : "which kilo";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getAuthPath());
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

const has9RouterConfig = (auth) => {
  if (!auth) return false;
  const entry = auth["openai-compatible"] || auth["9router"];
  if (!entry) return false;
  const baseUrl = entry.baseUrl || entry.baseURL || "";
  return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("9router");
};

export async function GET() {
  try {
    const installed = await checkInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Kilo Code CLI is not installed" });
    }
    const auth = await readJson(getAuthPath());
    return NextResponse.json({
      installed: true,
      settings: { auth: auth ? Object.keys(auth) : [] },
      has9Router: has9RouterConfig(auth),
      authPath: getAuthPath(),
    });
  } catch (error) {
    console.log("Error checking kilo settings:", error);
    return NextResponse.json({ error: "Failed to check kilo settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    await fs.mkdir(getDataDir(), { recursive: true });

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    const auth = (await readJson(getAuthPath())) || {};
    auth["openai-compatible"] = {
      type: "api-key",
      apiKey,
      baseUrl: normalizedBaseUrl,
      model,
    };
    await fs.writeFile(getAuthPath(), JSON.stringify(auth, null, 2));

    // Best-effort: update VS Code extension settings
    try {
      const vscode = (await readJson(getVscodeSettingsPath())) || {};
      vscode["kilocode.customProvider"] = { name: "9Router", baseURL: normalizedBaseUrl, apiKey };
      vscode["kilocode.defaultModel"] = model;
      await fs.writeFile(getVscodeSettingsPath(), JSON.stringify(vscode, null, 2));
    } catch { /* VS Code settings not writable */ }

    return NextResponse.json({ success: true, message: "Kilo Code settings applied successfully!", authPath: getAuthPath() });
  } catch (error) {
    console.log("Error updating kilo settings:", error);
    return NextResponse.json({ error: "Failed to update kilo settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const auth = await readJson(getAuthPath());
    if (!auth) {
      return NextResponse.json({ success: true, message: "No settings file to reset" });
    }
    delete auth["openai-compatible"];
    delete auth["9router"];
    await fs.writeFile(getAuthPath(), JSON.stringify(auth, null, 2));

    try {
      const vscode = await readJson(getVscodeSettingsPath());
      if (vscode) {
        delete vscode["kilocode.customProvider"];
        delete vscode["kilocode.defaultModel"];
        await fs.writeFile(getVscodeSettingsPath(), JSON.stringify(vscode, null, 2));
      }
    } catch { /* ignore */ }

    return NextResponse.json({ success: true, message: "9Router settings removed from Kilo Code" });
  } catch (error) {
    console.log("Error resetting kilo settings:", error);
    return NextResponse.json({ error: "Failed to reset kilo settings" }, { status: 500 });
  }
}
