/**
 * Hermes on-disk config writer — shared by the existing hermes-settings POST
 * handler and the new hermes-profiles activate route (Issue #1952).
 *
 * Writes the model: block to ~/.hermes/config.yaml and synchronizes
 * OPENAI_API_KEY in ~/.hermes/.env.
 *
 * @module src/lib/hermes/applyProfile
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

const API_KEY_ENV = "OPENAI_API_KEY";

export { API_KEY_ENV };

// ─── Path helpers ─────────────────────────────────────────────────────────────

export const getHermesDir = () => path.join(os.homedir(), ".hermes");
export const getHermesConfigPath = () => path.join(getHermesDir(), "config.yaml");
export const getHermesEnvPath = () => path.join(getHermesDir(), ".env");

// ─── YAML helpers ─────────────────────────────────────────────────────────────

// Match top-level "model:" block (until next non-indented, non-empty line)
const MODEL_BLOCK_RE = /^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;

export function buildModelBlock(model, baseUrl) {
  return `model:\n  default: "${model}"\n  provider: "custom"\n  base_url: "${baseUrl}"\n`;
}

/** Replace or insert the model: block, preserving the rest of the YAML. */
export function upsertModelBlock(yaml, newBlock) {
  if (MODEL_BLOCK_RE.test(yaml)) return yaml.replace(MODEL_BLOCK_RE, newBlock);
  return yaml.length > 0 ? `${newBlock}\n${yaml}` : newBlock;
}

/** Remove the model: block from the YAML. */
export function removeModelBlock(yaml) {
  return yaml.replace(MODEL_BLOCK_RE, "").replace(/^\n+/, "");
}

// ─── .env helpers ─────────────────────────────────────────────────────────────

function getEnvLineEnding(envText) {
  return envText.includes("\r\n") ? "\r\n" : "\n";
}

export function upsertEnvVar(envText, key, value) {
  const line = `${key}=${value}`;
  const lineEnding = getEnvLineEnding(envText);
  const nextLines = [];
  let replaced = false;

  for (const existingLine of envText.split(/\r?\n/)) {
    if (existingLine.startsWith(`${key}=`)) {
      if (!replaced) {
        nextLines.push(line);
        replaced = true;
      }
      continue;
    }
    nextLines.push(existingLine);
  }

  if (replaced) return nextLines.join(lineEnding);

  return envText.length > 0 && !envText.endsWith("\n")
    ? `${envText}${lineEnding}${line}${lineEnding}`
    : `${envText}${line}${lineEnding}`;
}

export function removeEnvVar(envText, key) {
  const lineEnding = getEnvLineEnding(envText);
  return envText
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(`${key}=`))
    .join(lineEnding);
}

export function parseEnvVar(envText, key) {
  const match = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

export async function readConfigYaml() {
  try {
    return await fs.readFile(getHermesConfigPath(), "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

export async function readEnvFile() {
  try {
    return await fs.readFile(getHermesEnvPath(), "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

export async function readApiKeyFromEnv() {
  const envText = await readEnvFile();
  return parseEnvVar(envText, API_KEY_ENV);
}

// ─── High-level apply ─────────────────────────────────────────────────────────

function normalizeApiKey(apiKey) {
  if (typeof apiKey !== "string") return null;
  const trimmed = apiKey.trim();
  return trimmed ? trimmed : null;
}

async function syncApiKeyOnDisk(apiKey) {
  const envPath = getHermesEnvPath();
  const existingEnv = await readEnvFile();
  const normalizedApiKey = normalizeApiKey(apiKey);

  if (normalizedApiKey) {
    const newEnv = upsertEnvVar(existingEnv, API_KEY_ENV, normalizedApiKey);
    await fs.writeFile(envPath, newEnv);
    return;
  }

  const newEnv = removeEnvVar(existingEnv, API_KEY_ENV);
  if (newEnv.trim()) {
    await fs.writeFile(envPath, newEnv);
    return;
  }

  try {
    await fs.unlink(envPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/**
 * Write a profile's settings to the Hermes on-disk config.
 *
 * @param {{ baseUrl: string, model: string, apiKey?: string|null }} profile
 * @returns {Promise<{ configPath: string }>}
 */
export async function applyProfileToDisk({ baseUrl, model, apiKey }) {
  const dir = getHermesDir();
  await fs.mkdir(dir, { recursive: true });

  const normalizedUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

  // config.yaml — replace/insert model: block, keep everything else
  const existingYaml = await readConfigYaml();
  const newYaml = upsertModelBlock(existingYaml, buildModelBlock(model, normalizedUrl));
  await fs.writeFile(getHermesConfigPath(), newYaml);

  // .env — update, clear, or remove the managed API key while preserving
  // unrelated entries.
  await syncApiKeyOnDisk(apiKey);

  return { configPath: getHermesConfigPath() };
}

/**
 * Remove the 9Router model block from config.yaml (reset a profile's disk
 * state without touching .env or profile DB records).
 * @returns {Promise<{ configPath: string }>}
 */
export async function removeProfileFromDisk() {
  const configPath = getHermesConfigPath();
  let yaml = "";
  try {
    yaml = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return { configPath };
    throw err;
  }
  await fs.writeFile(configPath, removeModelBlock(yaml));
  return { configPath };
}

// ─── Parse helper (mirrors hermes-settings route) ────────────────────────────

/**
 * Parse a model block from a YAML string — same logic as the existing
 * hermes-settings GET handler.
 * @param {string} yaml
 * @returns {{ default: string|null, provider: string|null, base_url: string|null }|null}
 */
export function parseModelBlock(yaml) {
  const match = yaml.match(MODEL_BLOCK_RE);
  if (!match) return null;
  const body = match[1] || "";
  const get = (key) => {
    const m = body.match(
      new RegExp(`^[ \\t]+${key}:[ \\t]*["']?([^"'\\r\\n]+)["']?`, "m")
    );
    return m ? m[1].trim() : null;
  };
  return {
    default: get("default"),
    provider: get("provider"),
    base_url: get("base_url"),
  };
}
