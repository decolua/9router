import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const MAX_GROUPS = 100;

export async function getKeyModelGroups() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const settings = row ? parseJson(row.data, {}) : {};
  return Array.isArray(settings.keyModelGroups) ? settings.keyModelGroups : [];
}

export async function changeKeyModelGroup(action, data) {
  const db = await getAdapter();
  let result;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const settings = row ? parseJson(row.data, {}) : {};
    const groups = Array.isArray(settings.keyModelGroups) ? settings.keyModelGroups : [];
    if (action === "create") {
      if (groups.length >= MAX_GROUPS) {
        result = { error: `A maximum of ${MAX_GROUPS} groups is allowed`, status: 400 };
        return;
      }
      result = { group: { id: randomUUID(), name: data.name, allow: data.allow } };
      groups.push(result.group);
    } else {
      const index = groups.findIndex((group) => typeof group?.id === "string" && group.id.toLowerCase() === data.id.toLowerCase());
      if (index === -1) {
        result = { error: "Group not found", status: 404 };
        return;
      }
      if (action === "update") {
        result = { group: { id: groups[index].id, name: data.name, allow: data.allow } };
        groups[index] = result.group;
      } else {
        const reference = `@group/${groups[index].id}`.toLowerCase();
        const referenced = db.all(`SELECT accessAllow FROM apiKeys WHERE accessRestricted = 1`).some((row) => {
          const allow = parseJson(row.accessAllow, []);
          return Array.isArray(allow) && allow.some((entry) => typeof entry === "string" && entry.trim().toLowerCase() === reference);
        });
        if (referenced) {
          result = { error: "Group is referenced by an API key and cannot be deleted", status: 409 };
          return;
        }
        result = { group: groups[index] };
        groups.splice(index, 1);
      }
    }
    settings.keyModelGroups = groups;
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(settings)],
    );
  });
  return result;
}
