// Auto-initialize cloud sync when server starts
import "@/lib/initCloudSync";
import { initScheduler } from "@/lib/tokenScheduler/scheduler";

// Auto-start token scheduler if Antigravity accounts exist
initScheduler().catch(() => {});

// This API route is called automatically to initialize sync
export async function GET() {
  return new Response("Initialized", { status: 200 });
}
