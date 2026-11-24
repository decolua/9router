import { decryptKey } from "../../src/lib/db/helpers/keyEncryption.js";
import { parentPort, workerData } from "node:worker_threads";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { rotateKey } from "../../src/lib/db/repos/keyRotation.js";

const db = await createNodeSqliteAdapter(workerData.file);
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    let candidate;
    const barrier = new Int32Array(workerData.barrier);
    const connection = {
      ...db,
      get(sql, params) {
        const previous = db.get(sql, params);
        // Both callers must have observed v1 before either attempts its write.
        Atomics.add(barrier, 0, 1);
        Atomics.notify(barrier, 0);
        if (Atomics.wait(barrier, 0, 1, 3000) === "timed-out") throw new Error("rotation barrier");
        return previous;
      },
      run(sql, params) {
        if (sql.startsWith("UPDATE apiKeys")) candidate = decryptKey(db, { id: workerData.id, key_version: workerData.version + 1, key_ciphertext: params[0] });
        return db.run(sql, params);
      },
    };
    const result = rotateKey(connection, workerData.id, workerData.version);
    parentPort.postMessage({ result, candidate });
  } finally {
    db.close();
  }
});
