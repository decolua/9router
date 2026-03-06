"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

// Parse TOML config to object (simple parser for codex config)
const parseToml = (content) => {
  const result = { _root: {}, _sections: {} };
  let currentSection = "_root";
  
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    
    // Section header like [model_providers.9router]
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result._sections[currentSection] = {};
      return;
    }
    
    // Key = value
    const kvMatch = trimmed.match(/^([^=]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (currentSection === "_root") {
        result._root[key] = value;
      } else {
        result._sections[currentSection][key] = value;
      }
    }
  });
  
  return result;
};

// Convert parsed object back to TOML string
const toToml = (parsed) => {
  let lines = [];
  
  // Root level keys
  Object.entries(parsed._root).forEach(([key, value]) => {
    lines.push(`${key} = "${value}"`);
  });
  
  // Sections
  Object.entries(parsed._sections).forEach(([section, values]) => {
    lines.push("");
    lines.push(`[${section}]`);
    Object.entries(values).forEach(([key, value]) => {
      lines.push(`${key} = "${value}"`);
    });
  });
  
  return lines.join("\n") + "\n";
};

// Check if codex CLI is installed
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "command -v codex";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has 9Router settings
const has9RouterConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"9router\"") || config.includes("[model_providers.9router]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update 9Router settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed = { _root: {}, _sections: {} };
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parseToml(existingConfig);
    } catch { /* No existing config */ }

    // Update only 9Router related fields (api_key goes to auth.json, not config.toml)
    parsed._root.model = model;
    parsed._root.model_provider = "9router";
    
    // Update or create 9router provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    parsed._sections["model_providers.9router"] = {
      name: "9Router",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
    };

    // Write merged config
    const configContent = toToml(parsed);
    await fs.writeFile(configPath, configContent);

    // Update auth.json with OPENAI_API_KEY (Codex reads this first)
    const authPath = getCodexAuthPath();
    let authData = {};
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      authData = JSON.parse(existingAuth);
    } catch { /* No existing auth */ }
    
    authData.OPENAI_API_KEY = apiKey;
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = { _root: {}, _sections: {} };
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parseToml(existingConfig);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove 9Router related root fields only if they point to 9router
    if (parsed._root.model_provider === "9router") {
      delete parsed._root.model;
      delete parsed._root.model_provider;
    }
    
    // Remove 9router provider section
    delete parsed._sections["model_providers.9router"];

    // Write updated config
    const configContent = toToml(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      
      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    return NextResponse.json({
      success: true,
      message: "9Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
