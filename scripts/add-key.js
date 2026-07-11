const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(process.env.APPDATA, '9router', 'db', 'data.sqlite');
const db = new Database(dbPath);

const apiKey = process.env.API_KEY || 'sk-placeholder-replace-me';

// Check if key exists
const existing = db.prepare('SELECT key, isActive FROM apiKeys WHERE key = ?').get(apiKey);
if (existing) {
  console.log('Key already exists, isActive:', existing.isActive);
} else {
  const rawMachineId = require('fs').readFileSync(
    path.join(process.env.APPDATA, '9router', 'machine-id'), 'utf8'
  ).trim();
  
  db.run(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`, [
    uuidv4(),
    apiKey,
    'openclaw',
    rawMachineId,
    1,
    new Date().toISOString()
  ]);
  console.log('Key inserted into database');
}

const keys = db.prepare('SELECT key, name, isActive FROM apiKeys').all();
console.log('All keys:', JSON.stringify(keys, null, 2));
db.close();
