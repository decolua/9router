import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "../endpoint/EndpointPageClient";

export default async function KeysPage() {
  const machineId = await getMachineId();
  return <EndpointPageClient machineId={machineId} mode="keys" />;
}
