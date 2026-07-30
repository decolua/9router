export default {
  version: 2,
  name: "api-key-policies",
  up(db) {
    const columns = new Set(db.all("PRAGMA table_info(apiKeys)").map((column) => column.name));
    const additions = {
      expiresAt: "TEXT",
      tokenLimit: "INTEGER",
      tokensUsed: "INTEGER NOT NULL DEFAULT 0",
      tokensReserved: "INTEGER NOT NULL DEFAULT 0",
      allowedModels: "TEXT",
    };
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${definition}`);
    }
  },
};
