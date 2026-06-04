import { getConsistentMachineId } from "./machineId";

// Get machine ID using node-machine-id with salt
export async function getMachineId() {
  return await getConsistentMachineId();
}
