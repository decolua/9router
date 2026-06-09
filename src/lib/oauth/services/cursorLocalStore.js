import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export const CURSOR_ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
export const CURSOR_MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];
export const CURSOR_CACHED_EMAIL_KEYS = ["cursorAuth/cachedEmail"];

function normalizeStoredValue(value) {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

/** Candidate state.vscdb paths by platform */
export function getCursorDbCandidatePaths(platform = process.platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
      join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

function queryFirst(db, keys) {
  for (const key of keys) {
    const row = db.prepare("SELECT value FROM itemTable WHERE key=? LIMIT 1").get(key);
    if (row?.value) return normalizeStoredValue(row.value);
  }
  return null;
}

/** Read Cursor auth fields from a known state.vscdb path (sync). */
export function readCursorLocalAuthSync(dbPath) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return {
      accessToken: queryFirst(db, CURSOR_ACCESS_TOKEN_KEYS),
      machineId: queryFirst(db, CURSOR_MACHINE_ID_KEYS),
      cachedEmail: queryFirst(db, CURSOR_CACHED_EMAIL_KEYS),
    };
  } finally {
    db.close();
  }
}

/** Find the first readable Cursor state.vscdb and return stored auth fields. */
export async function findAndReadCursorLocalAuth(platform = process.platform) {
  for (const candidate of getCursorDbCandidatePaths(platform)) {
    try {
      await access(candidate, constants.R_OK);
      return { dbPath: candidate, ...readCursorLocalAuthSync(candidate) };
    } catch {
      // try next candidate
    }
  }
  return null;
}

function isCursorEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAuth0Subject(value) {
  return typeof value === "string" && /^auth0\|user_/i.test(value);
}

export function cursorConnectionNeedsIdentityBackfill(connection) {
  if (connection?.provider !== "cursor") return false;
  if (isCursorEmail(connection.providerSpecificData?.cachedEmail)) return false;
  return isAuth0Subject(connection.email) || isAuth0Subject(connection.name);
}

export async function backfillCursorConnectionIdentity(connection, localAuth = null) {
  if (!cursorConnectionNeedsIdentityBackfill(connection)) return connection;

  const auth = localAuth || await findAndReadCursorLocalAuth();
  if (!isCursorEmail(auth?.cachedEmail)) return connection;

  const { updateProviderConnection } = await import("@/lib/localDb");
  return await updateProviderConnection(connection.id, {
    email: auth.cachedEmail,
    name: auth.cachedEmail,
    providerSpecificData: {
      ...(connection.providerSpecificData || {}),
      cachedEmail: auth.cachedEmail,
    },
  });
}

let cursorBackfillDone = false;

export async function backfillCursorEmails() {
  if (cursorBackfillDone) return;
  cursorBackfillDone = true;
  try {
    const { getProviderConnections } = await import("@/lib/localDb");
    const localAuth = await findAndReadCursorLocalAuth();
    if (!isCursorEmail(localAuth?.cachedEmail)) return;

    const connections = await getProviderConnections({ provider: "cursor" });
    for (const conn of connections) {
      if (!cursorConnectionNeedsIdentityBackfill(conn)) continue;
      await backfillCursorConnectionIdentity(conn, localAuth);
    }
  } catch (err) {
    cursorBackfillDone = false;
    console.log("backfillCursorEmails failed:", err?.message || err);
  }
}
