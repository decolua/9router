/**
 * Import Jobs Self-Check Test
 *
 * Verifies that a background database import job (createImportJob +
 * importDbProgressive) restores a combo payload end to end.
 *
 * Run with: node src/lib/db/importJobsSelfCheck.mjs
 */

import { createImportJob, getImportJob } from "./importJobs.js";
import { initDb, getCombos, getComboByName, deleteCombo } from "./index.js";

const TEST_COMBO_NAME = "__import_jobs_selfcheck__";
const POLL_INTERVAL_MS = 100;
const TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  const combos = await getCombos();
  for (const c of combos) {
    if (c.name === TEST_COMBO_NAME) {
      await deleteCombo(c.id);
    }
  }
}

async function waitForDone(jobId) {
  const startedAt = Date.now();
  for (;;) {
    const job = getImportJob(jobId);
    if (!job) {
      console.error("FAIL: job disappeared while polling");
      process.exit(1);
    }
    if (job.status === "done") return job;
    if (job.status === "error") {
      console.error("FAIL: import job failed:", job.error || job.message);
      process.exit(1);
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      console.error("FAIL: timed out waiting for import job");
      process.exit(1);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function run() {
  await initDb();
  await cleanup();

  const payload = {
    combos: [
      {
        id: "selfcheck-combo-id",
        name: TEST_COMBO_NAME,
        kind: "custom",
        models: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  const { jobId, status } = createImportJob(payload);
  console.log("Created import job:", jobId, status);
  if (!jobId) {
    console.error("FAIL: createImportJob did not return a job id");
    process.exit(1);
  }

  const job = await waitForDone(jobId);
  console.log("Job finished:", job.status, job.progress?.percent, job.message);

  const combo = await getComboByName(TEST_COMBO_NAME);
  if (!combo) {
    console.error("FAIL: combo not found after background import");
    process.exit(1);
  }
  console.log("Combo landed after background import:", combo.id, combo.name);

  await cleanup();
  console.log("SUCCESS: background import job restores combos");
}

run().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
