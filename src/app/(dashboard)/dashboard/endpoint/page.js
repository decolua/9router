import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./EndpointPageClient";

import { dashboardPageRole } from "@/lib/auth/dashboardPageRole";

export default async function EndpointPage() {
  if (await dashboardPageRole() !== "admin") return null;
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
