export default {
  version: 2,
  name: "drop budget groups",
  up(db) {
    try { db.exec("DROP TABLE IF EXISTS budgetGroups"); } catch {}
    // budgetGroupId column left in apiKeys — harmless, additive sync won't recreate it
  },
};
