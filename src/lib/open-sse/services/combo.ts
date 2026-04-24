/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback";
import { unavailableResponse } from "../utils/error";

const comboRotationState = new Map<string, number>();

/**
 * Get rotated model list based on strategy
 */
export function getRotatedModels(models: string[], comboName: string, strategy?: string): string[] {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const currentIndex = comboRotationState.get(comboName) || 0;
  const rotatedModels = [...models];
  
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    if (moved) rotatedModels.push(moved);
  }
  
  const nextIndex = (currentIndex + 1) % models.length;
  comboRotationState.set(comboName, nextIndex);
  
  return rotatedModels;
}

/**
 * Get combo models from combos data
 */
export function getComboModelsFromData(modelStr: string, combosData: any): string[] | null {
  if (modelStr.includes("/")) return null;
  
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find((c: any) => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

export interface ComboChatOptions {
  body: any;
  models: string[];
  handleSingleModel: (body: any, modelStr: string) => Promise<Response>;
  log: any;
  comboName?: string;
  comboStrategy?: string;
}

/**
 * Handle combo chat with fallback
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy }: ComboChatOptions): Promise<Response> {
  const rotatedModels = getRotatedModels(models, comboName || "default", comboStrategy);
  
  let lastError: string | null = null;
  let earliestRetryAfter: string | null = null;
  let lastStatus: number | null = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      
      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch { /* ignore */ }

      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error: any) {
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
