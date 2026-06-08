import { modelRouter } from "@/orchestrator/modelRouter.js";

/**
 * POST /api/orchestrator/roulette
 * Запустить рулетку — пинг всех доступных моделей
 */
export async function POST() {
  try {
    const results = await modelRouter.roulette();
    
    return Response.json({
      success: true,
      ...results
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  } catch (err) {
    console.error("[Roulette] Error:", err);
    return Response.json({
      success: false,
      error: err.message || "Internal server error"
    }, {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }
}

/**
 * GET /api/orchestrator/roulette
 * Получить последние результаты рулетки
 */
export async function GET() {
  try {
    const stats = modelRouter.getStats();
    const uiConfig = modelRouter.getUIConfig();
    
    return Response.json({
      success: true,
      lastRoulette: stats?.lastRoulette || null,
      modelStatus: stats?.modelStatus || {},
      uiConfig: uiConfig || {}
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  } catch (err) {
    console.error("[Roulette] GET Error:", err);
    return Response.json({
      success: false,
      error: err.message || "Failed to get roulette stats"
    }, {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }
}

/**
 * OPTIONS /api/orchestrator/roulette
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}