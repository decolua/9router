import ConsoleLogClient from "./ConsoleLogClient";
import { dashboardPageRole } from "@/lib/auth/dashboardPageRole";

// Force dynamic so Next.js standalone build includes the server-side JS file
export const dynamic = "force-dynamic";

export default async function ConsoleLogPage() {
  if (await dashboardPageRole() !== "admin") return null;
  return <ConsoleLogClient />;
}
