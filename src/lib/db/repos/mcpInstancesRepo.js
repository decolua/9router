// Shim: re-exports from the TypeScript implementation.
export {
  getInstances, getInstanceById, getInstanceBySlug, getEnabledInstancesByIds,
  createInstance, updateInstance, deleteInstance,
} from "./mcpInstancesRepo.ts";
