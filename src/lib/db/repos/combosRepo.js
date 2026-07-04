import { qAll, qGet, qRun } from "../query.js";

import { v4 as uuidv4 } from "uuid";

import { getAdapter } from "../driver.js";

import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

import { getRuntimeUserId } from "../../auth/runtimeUserContext.js";

import { resolveOrgId, tenantFilters } from "../helpers/orgScope.js";



function rowToCombo(row) {

  if (!row) return null;

  return {

    id: row.id,

    orgId: row.orgId || null,

    userId: row.userId || null,

    name: row.name,

    kind: row.kind,

    models: parseJson(row.models, []),

    createdAt: row.createdAt,

    updatedAt: row.updatedAt,

  };

}



export async function getCombos(userId, orgId) {

  const db = await getAdapter();

  const { conds, params } = await tenantFilters({ orgId, userId: userId || getRuntimeUserId() });

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await qAll(db, `SELECT * FROM combos ${where} ORDER BY createdAt ASC`, params);

  return rows.map(rowToCombo);

}



export async function getComboById(id, userId = null, orgId = null) {

  const db = await getAdapter();

  const { conds, params } = await tenantFilters({ orgId, userId });

  conds.push("id = ?");

  params.push(id);

  const row = await qGet(db, `SELECT * FROM combos WHERE ${conds.join(" AND ")}`, params);

  return rowToCombo(row);

}



export async function getComboByName(name, userId, orgId) {

  const db = await getAdapter();

  const { conds, params } = await tenantFilters({ orgId, userId });

  conds.push("name = ?");

  params.push(name);

  const row = await qGet(db, `SELECT * FROM combos WHERE ${conds.join(" AND ")}`, params);

  return rowToCombo(row);

}



export async function createCombo(data) {

  const userId = data.userId || getRuntimeUserId();

  const orgId = await resolveOrgId(data.orgId);

  if (!userId) throw new Error("userId is required");

  if (!orgId) throw new Error("orgId is required");



  const db = await getAdapter();

  const now = new Date().toISOString();

  const combo = {

    id: uuidv4(),

    orgId,

    userId,

    name: data.name,

    kind: data.kind || null,

    models: data.models || [],

    createdAt: now,

    updatedAt: now,

  };

  await qRun(

    db,

    `INSERT INTO combos(id, orgId, userId, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,

    [combo.id, combo.orgId, combo.userId, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt],

  );

  return combo;

}



export async function updateCombo(id, data, userId = null, orgId = null) {

  const db = await getAdapter();

  const scopedUser = userId || getRuntimeUserId() || null;

  const { conds, params } = await tenantFilters({ orgId, userId: scopedUser });

  conds.push("id = ?");

  params.push(id);

  const now = new Date().toISOString();



  if (db.dialect === "postgres") {

    let result = null;

    await db.transaction(async (tx) => {

      const row = await tx.get(`SELECT * FROM combos WHERE ${conds.join(" AND ")}`, params);

      if (!row) return;

      const merged = { ...rowToCombo(row), ...data, updatedAt: now };

      await tx.run(

        `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,

        [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id],

      );

      result = merged;

    });

    return result;

  }



  let result = null;

  db.transaction(() => {

    const row = db.get(`SELECT * FROM combos WHERE ${conds.join(" AND ")}`, params);

    if (!row) return;

    const merged = { ...rowToCombo(row), ...data, updatedAt: now };

    db.run(

      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,

      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id],

    );

    result = merged;

  });

  return result;

}



export async function deleteCombo(id, userId = null, orgId = null) {

  const db = await getAdapter();

  const { conds, params } = await tenantFilters({ orgId, userId });

  conds.push("id = ?");

  params.push(id);

  const res = await qRun(db, `DELETE FROM combos WHERE ${conds.join(" AND ")}`, params);

  return (res?.changes ?? 0) > 0;

}

