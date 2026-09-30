"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { parseTOML, stringifyTOML } from "confbox";

const execAsync = promisify(exec);

const getForgeDir = () => path.join(os.homedir(), ".forge");
const getForgeConfigPath = () => path.join(getForgeDir(), "config.toml");

const checkForgeInstalled = async () => {
  const isWindows = os.platform() === "win32";
  try {
    const command = isWindows ? "where forge" : "which forge";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getForgeConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const has9RouterConfig = (content) => {
  if (!content) return false;
  return content.includes("managed by 9Router") || content.includes("localhost:20128");
};

const readConfig = async () => {
  try {
    return await fs.readFile(getForgeConfigPath(), "utf-8");
  } catch {
    return null;
  }
};

export async function GET() {
  try {
    const installed = await checkForgeInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "ForgeCode CLI is not installed",
      });
    }

    const content = await readConfig();
    let config = null;
    try {
      if (content) config = parseTOML(content);
    } catch {}

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(content),
      configPath: getForgeConfigPath(),
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

    const configPath = getForgeConfigPath();
    await fs.mkdir(getForgeDir(), { recursive: true });

    let existing = {};
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      existing = parseTOML(raw);
    } catch {}

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    existing.openai = {
      api_key: apiKey || "sk_9router",
      base_url: normalizedBaseUrl,
      model: model || "provider/model-id",
    };

    const header = "# Forge config — managed by 9Router\n\n";
    const content = header + stringifyTOML(existing);

    await fs.writeFile(configPath, content, "utf-8");

    return NextResponse.json({
      success: true,
      message: "ForgeCode settings applied successfully!",
      configPath,
    });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getForgeConfigPath();
    let existing = {};
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      existing = parseTOML(raw);
    } catch {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    delete existing.openai;

    if (Object.keys(existing).length === 0) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, stringifyTOML(existing), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from ForgeCode" });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
