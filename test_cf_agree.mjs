import fs from 'fs';

const connectionsFile = './data/connections.json';
const connections = JSON.parse(fs.readFileSync(connectionsFile, 'utf8'));
const cfConnection = connections.find(c => c.provider === 'cloudflare-ai');

if (!cfConnection) {
  console.log("No cloudflare connection found");
  process.exit(1);
}

const accountId = cfConnection.providerSpecificData.accountId;
const apiKey = cfConnection.apiKey;

console.log("Found connection for account:", accountId);

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`;

async function testAgree() {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "agree" }] }),
  });
  const data = await res.json();
  console.log("Agree (messages) response:", JSON.stringify(data, null, 2));
}

async function testAgreePrompt() {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: "agree" }),
  });
  const data = await res.json();
  console.log("Agree (prompt) response:", JSON.stringify(data, null, 2));
}

async function testRun() {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });
  const data = await res.json();
  console.log("Run response:", JSON.stringify(data, null, 2));
}

async function main() {
  await testRun();
  console.log("---");
  await testAgreePrompt();
  console.log("---");
  await testAgree();
  console.log("---");
  await testRun();
}

main();
