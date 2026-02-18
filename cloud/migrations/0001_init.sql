-- Migration: Create machines table
CREATE TABLE IF NOT EXISTS machines (
  machineId TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_machines_updatedAt ON machines(updatedAt);
