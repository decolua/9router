import { managementSpec } from "@/lib/openapi/managementSpec.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/openapi.json — public (no key). Live OpenAPI 3.1 spec.
export async function GET() {
  return new Response(JSON.stringify(managementSpec, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
