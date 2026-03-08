#!/usr/bin/env node
/**
 * Run PostgreSQL migrations from migrations/ in order.
 * Uses DATABASE_URL from environment (loads .env from project root if present).
 *
 * Usage:
 *   node scripts/db/migrate.js
 *   DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/db/migrate.js
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

import { loadEnv } from "./load-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in .env or the environment.");
  process.exit(1);
}

const projectRoot = resolve(__dirname, "../..");
const migrationsDir = join(projectRoot, "migrations");

if (!existsSync(migrationsDir)) {
  console.error("Migrations directory not found:", migrationsDir);
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No .sql migration files found in", migrationsDir);
  process.exit(0);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function run() {
  try {
    await client.connect();
    console.log("Connected to database.");

    for (const file of files) {
      const path = join(migrationsDir, file);
      const sql = readFileSync(path, "utf8");
      process.stdout.write(`Running ${file} ... `);
      await client.query(sql);
      console.log("OK");
    }

    console.log(`Done. Ran ${files.length} migration(s).`);
  } catch (err) {
    console.error("\nMigration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
