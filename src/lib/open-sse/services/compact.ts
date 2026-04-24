/**
 * Shared combo (model combo) handling with fallback support (Compact version)
 */

export interface CompactComboOptions {
  body: any;
  models: string[];
  handleSingleModel: (body: any, modelStr: string) => Promise<Response>;
  log: any;
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

/**
 * Handle combo chat with fallback
 */
export async function handleComboChat({ body, models, handleSingleModel, log }: CompactComboOptions): Promise<Response> {
  let lastError: string | null = null;

  for (let i = 0; i < models.length; i++) {
    const modelStr = models[i];
    log.info("COMBO", `Trying model ${i + 1}/${models.length}: ${modelStr}`);

    let result: Response;
    try {
      result = await handleSingleModel(body, modelStr);
    } catch (e: any) {
      lastError = `${modelStr}: ${e.message}`;
      log.warn("COMBO", `Model threw exception, trying next`, { model: modelStr, error: e.message });
      continue;
    }

    if (result.ok || result.status < 500) {
      return result;
    }

    lastError = `${modelStr}: ${result.statusText || result.status}`;
    log.warn("COMBO", `Model failed, trying next`, { model: modelStr, status: result.status });
  }

  log.warn("COMBO", "All models failed");
  
  return new Response(
    JSON.stringify({ error: lastError || "All combo models unavailable" }),
    { 
      status: 503, 
      headers: { "Content-Type": "application/json" }
    }
  );
}
