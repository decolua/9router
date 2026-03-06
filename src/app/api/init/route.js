import { ensureAppInitialized } from "@/lib/initCloudSync";

// Initialize at runtime when this API route is called
export async function GET() {
  await ensureAppInitialized();
  return new Response("Initialized", { status: 200 });
}
