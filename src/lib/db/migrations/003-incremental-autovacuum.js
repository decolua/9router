// 003: enable incremental auto_vacuum so the retention job can hand freed
// pages back to the OS as raw usage rows age out, instead of letting the
// file sit at its high-water mark forever. auto_vacuum only takes effect
// after a VACUUM, hence the rewrite here. Runs once while the DB is still
// small — safe at boot before traffic, and VACUUM cannot run inside a
// transaction, so this migration opts out of the transactional wrapper.
const migration = {
  version: 3,
  name: "incremental-autovacuum",
  transactional: false,
  up(db) {
    db.exec(`PRAGMA auto_vacuum = incremental`);
    db.exec(`VACUUM`);
  },
};

export default migration;
