import { parentPort, workerData } from "node:worker_threads";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { admitKey } from "../../src/lib/db/repos/keyAdmission.js";
const db = await createNodeSqliteAdapter(workerData.file);
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    parentPort.postMessage(Array.from({ length: 10 }, () => admitKey(db, workerData.key, workerData.now).status));
  } finally {
    db.close();
  }
});
