import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./endpoint/EndpointPageClient";

export default async function DashboardPage() {
  const machineId = await getMachineId();
  return (
    <div className="mx-auto w-full max-w-screen-2xl min-w-0 px-0 sm:px-2 lg:px-4">
      <EndpointPageClient machineId={machineId} />
    </div>
  );
}
