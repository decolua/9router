import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToGroup(row) {
	if (!row) return null;
	let allowedConnectionIds = [];
	try {
		allowedConnectionIds = JSON.parse(row.allowedConnectionIds || "[]");
	} catch {}
	return {
		id: row.id,
		name: row.name,
		description: row.description || null,
		allowedConnectionIds,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function getKeyGroups() {
	const db = await getAdapter();
	const rows = db.all(`SELECT * FROM keyGroups ORDER BY createdAt ASC`);
	return rows.map(rowToGroup);
}

export async function getKeyGroupById(id) {
	const db = await getAdapter();
	const row = db.get(`SELECT * FROM keyGroups WHERE id = ?`, [id]);
	return rowToGroup(row);
}

export async function createKeyGroup(data) {
	const db = await getAdapter();
	const now = new Date().toISOString();
	const group = {
		id: uuidv4(),
		name: data.name,
		description: data.description || null,
		allowedConnectionIds: JSON.stringify(data.allowedConnectionIds || []),
		createdAt: now,
		updatedAt: now,
	};
	db.run(
		`INSERT INTO keyGroups(id, name, description, allowedConnectionIds, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
		[
			group.id,
			group.name,
			group.description,
			group.allowedConnectionIds,
			group.createdAt,
			group.updatedAt,
		],
	);
	return rowToGroup({
		...group,
		allowedConnectionIds: group.allowedConnectionIds,
	});
}

export async function updateKeyGroup(id, data) {
	const db = await getAdapter();
	let result = null;
	db.transaction(() => {
		const row = db.get(`SELECT * FROM keyGroups WHERE id = ?`, [id]);
		if (!row) return;
		const merged = {
			name: data.name ?? row.name,
			description:
				data.description !== undefined ? data.description : row.description,
			allowedConnectionIds:
				data.allowedConnectionIds !== undefined
					? JSON.stringify(data.allowedConnectionIds)
					: row.allowedConnectionIds,
			updatedAt: new Date().toISOString(),
		};
		db.run(
			`UPDATE keyGroups SET name = ?, description = ?, allowedConnectionIds = ?, updatedAt = ? WHERE id = ?`,
			[
				merged.name,
				merged.description,
				merged.allowedConnectionIds,
				merged.updatedAt,
				id,
			],
		);
		result = rowToGroup({ ...row, ...merged });
	});
	return result;
}

export async function deleteKeyGroup(id) {
	const db = await getAdapter();
	const res = db.run(`DELETE FROM keyGroups WHERE id = ?`, [id]);
	return (res?.changes ?? 0) > 0;
}
