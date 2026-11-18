import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import codex from "../open-sse/providers/registry/codex.js";
import { synthesizeCodexTts } from "../open-sse/handlers/codexTts.js";

const redirect = `http://localhost:${codex.oauth.fixedPort}${codex.oauth.callbackPath}`;
const verifier = randomBytes(32).toString("base64url");
const state = randomBytes(32).toString("base64url");
const url = new URL(codex.oauth.authorizeUrl);
url.search = new URLSearchParams({ response_type: "code", client_id: codex.oauth.clientId, redirect_uri: redirect,
  scope: codex.oauth.scope, code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256", ...codex.oauth.extraParams, state }).toString();
console.log("Open this one-time authorization URL in your browser (do not share it):\n", url.toString());
// ponytail: credentials survive only in this private temporary directory; delete it after debugging.
const directory = await mkdtemp(join(tmpdir(), "9router-TEMP-CODEX-AUTH-"));
console.log(`Temporary credentials will be stored in ${directory} (delete after debugging).`);
const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const rl = createInterface({ input: stdin, output: muted, terminal: true });
try {
  stdout.write("Paste the complete callback URL here (input hidden): ");
  const callback = new URL((await rl.question("Paste the complete callback URL here: ")).trim());
  const returnedState = callback.searchParams.get("state") || "";
  if (callback.origin !== new URL(redirect).origin || callback.pathname !== new URL(redirect).pathname
    || Buffer.byteLength(returnedState) !== Buffer.byteLength(state)
    || !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state)) || !callback.searchParams.get("code")) {
    throw new Error("Invalid callback or OAuth state");
  }
  const response = await fetch(codex.oauth.tokenUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: codex.oauth.clientId,
      code: callback.searchParams.get("code"), redirect_uri: redirect, code_verifier: verifier }) });
  if (!response.ok) throw new Error(`Authorization exchange failed (HTTP ${response.status})`);
  const tokens = await response.json();
  const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
  const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (!accountId || !tokens.access_token) throw new Error("Authorization did not include a Codex account");
  await writeFile(join(directory, "TEMPORARY-SECRET.json"), JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, accountId }), { mode: 0o600, flag: "wx" });
  console.log("Authorized. Testing experimental speech synthesis; this consumes subscription usage.");
  const wav = await synthesizeCodexTts({ input: "Hello, this is a speech test.", voice: "cove",
    credentials: { authType: "oauth", accessToken: tokens.access_token, providerSpecificData: { accountId } } });
  await writeFile("codex-tts-test.wav", wav, { mode: 0o600, flag: "wx" });
  console.log("Saved codex-tts-test.wav");
} catch (error) {
  console.error("Codex test failed:", error.name === "TypeError" ? "Invalid callback or transport error" : error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}