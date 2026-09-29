// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  saveRequestDetail, flushRequestDetails, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "@/lib/db/index.js";
