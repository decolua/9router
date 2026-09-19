export default {
  version: 3,
  name: "drop prd docs",
  up(db) {
    // The document writer is gone; its drafts lived in the shared kv table, so prune that
    // one scope and leave every other scope alone. A database without those rows no-ops.
    try { db.exec("DELETE FROM kv WHERE scope = 'prdDocs'"); } catch {}
  },
};
