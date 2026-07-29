"use server";

import { exec } from "child_process";
import fs from "fs/promises";
import { NextResponse } from "next/server";
import os from "os";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const getConfigDir = () => path.join(os.homedir(), ".pi", "agent");
const getConfigPath = () => path.join(getConfigDir(), "models.json");

const checkPiInstalled = async () => {
	try {
		const isWindows = os.platform() === "win32";
		const command = isWindows ? "where pi" : "which pi";
		await execAsync(command, { windowsHide: true });
		return true;
	} catch {
		try {
			await fs.access(getConfigPath());
			return true;
		} catch {
			return false;
		}
	}
};

const readConfig = async () => {
	try {
		const content = await fs.readFile(getConfigPath(), "utf-8");
		return JSON.parse(content);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		return null;
	}
};

const has9RouterConfig = (config) => {
	if (!config?.providers) return false;
	return !!config.providers["9router"];
};

export async function GET() {
	try {
		const isInstalled = await checkPiInstalled();

		if (!isInstalled) {
			return NextResponse.json({
				installed: false,
				config: null,
				message: "Pi CLI is not installed",
			});
		}

		const config = await readConfig();
		const providerConfig = config?.providers?.["9router"];
		const modelIds = (providerConfig?.models || []).map((m) => m.id);

		return NextResponse.json({
			installed: true,
			config,
			has9Router: has9RouterConfig(config),
			configPath: getConfigPath(),
			pi: {
				models: modelIds,
				baseURL: providerConfig?.baseUrl || null,
			},
		});
	} catch (error) {
		console.log("Error checking pi settings:", error);
		return NextResponse.json(
			{ error: "Failed to check pi settings" },
			{ status: 500 },
		);
	}
}

export async function POST(request) {
	try {
		const { baseUrl, apiKey, models } = await request.json();

		const modelsArray = Array.isArray(models) ? models.slice() : [];

		if (!baseUrl || modelsArray.length === 0) {
			return NextResponse.json(
				{ error: "baseUrl and at least one model are required" },
				{ status: 400 },
			);
		}

		const configDir = getConfigDir();
		const configPath = getConfigPath();

		await fs.mkdir(configDir, { recursive: true });

		let config = {};
		try {
			const existing = await fs.readFile(configPath, "utf-8");
			config = JSON.parse(existing);
		} catch {}

		const normalizedBaseUrl = baseUrl.endsWith("/v1")
			? baseUrl
			: `${baseUrl}/v1`;
		const keyToUse = apiKey || "sk_9router";

		if (!config.providers) config.providers = {};
		if (!config.providers["9router"]) {
			config.providers["9router"] = {
				baseUrl: normalizedBaseUrl,
				api: "openai-completions",
				apiKey: keyToUse,
				models: [],
			};
		}

		config.providers["9router"].baseUrl = normalizedBaseUrl;
		config.providers["9router"].api = "openai-completions";
		config.providers["9router"].apiKey = keyToUse;

		const existingModelIds = new Set(
			(config.providers["9router"].models || []).map((m) => m.id),
		);
		for (const m of modelsArray) {
			if (!m || typeof m !== "string") continue;
			if (!existingModelIds.has(m)) {
				if (!config.providers["9router"].models)
					config.providers["9router"].models = [];
				config.providers["9router"].models.push({
					id: m,
					input: ["text", "image"],
				});
				existingModelIds.add(m);
			}
		}

		await fs.writeFile(configPath, JSON.stringify(config, null, 2));

		return NextResponse.json({
			success: true,
			message: "Pi settings applied successfully!",
			configPath,
		});
	} catch (error) {
		console.log("Error applying pi settings:", error);
		return NextResponse.json(
			{ error: "Failed to apply settings" },
			{ status: 500 },
		);
	}
}

export async function DELETE(request) {
	try {
		const { searchParams } = new URL(request.url);
		const modelToRemove = searchParams.get("model");
		const configPath = getConfigPath();

		let config = {};
		try {
			const existing = await fs.readFile(configPath, "utf-8");
			config = JSON.parse(existing);
		} catch (error) {
			if (error.code === "ENOENT") {
				return NextResponse.json({
					success: true,
					message: "No config file to reset",
				});
			}
			throw error;
		}

		if (modelToRemove && config.providers?.["9router"]?.models) {
			config.providers["9router"].models = config.providers[
				"9router"
			].models.filter((m) => m.id !== modelToRemove);

			if (config.providers["9router"].models.length === 0) {
				delete config.providers["9router"];
				if (Object.keys(config.providers).length === 0) delete config.providers;
			}
		} else {
			if (config.providers) delete config.providers["9router"];
			if (config.providers && Object.keys(config.providers).length === 0)
				delete config.providers;
		}

		await fs.writeFile(configPath, JSON.stringify(config, null, 2));

		return NextResponse.json({
			success: true,
			message: modelToRemove
				? `Model "${modelToRemove}" removed`
				: "9Router settings removed from Pi",
		});
	} catch (error) {
		console.log("Error resetting pi settings:", error);
		return NextResponse.json(
			{ error: "Failed to reset pi settings" },
			{ status: 500 },
		);
	}
}
