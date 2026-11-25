import { migrateKeyConnections } from "../repos/keyConnectionsRepo.js";

const migration = {
  version: 11,
  name: "key-connections",
  up: migrateKeyConnections,
};

export default migration;
