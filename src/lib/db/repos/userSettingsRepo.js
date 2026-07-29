import { qGet, qRun } from "../query.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { USER_SETTINGS_KEYS } from "../migrations/003-multi-user.js";

const DEFAULT_USER_SETTINGS = {
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
};

function mergeDefaults(raw) {
  const merged = { ...DEFAULT_USER_SETTINGS, ...(raw || {}) };
  for (const key of USER_SETTINGS_KEYS) {
    if (merged[key] === undefined) merged[key] = DEFAULT_USER_SETTINGS[key];
  }
  return merged;
}

async function readRaw(userId) {
  const db = await getAdapter();
  const row = await qGet(db, `SELECT data FROM userSettings WHERE userId = ?`, [userId]);
  return row ? parseJson(row.data, {}) : {};
}

export async function getUserSettings(userId) {
  if (!userId) return mergeDefaults({});
  return mergeDefaults(await readRaw(userId));
}

const USER_SETTINGS_UPSERT_SQL = `INSERT INTO userSettings(userId, data) VALUES(?, ?) ON CONFLICT(userId) DO UPDATE SET data = excluded.data`;

export async function updateUserSettings(userId, updates) {
  if (!userId) throw new Error("userId is required");
  const db = await getAdapter();
  let next;

  if (db.dialect === "postgres") {
    await db.transaction(async (tx) => {
      const row = await tx.get(`SELECT data FROM userSettings WHERE userId = ?`, [userId]);
      const current = row ? parseJson(row.data, {}) : {};
      next = { ...current, ...updates };
      await tx.run(USER_SETTINGS_UPSERT_SQL, [userId, stringifyJson(next)]);
    });
  } else {
    db.transaction(() => {
      const row = db.get(`SELECT data FROM userSettings WHERE userId = ?`, [userId]);
      const current = row ? parseJson(row.data, {}) : {};
      next = { ...current, ...updates };
      db.run(USER_SETTINGS_UPSERT_SQL, [userId, stringifyJson(next)]);
    });
  }

  return mergeDefaults(next);
}

export async function getEffectiveSettings(userId) {
  const { getSettings } = await import("./settingsRepo.js");
  const org = await getSettings();
  const user = await getUserSettings(userId);
  return { ...org, ...user, _org: org, _user: user };
}
