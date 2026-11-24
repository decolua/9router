import { parentPort, workerData } from "node:worker_threads";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { reserveBudget } from "../../src/lib/db/repos/budgetLedger.js";
const db = await createNodeSqliteAdapter(workerData.file);
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    parentPort.postMessage(Array.from({ length: 8 }, (_, n) =>
      reserveBudget(db, workerData.index + ":" + n, "key-id", workerData.policy, 5, workerData.now).status));
  } finally { db.close(); }
});
