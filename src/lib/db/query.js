// Unified query helpers — SQLite adapters are sync; PostgreSQL returns Promises.

export async function qRun(db, sql, params) {
  const r = db.run(sql, params);
  return r && typeof r.then === "function" ? r : r;
}

export async function qGet(db, sql, params) {
  const r = db.get(sql, params);
  return r && typeof r.then === "function" ? r : r;
}

export async function qAll(db, sql, params) {
  const r = db.all(sql, params);
  return r && typeof r.then === "function" ? r : r;
}

export async function qExec(db, sql) {
  const r = db.exec(sql);
  return r && typeof r.then === "function" ? r : r;
}

export async function qTransaction(db, fn) {
  if (db.dialect === "postgres") {
    return db.transaction(fn);
  }
  return db.transaction(() => fn(db));
}
