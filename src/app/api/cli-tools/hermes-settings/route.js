"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  applyProfileToDisk,
  parseModelBlock,
  readConfigYaml,
  removeProfileFromDisk,
} from "@/lib/hermes/applyProfile.js";
import {
  clearActiveProfileId,
  listProfiles,
  looksLike9RouterConfig,
  syncActiveProfileFromLegacySettings,
} from "@/lib/hermes/profileStore.js";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";
const getHermesDir = () => path.join(os.homedir(), ".hermes");
const getHermesConfigPath = () => path.join(getHermesDir(), "config.yaml");
const getHermesEnvPath = () => path.join(getHermesDir(), ".env");

const checkHermesInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where hermes" : "which hermes";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getHermesConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const has9RouterConfig = (modelCfg) => looksLike9RouterConfig(modelCfg);

async function restoreProfileOnDisk(profile) {
  if (!profile) return;
  try {
    await applyProfileToDisk(profile);
  } catch (rollbackErr) {
    console.log("Failed to restore hermes settings during rollback:", rollbackErr);
  }
}

async function readOptionalFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath, "utf-8"),
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        exists: false,
        content: null,
      };
    }
    throw err;
  }
}

async function captureHermesDiskState() {
  return {
    config: await readOptionalFile(getHermesConfigPath()),
    env: await readOptionalFile(getHermesEnvPath()),
  };
}

async function restoreOptionalFile(filePath, snapshot) {
  if (!snapshot?.exists) {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, snapshot.content);
}

async function restoreHermesDiskState(snapshot) {
  try {
    await restoreOptionalFile(getHermesConfigPath(), snapshot?.config);
    await restoreOptionalFile(getHermesEnvPath(), snapshot?.env);
  } catch (rollbackErr) {
    console.error("Failed to restore hermes settings on disk during rollback:", rollbackErr);
  }
}

export async function GET() {
  try {
    const installed = await checkHermesInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Hermes Agent is not installed" });
    }
    const yaml = await readConfigYaml();
    const model = parseModelBlock(yaml);
    return NextResponse.json({
      installed: true,
      settings: { model },
      has9Router: has9RouterConfig(model),
      configPath: getHermesConfigPath(),
    });
  } catch (error) {
    console.log("Error checking hermes settings:", error);
    return NextResponse.json({ error: "Failed to check hermes settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    if (!baseUrl || !model) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    const previousDiskState = await captureHermesDiskState();

    await applyProfileToDisk({ baseUrl, apiKey, model });

    try {
      await syncActiveProfileFromLegacySettings({ baseUrl, apiKey, model });
    } catch (storeErr) {
      await restoreHermesDiskState(previousDiskState);
      throw storeErr;
    }

    return NextResponse.json({
      success: true,
      message: "Hermes settings applied successfully!",
      configPath: getHermesConfigPath(),
    });
  } catch (error) {
    console.log("Error updating hermes settings:", error);
    return NextResponse.json({ error: "Failed to update hermes settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const store = await listProfiles();
    const activeProfile = store.profiles.find((profile) => profile.id === store.activeProfileId) ?? null;

    await removeProfileFromDisk();

    try {
      await clearActiveProfileId();
    } catch (clearErr) {
      await restoreProfileOnDisk(activeProfile);
      throw clearErr;
    }

    return NextResponse.json({ success: true, message: `${PROVIDER_NAME} model block removed` });
  } catch (error) {
    console.log("Error resetting hermes settings:", error);
    return NextResponse.json({ error: "Failed to reset hermes settings" }, { status: 500 });
  }
}
