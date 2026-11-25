import { dashboardPageRole } from "@/lib/auth/dashboardPageRole";
import { getMachineId } from "@/shared/utils/machine";
import CLIToolsPageClient from "./CLIToolsPageClient";

export default async function CLIToolsPage() {
  if (await dashboardPageRole() !== "admin") return null;
  const machineId = await getMachineId();
  return <CLIToolsPageClient machineId={machineId} />;
}
