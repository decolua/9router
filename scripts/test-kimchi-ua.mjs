import http from "node:http";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:20127";
const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const dataDir = process.env.DATA_DIR || path.join(APPDATA, "9router");
const DB_PATH = path.join(dataDir, "db", "data.sqlite");
const MOCK_PORT = 20128;
const TEMP_CONN_ID = "test-kimchi-ua-temp";

async function getCliToken() {
  const machineIdFile = path.join(dataDir, "machine-id");
  const cliSecretFile = path.join(dataDir, "auth", "cli-secret");
  
  let rawMachineId;
  try {
    rawMachineId = fs.readFileSync(machineIdFile, "utf8").trim();
  } catch (e) {
    console.error(`Failed to read machine-id file: ${machineIdFile}. Error: ${e.message}`);
    throw e;
  }
  
  let cliSecret;
  try {
    cliSecret = fs.readFileSync(cliSecretFile, "utf8").trim();
  } catch (e) {
    console.error(`Failed to read cli-secret file: ${cliSecretFile}. Error: ${e.message}`);
    throw e;
  }
  
  const saltValue = "9r-cli-auth";
  return crypto.createHash("sha256")
    .update(rawMachineId + saltValue + cliSecret)
    .digest("hex")
    .substring(0, 16);
}

async function main() {
  console.log("=== Starting Kimchi User-Agent E2E Verification ===");

  // 1. Start a local mock server on port 20128
  let receivedUA = null;
  let receivedPath = null;

  const mockServer = http.createServer((req, res) => {
    receivedUA = req.headers["user-agent"] || req.headers["User-Agent"];
    receivedPath = req.url;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [] }));
  });

  await new Promise((resolve) => mockServer.listen(MOCK_PORT, "127.0.0.1", resolve));
  console.log(`Mock server listening on http://127.0.0.1:${MOCK_PORT}`);

  // 2. Insert the temporary connection into SQLite database
  const db = new Database(DB_PATH);
  console.log(`Connected to SQLite DB at: ${DB_PATH}`);

  // Cleanup any leftover first
  db.prepare("DELETE FROM providerConnections WHERE id = ?").run(TEMP_CONN_ID);

  const connectionData = {
    accessToken: "test-oauth-token-val",
    providerSpecificData: {
      kimchiEndpoint: `http://127.0.0.1:${MOCK_PORT}`
    }
  };

  db.prepare(`
    INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
    VALUES(?, 'kimchi', 'oauth', 'Test Kimchi UA', 'test-ua@example.com', 999, 1, ?, datetime('now'), datetime('now'))
  `).run(TEMP_CONN_ID, JSON.stringify(connectionData));
  console.log(`Inserted temporary connection: ${TEMP_CONN_ID}`);

  // 3. Make request to localhost:20127 to trigger model list resolution
  console.log(`Requesting model resolution from running 9router server: ${BASE_URL}`);
  try {
    const cliToken = await getCliToken();
    console.log(`Bypassing auth using CLI token: ${cliToken}`);
    const response = await fetch(`${BASE_URL}/api/providers/${TEMP_CONN_ID}/models`, {
      headers: {
        "x-9r-cli-token": cliToken
      }
    });
    const resultText = await response.text();
    console.log(`9router response status: ${response.status}`);
    console.log(`9router response body: ${resultText}`);
  } catch (error) {
    console.error("Failed to connect to 9router server on port 20127:", error.message);
    console.log("Make sure the 9router server is running on port 20127 before executing this test.");
  } finally {
    // 4. Cleanup temporary connection from database
    db.prepare("DELETE FROM providerConnections WHERE id = ?").run(TEMP_CONN_ID);
    console.log(`Cleaned up temporary connection: ${TEMP_CONN_ID}`);
    db.close();

    // 5. Close mock server
    mockServer.close();
  }

  // 6. Analyze results
  if (receivedUA) {
    console.log("\n--- TEST RESULTS ---");
    console.log(`Received request path: ${receivedPath}`);
    console.log(`Received User-Agent:   "${receivedUA}"`);

    const isMatch = /^kimchi\/\d+\.\d+\.\d+/.test(receivedUA);
    if (isMatch) {
      console.log("✅ SUCCESS: User-Agent format matches 'kimchi/x.y.z'");
    } else {
      console.log("❌ FAILURE: User-Agent format does not match 'kimchi/x.y.z'");
    }

    // Compare with GitHub's latest release tag
    console.log("\nFetching latest tag from GitHub to verify dynamic detection...");
    try {
      const ghRes = await fetch("https://api.github.com/repos/getkimchi/kimchi/releases/latest", {
        headers: {
          "Accept": "application/vnd.github+json",
          "User-Agent": "9router-test-agent"
        }
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        const latestTag = ghData.tag_name ? ghData.tag_name.replace(/^v/, "") : "";
        if (latestTag) {
          console.log(`Latest GitHub release version:  ${latestTag}`);
          const expectedUA = `kimchi/${latestTag}`;
          if (receivedUA === expectedUA) {
            console.log(`✅ SUCCESS: Dynamic autodetection worked! Received the latest version: "${receivedUA}"`);
          } else {
            console.log(`ℹ️ INFO: Server sent "${receivedUA}", which differs from latest GitHub version "${expectedUA}".`);
            console.log("This can happen if the server's GitHub API request timed out, failed, or hit rate-limits (which falls back to the hardcoded/cached version).");
          }
        } else {
          console.log("Could not parse version tag from GitHub response.");
        }
      } else {
        console.log(`Failed to fetch from GitHub: ${ghRes.status} ${ghRes.statusText}`);
      }
    } catch (e) {
      console.log("Error querying GitHub API:", e.message);
    }
  } else {
    console.log("\n❌ FAILURE: Mock server did not receive any request from the 9router server.");
    console.log("Please verify that the 9router server on port 20127 is active and has resolved the database path correctly.");
  }
}

main().catch((err) => {
  console.error("Test script error:", err);
  process.exit(1);
});
