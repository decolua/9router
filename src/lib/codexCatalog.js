import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { ALIAS_TO_ID } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const execAsync = promisify(exec);

export async function restartCodexDaemon() {
  try {
    const { stdout } = await execAsync("codex app-server daemon version", {
      timeout: 15000,
      windowsHide: true,
      env: process.env,
    });
    if (!/"status"\s*:\s*"running"/.test(stdout)) return false;
    await execAsync("codex app-server daemon restart", {
      timeout: 30000,
      windowsHide: true,
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

export const CODEX_CATALOG_FILENAME = "9router-models.json";

const positiveInt = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 100000000 ? n : null;
};

export function resolveContextWindow(contextWindow, slug) {
  const explicit = positiveInt(contextWindow);
  if (explicit) return explicit;
  if (typeof slug !== "string" || !slug.includes("/")) return null;
  const slash = slug.indexOf("/");
  const providerId = ALIAS_TO_ID[slug.slice(0, slash)] || slug.slice(0, slash);
  return positiveInt(getCapabilitiesForModel(providerId, slug.slice(slash + 1))?.contextWindow);
}

export async function syncCodexCatalog({ codexDir, models }) {
  const wanted = (models || [])
    .map((m) => ({ slug: m?.slug, contextWindow: positiveInt(m?.contextWindow) }))
    .filter((m) => typeof m.slug === "string" && m.slug && m.contextWindow);
  if (!wanted.length) return null;

  let bundled;
  try {
    const { stdout } = await execAsync("codex debug models", {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20000,
      windowsHide: true,
      env: process.env,
    });
    bundled = JSON.parse(stdout)?.models;
  } catch {
    return null;
  }
  if (!Array.isArray(bundled) || !bundled.length) return null;

  const template = bundled[0];
  const entries = new Map(bundled.map((entry) => [entry.slug, entry]));
  for (const { slug, contextWindow } of wanted) {
    const known = entries.get(slug);
    entries.set(slug, {
      ...(known || template),
      slug,
      display_name: known?.display_name || slug,
      context_window: contextWindow,
      max_context_window: contextWindow,
    });
  }

  const file = path.join(codexDir, CODEX_CATALOG_FILENAME);
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ models: [...entries.values()] }), "utf-8");
  return file;
}