#!/usr/bin/env node
/**
 * One-time migration script to assign existing data to default user
 * Run with: node scripts/migrate-to-multi-user.js
 */

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import fs from "node:fs";

async function migrateToMultiUser() {
  console.log("Starting migration to multi-user mode...\n");
  
  // Get app name for data directory
  function getAppName() {
    return "egs-proxy-ai";
  }

  // Get user data directory
  function getUserDataDir() {
    if (process.env.DATA_DIR) return process.env.DATA_DIR;
    
    const platform = process.platform;
    const homeDir = require("os").homedir();
    const appName = getAppName();
    
    if (platform === "win32") {
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
    } else {
      return path.join(homeDir, `.${appName}`);
    }
  }

  const DATA_DIR = getUserDataDir();
  const DB_FILE = path.join(DATA_DIR, "db.json");
  
  // Check if DB file exists
  if (!fs.existsSync(DB_FILE)) {
    console.log("No existing database found. Nothing to migrate.");
    return;
  }
  
  // Read existing database
  const adapter = new JSONFile(DB_FILE);
  const db = new Low(adapter);
  await db.read();
  
  // Create default user
  const defaultUser = {
    id: uuidv4(),
    email: process.env.DEFAULT_USER_EMAIL || "admin@egsproxy.local",
    displayName: "Default Admin",
    oauthProvider: null,
    oauthId: null,
    tenantId: null,
    isAdmin: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  
  // Ensure users array exists
  if (!db.data.users) {
    db.data.users = [];
  }
  
  // Add default user if no users exist
  if (db.data.users.length === 0) {
    db.data.users.push(defaultUser);
    console.log(`Created default user: ${defaultUser.email}`);
  }
  
  const defaultUserId = db.data.users[0].id;
  
  // Migrate provider connections
  let migratedConnections = 0;
  if (db.data.providerConnections && Array.isArray(db.data.providerConnections)) {
    for (const conn of db.data.providerConnections) {
      if (!conn.userId) {
        conn.userId = defaultUserId;
        migratedConnections++;
      }
    }
  }
  
  // Migrate API keys
  let migratedKeys = 0;
  if (db.data.apiKeys && Array.isArray(db.data.apiKeys)) {
    for (const key of db.data.apiKeys) {
      if (!key.userId) {
        key.userId = defaultUserId;
        migratedKeys++;
      }
    }
  }
  
  // Migrate combos
  let migratedCombos = 0;
  if (db.data.combos && Array.isArray(db.data.combos)) {
    for (const combo of db.data.combos) {
      if (!combo.userId) {
        combo.userId = defaultUserId;
        migratedCombos++;
      }
    }
  }
  
  // Migrate model aliases (if in object format, convert to array)
  let migratedAliases = 0;
  if (db.data.modelAliases) {
    if (!Array.isArray(db.data.modelAliases)) {
      // Convert object to array
      const oldAliases = db.data.modelAliases;
      db.data.modelAliases = [];
      
      for (const [alias, model] of Object.entries(oldAliases)) {
        db.data.modelAliases.push({
          alias,
          model,
          userId: defaultUserId,
        });
        migratedAliases++;
      }
    } else {
      // Already array format, just add userId if missing
      for (const aliasObj of db.data.modelAliases) {
        if (!aliasObj.userId) {
          aliasObj.userId = defaultUserId;
          migratedAliases++;
        }
      }
    }
  }
  
  // Write changes
  await db.write();
  
  console.log("\n=== Migration Complete ===");
  console.log(`Default user: ${defaultUser.email}`);
  console.log(`Provider connections migrated: ${migratedConnections}`);
  console.log(`API keys migrated: ${migratedKeys}`);
  console.log(`Combos migrated: ${migratedCombos}`);
  console.log(`Model aliases migrated: ${migratedAliases}`);
  console.log("\nAll existing data has been assigned to the default user.");
}

// Run migration
migrateToMultiUser().catch(error => {
  console.error("Migration failed:", error);
  process.exit(1);
});
