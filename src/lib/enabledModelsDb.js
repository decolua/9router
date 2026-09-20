// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  getEnabledModels, getEnabledByProvider, setEnabledModels,
} from "@/lib/db/index.js";
