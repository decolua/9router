import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// --- CodeBuddy Accounts ---

export async function listCodeBuddyAccounts() {
  const db = await getAdapter();
  return db.all("SELECT * FROM codebuddyAccounts ORDER BY id DESC");
}

export async function getCodeBuddyAccount(id) {
  const db = await getAdapter();
  return db.get("SELECT * FROM codebuddyAccounts WHERE id = ?", [id]);
}

export async function insertCodeBuddyAccount(email, password, profileDir, signupMethod = "google", ammailAlias = "", provider = "codebuddy") {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let resultId;

  db.transaction(() => {
    db.run(
      `INSERT INTO codebuddyAccounts (email, password, profileDir, signupMethod, ammailAlias, provider, apiKeyStatus, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [email, password, profileDir, signupMethod, ammailAlias, provider, now]
    );
    const row = db.get("SELECT last_insert_rowid() as id");
    resultId = row ? row.id : null;
  });

  return resultId;
}

export async function bulkDeleteCodeBuddyAccounts(statuses, provider = null) {
  const db = await getAdapter();
  if (!statuses || statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(",");
  
  let deletedRows = [];
  db.transaction(() => {
    let selectQuery = `SELECT * FROM codebuddyAccounts WHERE apiKeyStatus IN (${placeholders})`;
    let params = [...statuses];
    if (provider) {
      if (provider === "codebuddy") {
        selectQuery += ` AND (provider = ? OR provider IS NULL OR provider = '')`;
      } else {
        selectQuery += ` AND provider = ?`;
      }
      params.push(provider);
    }
    deletedRows = db.all(selectQuery, params);
    
    if (deletedRows.length > 0) {
      const idsPlaceholders = deletedRows.map(() => "?").join(",");
      const ids = deletedRows.map(r => r.id);
      db.run(`DELETE FROM codebuddyAccounts WHERE id IN (${idsPlaceholders})`, ids);
    }
  });

  return deletedRows;
}

export async function deleteCodeBuddyAccount(id) {
  const db = await getAdapter();
  let account = null;
  db.transaction(() => {
    account = db.get("SELECT * FROM codebuddyAccounts WHERE id = ?", [id]);
    if (account) {
      db.run("DELETE FROM codebuddyAccounts WHERE id = ?", [id]);
    }
  });
  return account;
}

export async function markCodeBuddyRunning(id) {
  const db = await getAdapter();
  const now = Math.floor(Date.now() / 1000);
  db.run("UPDATE codebuddyAccounts SET apiKeyStatus = 'running', lastRunAt = ?, lastError = '' WHERE id = ?", [now, id]);
}

export async function markCodeBuddySuccess(id, apiKey) {
  const db = await getAdapter();
  db.run("UPDATE codebuddyAccounts SET apiKeyStatus = 'ready', apiKey = ?, lastError = '' WHERE id = ?", [apiKey, id]);
}

export async function markCodeBuddyError(id, lastError) {
  const db = await getAdapter();
  db.run("UPDATE codebuddyAccounts SET apiKeyStatus = 'failed', lastError = ? WHERE id = ?", [lastError, id]);
}

export async function markCanvaEnrolled(id, value = 1) {
  const db = await getAdapter();
  db.run("UPDATE codebuddyAccounts SET canvaEnrolled = ?, apiKeyStatus = 'enrolled_canva', lastError = '' WHERE id = ?", [value, id]);
}

// --- CodeBuddy Jobs ---

export async function createCodeBuddyJob(id, type, count) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const nowUnix = Math.floor(Date.now() / 1000);
  db.run(
    `INSERT INTO codebuddyJobs (id, type, status, count, completed, success, failed, progress, resultsJson, createdAt, startedAt)
     VALUES (?, ?, 'running', ?, 0, 0, 0, 0, '[]', ?, ?)`,
    [id, type, count, now, nowUnix]
  );
}

export async function getCodeBuddyJob(id) {
  const db = await getAdapter();
  const row = db.get("SELECT * FROM codebuddyJobs WHERE id = ?", [id]);
  if (!row) return null;
  return {
    ...row,
    results: parseJson(row.resultsJson, []),
  };
}

export async function updateCodeBuddyJobStatus(id, status) {
  const db = await getAdapter();
  const nowUnix = Math.floor(Date.now() / 1000);
  db.run("UPDATE codebuddyJobs SET status = ?, finishedAt = ? WHERE id = ?", [status, nowUnix, id]);
}

export async function updateCodeBuddyJobResult(jobId, idx, result) {
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get("SELECT resultsJson, count FROM codebuddyJobs WHERE id = ?", [jobId]);
    if (!row) return;

    const results = parseJson(row.resultsJson, []);
    results[idx] = result;

    let completed = 0;
    let success = 0;
    let failed = 0;

    for (const r of results) {
      if (!r) continue;
      if (r.status === "done" || r.status === "failed") {
        completed += 1;
        if (r.ok) {
          success += 1;
        } else {
          failed += 1;
        }
      }
    }

    const count = row.count || 1;
    const progress = Math.min(100, Math.floor((completed / count) * 100));

    db.run(
      `UPDATE codebuddyJobs SET resultsJson = ?, completed = ?, success = ?, failed = ?, progress = ? WHERE id = ?`,
      [stringifyJson(results), completed, success, failed, progress, jobId]
    );
  });
}

// --- Ammail received OTPs ---

export async function insertAmmailOtp(data) {
  const db = await getAdapter();
  const receivedAt = Math.floor(Date.now() / 1000);
  db.run(
    `INSERT INTO ammailOtps (address, alias, domain, sender, subject, otpCode, verifyUrl, bodyText, bodyHtml, messageShortId, rawEventJson, receivedAt, usedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      data.address,
      data.alias,
      data.domain || "",
      data.sender || "",
      data.subject || "",
      data.otpCode || "",
      data.verifyUrl || "",
      data.bodyText || "",
      data.bodyHtml || "",
      data.messageShortId || "",
      data.rawEventJson || "",
      receivedAt,
    ]
  );
}

export async function findLatestAmmailOtp(address, sinceTs = 0, onlyUnused = true) {
  const db = await getAdapter();
  const where = ["address = ?", "receivedAt >= ?"];
  const params = [address.toLowerCase(), sinceTs];

  if (onlyUnused) {
    where.push("usedAt = 0");
  }

  const sql = `SELECT * FROM ammailOtps WHERE ${where.join(" AND ")} ORDER BY receivedAt DESC LIMIT 1`;
  return db.get(sql, params);
}

export async function markAmmailOtpUsed(id) {
  const db = await getAdapter();
  const nowUnix = Math.floor(Date.now() / 1000);
  db.run("UPDATE ammailOtps SET usedAt = ? WHERE id = ?", [nowUnix, id]);
}

export async function listAmmailOtps(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];

  if (filter.address) {
    where.push("LOWER(address) = ?");
    params.push(filter.address.toLowerCase());
  }

  if (filter.folder === "unread") {
    where.push("usedAt = 0");
  } else if (filter.folder === "read") {
    where.push("usedAt > 0");
  } else if (filter.folder === "otp") {
    where.push("otpCode IS NOT NULL AND otpCode != ''");
  }

  const sql = `SELECT * FROM ammailOtps ${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY receivedAt DESC`;
  return db.all(sql, params);
}

export async function getAmmailOtp(id) {
  const db = await getAdapter();
  return db.get("SELECT * FROM ammailOtps WHERE id = ?", [id]);
}

export async function deleteAmmailOtp(id) {
  const db = await getAdapter();
  db.run("DELETE FROM ammailOtps WHERE id = ?", [id]);
}

export async function deleteAmmailOtpsBulk(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];

  if (filter.address) {
    where.push("LOWER(address) = ?");
    params.push(filter.address.toLowerCase());
  }

  if (filter.alias) {
    where.push("LOWER(alias) = ?");
    params.push(filter.alias.toLowerCase());
  }

  if (filter.folder === "unread") {
    where.push("usedAt = 0");
  } else if (filter.folder === "read") {
    where.push("usedAt > 0");
  } else if (filter.folder === "otp") {
    where.push("otpCode IS NOT NULL AND otpCode != ''");
  }

  const sql = `DELETE FROM ammailOtps${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  db.run(sql, params);
}
