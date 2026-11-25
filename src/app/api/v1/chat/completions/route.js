import { chatInferenceRoute } from "@/sse/handlers/budgetInference.js";
import { BUDGET_ENDPOINT } from "@/shared/utils/keyBudget.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export const POST = chatInferenceRoute(BUDGET_ENDPOINT.CHAT);
