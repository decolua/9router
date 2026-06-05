import ConsoleLogClient from "./ConsoleLogClient";
import { EnhancedConsoleLog } from "@/diepxuan/app/dashboard/console-log";

// Force dynamic so Next.js standalone build includes the server-side JS file
export const dynamic = "force-dynamic";

export default function ConsoleLogPage() {
  return <EnhancedConsoleLog />;
}
