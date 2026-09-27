import { editImage } from "@/sse/handlers/nanExtra.js";

export async function POST(request) { return editImage(request); }
export async function OPTIONS() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" } });
}
