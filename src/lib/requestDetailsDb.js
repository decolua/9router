// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  saveRequestDetail, getRequestDetails, getRequestDetailsTotals, getRequestDetailById, getDistinctProviders,
} from "@/lib/db/index.js";
