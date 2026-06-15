#!/usr/bin/env node
/**
 * Reset admin@local password to INITIAL_PASSWORD (or --password flag).
 * Usage: node scripts/reset-admin-password.mjs [--password newpass]
 */
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import pg from "pg";
import { toPgParams } from "../src/lib/db/dialect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const password = process.argv.includes("--password")
  ? process.argv[process.argv.indexOf("--password") + 1]
  : (process.env.INITIAL_PASSWORD || "123456");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env or the environment.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const find = toPgParams(`SELECT id FROM users WHERE email = ?`, ["admin@local"]);
  const found = await pool.query(find.sql, find.params);
  if (!found.rows[0]) {
    console.error("No admin@local user found. Run the app once to apply migrations.");
    process.exit(1);
  }

  const update = toPgParams(
    `UPDATE users SET passwordHash = ?, status = 'active', updatedAt = ? WHERE email = ?`,
    [hash, new Date().toISOString(), "admin@local"]
  );
  await pool.query(update.sql, update.params);

  console.log("Admin password reset.");
  console.log("  Email:    admin@local");
  console.log("  Password:", password);
  console.log("  Database: postgres");
} finally {
  await pool.end();
}
