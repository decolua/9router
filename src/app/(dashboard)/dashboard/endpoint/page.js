import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./EndpointPageClient";

// VortexRouter — Next standalone endpoint page

export default async function EndpointPage() {
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} />;
}
