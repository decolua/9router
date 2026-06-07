import { spawn } from "child_process";
import os from "os";
import { resolveCommandCodeCliBin } from "./commandCodeCliBin.js";

export const COMMAND_CODE_CLI_STATIC_MODELS = [
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Command Code CLI)", contextLength: 1000000 },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Command Code CLI)", contextLength: 1000000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Command Code CLI)", contextLength: 1000000 },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (Command Code CLI)", contextLength: 1000000 },
  { id: "gpt-5.5", name: "GPT 5.5 (Command Code CLI)", contextLength: 1000000 },
  { id: "gpt-5.4", name: "GPT 5.4 (Command Code CLI)", contextLength: 1000000 },
  { id: "gpt-5.3-codex", name: "GPT 5.3 Codex (Command Code CLI)", contextLength: 1000000 },
  { id: "gpt-5.4-mini", name: "GPT 5.4 Mini (Command Code CLI)", contextLength: 1000000 },
  { id: "Qwen/Qwen3.7-Max-Free", name: "Qwen 3.7 Max Free (Command Code CLI)", contextLength: 1000000 },
  { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6 (Command Code CLI)", contextLength: 1000000 },
  { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5 (Command Code CLI)", contextLength: 1000000 },
  { id: "zai-org/GLM-5.1", name: "GLM 5.1 (Command Code CLI)", contextLength: 1000000 },
  { id: "zai-org/GLM-5", name: "GLM 5 (Command Code CLI)", contextLength: 1000000 },
  { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3 (Command Code CLI)", contextLength: 1000000 },
  { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7 (Command Code CLI)", contextLength: 1000000 },
  { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5 (Command Code CLI)", contextLength: 1000000 },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (Command Code CLI)", contextLength: 1000000 },
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (Command Code CLI)", contextLength: 1000000 },
  { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview (Command Code CLI)", contextLength: 1000000 },
  { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus (Command Code CLI)", contextLength: 1000000 },
  { id: "Qwen/Qwen3.7-Max", name: "Qwen 3.7 Max (Command Code CLI)", contextLength: 1000000 },
  { id: "stepfun/Step-3.7-Flash", name: "Step 3.7 Flash (Command Code CLI)", contextLength: 1000000 },
  { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash (Command Code CLI)", contextLength: 1000000 },
  { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5 Pro (Command Code CLI)", contextLength: 1000000 },
  { id: "xiaomi/mimo-v2.5", name: "MiMo V2.5 (Command Code CLI)", contextLength: 1000000 },
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash (Command Code CLI)", contextLength: 1000000 },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (Command Code CLI)", contextLength: 1000000 },
];

export async function resolveCommandCodeCliModels({ providerSpecificData = {}, timeoutMs = 10000 } = {}) {
  const apiKey = providerSpecificData.commandCodeApiKey || process.env.COMMAND_CODE_API_KEY;

  if (apiKey) {
    const apiModels = await fetchApiModels(apiKey, timeoutMs).catch(() => null);
    if (apiModels?.length) return { models: apiModels, source: "api" };
  }

  const cliModels = await listCliModels(timeoutMs).catch(() => null);
  if (cliModels?.length) return { models: cliModels, source: "cli" };

  return { models: COMMAND_CODE_CLI_STATIC_MODELS, source: "static" };
}

async function fetchApiModels(apiKey, timeoutMs) {
  const response = await fetch("https://api.commandcode.ai/provider/v1/models", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return normalizeModels(extractModelItems(data));
}

function listCliModels(timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(resolveCommandCodeCliBin(), ["--list-models"], {
      shell: false,
      windowsHide: true,
      cwd: os.tmpdir(),
    });

    const finish = (models) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(models);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, timeoutMs);

    child.stdout?.on?.("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on?.("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(parseCliModelOutput(stdout || stderr));
    });
  });
}

function extractModelItems(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
}

function parseCliModelOutput(output) {
  const trimmed = String(output || "").trim();
  if (!trimmed) return [];

  try {
    const json = JSON.parse(trimmed);
    const models = normalizeModels(extractModelItems(json));
    if (models.length) return models;
  } catch {
    // Plain text output is also supported.
  }

  return normalizeModels(trimmed
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .map((line) => line.split(/\s+/)[0])
    .filter((id) => id && !/^model(s)?$/i.test(id) && !/^id$/i.test(id)));
}

function normalizeModels(items) {
  const seen = new Set();
  const models = [];
  for (const item of items || []) {
    const id = typeof item === "string"
      ? item
      : item?.id || item?.model || item?.name || item?.slug;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: typeof item === "object" && item?.displayName ? item.displayName : formatModelName(id),
      contextLength: typeof item === "object" ? item.contextLength || item.context_length || 1000000 : 1000000,
    });
  }
  return models;
}

function formatModelName(id) {
  const last = String(id).split("/").pop() || id;
  return `${last.replace(/[-_]/g, " ")} (Command Code CLI)`;
}
