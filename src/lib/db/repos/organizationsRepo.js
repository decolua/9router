import { v4 as uuidv4 } from "uuid";
import { qAll, qGet, qRun } from "../query.js";
import { getAdapter } from "../driver.js";
import { getMetaSync, setMetaSync } from "../helpers/metaStore.js";

export const DEFAULT_ORG_SLUG = "default";
export const META_DEFAULT_ORG_ID = "defaultOrgId";

function rowToOrg(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status || "active",
    plan: row.plan || "free",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOrganizationById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM organizations WHERE id = ?`, [id]);
  return rowToOrg(row);
}

export async function getOrganizationBySlug(slug) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) return null;
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM organizations WHERE slug = ?`, [normalized]);
  return rowToOrg(row);
}

export async function listOrganizations({ status = "active" } = {}) {
  const db = await getAdapter();
  const rows = await qAll(
    db,
    `SELECT * FROM organizations WHERE status = ? ORDER BY createdAt ASC`,
    [status],
  );
  return rows.map(rowToOrg);
}

export async function isSlugAvailable(slug) {
  const org = await getOrganizationBySlug(slug);
  return !org;
}

export async function getDefaultOrgId() {
  const db = await getAdapter();
  try {
    const fromMeta = getMetaSync(db, META_DEFAULT_ORG_ID, null);
    if (fromMeta) return fromMeta;

    const row = await qGet(db, `SELECT id FROM organizations WHERE slug = ?`, [DEFAULT_ORG_SLUG]);
    if (row?.id) {
      setMetaSync(db, META_DEFAULT_ORG_ID, row.id);
      return row.id;
    }

    const any = await qGet(db, `SELECT id FROM organizations ORDER BY createdAt ASC LIMIT 1`);
    if (any?.id) {
      setMetaSync(db, META_DEFAULT_ORG_ID, any.id);
      return any.id;
    }
  } catch {
    // organizations table may not exist yet during early boot
  }
  return null;
}

export async function createOrganization({ slug, name, plan = "free" }) {
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const db = await getAdapter();
  const existing = await qGet(db, `SELECT id FROM organizations WHERE slug = ?`, [normalizedSlug]);
  if (existing) throw new Error("Organization slug already taken");

  const now = new Date().toISOString();
  const org = {
    id: uuidv4(),
    slug: normalizedSlug,
    name: String(name || normalizedSlug).trim(),
    status: "active",
    plan,
    createdAt: now,
    updatedAt: now,
  };

  await qRun(
    db,
    `INSERT INTO organizations(id, slug, name, status, plan, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [org.id, org.slug, org.name, org.status, org.plan, org.createdAt, org.updatedAt],
  );

  return rowToOrg(org);
}

export function ensureDefaultOrganizationSync(db) {
  const existing = db.get(`SELECT id FROM organizations WHERE slug = ?`, [DEFAULT_ORG_SLUG]);
  if (existing?.id) {
    setMetaSync(db, META_DEFAULT_ORG_ID, existing.id);
    return existing.id;
  }

  const now = new Date().toISOString();
  const id = uuidv4();
  const name = process.env.INSTANCE_NAME || "Default Organization";
  db.run(
    `INSERT INTO organizations(id, slug, name, status, plan, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [id, DEFAULT_ORG_SLUG, name, "active", "free", now, now],
  );
  setMetaSync(db, META_DEFAULT_ORG_ID, id);
  return id;
}
