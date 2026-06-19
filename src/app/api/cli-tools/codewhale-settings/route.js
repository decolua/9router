"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";
const LEGACY_DIR_NAME = ".deepseek";
const PRIMARY_DIR_NAME = ".codewhale";

const getLegacyDir = () => path.join(os.homedir(), LEGACY_DIR_NAME);
const getPrimaryDir = () => path.join(os.homedir(), PRIMARY_DIR_NAME);

const getPrimaryConfigPath = () => path.join(getPrimaryDir(), "config.toml");
const getLegacyConfigPath = () => path.join(getLegacyDir(), "config.toml");

// Simple TOML parser for key = "value" and [section] patterns
const parseToml = (content) => {
    const result = {};
    let currentSection = result;

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Section header: [section] or [section.subsection]
        const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            const sectionName = sectionMatch[1];
            if (!result[sectionName]) result[sectionName] = {};
            currentSection = result[sectionName];
            continue;
        }

        // Key = "value" or key = value
        const keyValueMatch = trimmed.match(/^(\w+)\s*=\s*"([^"]*)"$/);
        if (keyValueMatch) {
            currentSection[keyValueMatch[1]] = keyValueMatch[2];
            continue;
        }

        // Key = value (unquoted)
        const unquotedMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
        if (unquotedMatch) {
            currentSection[unquotedMatch[1]] = unquotedMatch[2].trim();
        }
    }

    return result;
};

// Build TOML config for 9Router (openai provider mode)
const build9RouterConfig = (baseUrl, apiKey, model) => {
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    return `provider = "openai"

[providers.openai]
base_url = "${normalizedBaseUrl}"
api_key = "${apiKey}"
model = "${model}"
`;
};

// Default CodeWhale config (reset state)
const DEFAULT_CONFIG = `provider = "deepseek"
`;

const checkCodeWhaleInstalled = async () => {
    try {
        const isWindows = os.platform() === "win32";
        const command = isWindows ? "where codewhale" : "which codewhale";
        await execAsync(command, { windowsHide: true });
        return true;
    } catch {
        try {
            await fs.access(getPrimaryConfigPath());
            return true;
        } catch {
            try {
                await fs.access(getLegacyConfigPath());
                return true;
            } catch {
                return false;
            }
        }
    }
};

// Read config from primary path, falling back to legacy path for upgrading users.
const readConfigToml = async () => {
    for (const candidate of [getPrimaryConfigPath(), getLegacyConfigPath()]) {
        try {
            return await fs.readFile(candidate, "utf-8");
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    return "";
};

// Pick the path to use for a new write: prefer the primary ~/.codewhale folder,
// or fall back to legacy ~/.deepseek if the primary does not exist and legacy does.
const resolveWriteConfigPath = async () => {
    try {
        await fs.access(getPrimaryConfigPath());
        return getPrimaryConfigPath();
    } catch {
        try {
            await fs.access(getLegacyConfigPath());
            return getLegacyConfigPath();
        } catch {
            return getPrimaryConfigPath();
        }
    }
};

// The path exposed to the UI for the active config file (read location).
const getActiveConfigPath = async () => {
    try {
        await fs.access(getPrimaryConfigPath());
        return getPrimaryConfigPath();
    } catch {
        try {
            await fs.access(getLegacyConfigPath());
            return getLegacyConfigPath();
        } catch {
            return getPrimaryConfigPath();
        }
    }
};

// Detect 9Router by checking if provider is "openai" and base_url points to localhost/127.0.0.1
const has9RouterConfig = (config) => {
    if (!config) return false;
    const provider = config.provider;
    if (provider !== "openai") return false;
    const openaiSection = config["providers.openai"];
    if (!openaiSection?.base_url) return false;
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(openaiSection.base_url);
};

export async function GET() {
    try {
        const installed = await checkCodeWhaleInstalled();
        if (!installed) {
            return NextResponse.json({ installed: false, settings: null, message: "CodeWhale is not installed" });
        }
        const toml = await readConfigToml();
        const config = parseToml(toml);
        return NextResponse.json({
            installed: true,
            settings: config,
            has9Router: has9RouterConfig(config),
            configPath: await getActiveConfigPath(),
        });
    } catch (error) {
        console.log("Error checking codewhale settings:", error);
        return NextResponse.json({ error: "Failed to check codewhale settings" }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { baseUrl, apiKey, model } = await request.json();
        if (!baseUrl || !model) {
            return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
        }

        const targetPath = await resolveWriteConfigPath();
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        const newConfig = build9RouterConfig(baseUrl, apiKey || "sk_9router", model);
        await fs.writeFile(targetPath, newConfig);

        return NextResponse.json({
            success: true,
            message: "CodeWhale settings applied successfully!",
            configPath: targetPath,
        });
    } catch (error) {
        console.log("Error updating codewhale settings:", error);
        return NextResponse.json({ error: "Failed to update codewhale settings" }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        const configPath = await resolveWriteConfigPath();
        try {
            await fs.access(configPath);
        } catch {
            return NextResponse.json({ success: true, message: "No config file to reset" });
        }

        await fs.writeFile(configPath, DEFAULT_CONFIG);
        return NextResponse.json({ success: true, message: `${PROVIDER_NAME} config reset to CodeWhale defaults` });
    } catch (error) {
        console.log("Error resetting codewhale settings:", error);
        return NextResponse.json({ error: "Failed to reset codewhale settings" }, { status: 500 });
    }
}
