"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getSafeExecCwd } from "../_lib/safeExec";

const execAsync = promisify(exec);
const SAFE_EXEC_CWD = getSafeExecCwd();

const getAuthDir = () => path.join(os.homedir(), ".pi", "agent");
const getAuthPath = () => path.join(getAuthDir(), "auth.json");

// Check if pi CLI is installed
const checkPiInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where pi" : "which pi";
    await execAsync(command, { cwd: SAFE_EXEC_CWD, windowsHide: true });
    return true;
  } catch {
    // Also check if auth file exists
    try {
      await fs.access(getAuthPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readAuthFile = async () => {
  try {
    const content = await fs.readFile(getAuthPath(), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const has9RouterConfig = (auth) => {
  if (!auth) return false;
  return !!auth["9router"];
};

// GET - Check pi CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkPiInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        auth: null,
        message: "Pi CLI is not installed",
      });
    }

    const auth = await readAuthFile();
    const routerConfig = auth?.["9router"];

    return NextResponse.json({
      installed: true,
      auth,
      has9Router: has9RouterConfig(auth),
      authPath: getAuthPath(),
      pi: {
        baseURL: routerConfig?.baseURL || null,
        apiKey: routerConfig?.apiKey ? "***" : null,
        configured: !!routerConfig,
      },
    });
  } catch (error) {
    console.log("Error checking pi settings:", error);
    return NextResponse.json({ error: "Failed to check pi settings" }, { status: 500 });
  }
}

// POST - Apply 9Router config to pi auth.json
export async function POST(request) {
  try {
    const { baseUrl, apiKey } = await request.json();

    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }

    const authDir = getAuthDir();
    const authPath = getAuthPath();

    // Create directory with secure permissions
    await fs.mkdir(authDir, { recursive: true, mode: 0o700 });

    // Read existing auth or start fresh
    let auth = {};
    try {
      const existing = await fs.readFile(authPath, "utf-8");
      auth = JSON.parse(existing);
    } catch { /* No existing auth */ }

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";

    // Add/update 9router entry
    auth["9router"] = {
      type: "api_key",
      baseURL: normalizedBaseUrl,
      apiKey: keyToUse,
    };

    // Write auth file with secure permissions (0600)
    await fs.writeFile(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });

    return NextResponse.json({
      success: true,
      message: "Pi auth.json updated successfully",
      authPath,
    });
  } catch (error) {
    console.log("Error applying pi settings:", error);
    return NextResponse.json({ error: "Failed to apply pi settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router config from pi auth.json
export async function DELETE() {
  try {
    const authPath = getAuthPath();

    let auth = {};
    try {
      const existing = await fs.readFile(authPath, "utf-8");
      auth = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No auth file to restore" });
      }
      throw error;
    }

    // Remove 9router entry
    delete auth["9router"];

    // Write back
    await fs.writeFile(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });

    return NextResponse.json({
      success: true,
      message: "9Router config removed from pi auth.json",
    });
  } catch (error) {
    console.log("Error restoring pi settings:", error);
    return NextResponse.json({ error: "Failed to restore pi settings" }, { status: 500 });
  }
}
