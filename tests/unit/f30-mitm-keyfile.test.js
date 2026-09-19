// F30 — T1.3 F-3: MITM sudo password must never be encrypted with the
// predictable fallback key sha256(ENCRYPT_SALT). ENCRYPT_SALT ("9router-mitm-pwd")
// is public — anyone who has the repo (it is open source) holds the attacker key.
//
// Contract under test (src/mitm/manager.js):
//   1. Persistence of the sudo password FAILS with MITM_SUDO_KEY_UNAVAILABLE when
//      the machine id cannot be derived — no ciphertext is written, so
//      GET /api/settings can never emit a key-known blob.
//   2. Happy path (machine id available) keeps working unchanged.
//   3. New blobs carry an origin marker ("v1:" = machine-key derived).
//   4. Pre-F30 unmarked blobs encrypted with the REAL machine key still decode
//      (legitimate installs are not broken).
//   5. Pre-F30 unmarked blobs that fail machine-key auth (i.e. written by the
//      removed predictable fallback) are NOT decrypted and are purged from settings.
import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const MANAGER_PATH = require.resolve("../../src/mitm/manager.js");
// Resolve node-machine-id exactly the way manager.js does, so the stub lands in
// the same require-cache key its lazy `require("node-machine-id")` reads.
const NMI_PATH = createRequire(MANAGER_PATH).resolve("node-machine-id");

// Public constants — an attacker with only the repo knows both.
const SALT = "9router-mitm-pwd";
const TEST_MACHINE_ID = "f30-test-machine-id";

const attackerKey = () => crypto.createHash("sha256").update(SALT).digest();
const machineKey = (id) => crypto.createHash("sha256").update(id + SALT).digest();

// AES-256-GCM in manager.js's blob format (strips the optional "v1:" marker).
function decryptWithKey(stored, key) {
  const payload = stored.startsWith("v1:") ? stored.slice(3) : stored;
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return d.update(Buffer.from(dataHex, "hex")) + d.final("utf8");
}

// Encrypt like the PRE-F30 code did (unmarked iv:tag:data).
function encryptLegacy(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

// Fresh manager module graph with node-machine-id stubbed and DATA_DIR isolated.
function loadManager(machineIdImpl) {
  delete require.cache[MANAGER_PATH];
  require.cache[NMI_PATH] = {
    id: NMI_PATH,
    filename: NMI_PATH,
    loaded: true,
    exports: { machineIdSync: machineIdImpl },
    children: [],
    paths: [],
  };
  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "f30-mitm-"));
  try {
    const manager = require(MANAGER_PATH);
    // settings store shared with the manager through initDbHooks; persisted calls are recorded.
    const store = {};
    const written = [];
    const flush = () => new Promise((r) => setImmediate(r));
    manager.initDbHooks(
      async () => store,
      async (patch) => {
        written.push(patch);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete store[k];
          else store[k] = v;
        }
      }
    );
    return { manager, store, written, flush };
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
  }
}

const brokenMachineId = () => {
  throw new Error("could not get machine id: no /etc/machine-id / dbus");
};

describe("F30 — MITM sudo password key derivation (T1.3 F-3)", () => {
  it("refuses to persist the sudo password when the machine id is unavailable (no key-known ciphertext is emitted)", async () => {
    const { manager, written } = loadManager(brokenMachineId);

    await expect(manager.saveMitmSettings(true, "s3cret-sudo")).rejects.toMatchObject({
      code: "MITM_SUDO_KEY_UNAVAILABLE",
    });
    await expect(
      manager.saveMitmSettings(true, "s3cret-sudo").catch((e) => e)
    ).resolves.toMatchObject({ message: /machine id/i });

    // The "attacker with the repo" test: nothing persisted may be decryptable
    // with the public salt-derived key.
    const blobs = written
      .filter((u) => u && u.mitmSudoEncrypted != null)
      .map((u) => u.mitmSudoEncrypted);
    expect(blobs.length).toBe(0);
    for (const blob of blobs) {
      expect(() => decryptWithKey(blob, attackerKey())).toThrow();
    }
  });

  it("refuses persistence when machineIdSync returns an empty id", async () => {
    const { manager, written } = loadManager(() => "");
    await expect(manager.saveMitmSettings(true, "s3cret-sudo")).rejects.toMatchObject({
      code: "MITM_SUDO_KEY_UNAVAILABLE",
    });
    expect(written.some((u) => u && u.mitmSudoEncrypted != null)).toBe(false);
  });

  it("happy path (machine id available): password round-trips and the attacker key cannot decrypt it", async () => {
    const { manager, store } = loadManager(() => TEST_MACHINE_ID);

    await manager.saveMitmSettings(true, "hunter2");
    expect(typeof store.mitmSudoEncrypted).toBe("string");
    expect(() => decryptWithKey(store.mitmSudoEncrypted, attackerKey())).toThrow();
    expect(await manager.loadEncryptedPassword()).toBe("hunter2");
  });

  it("newly persisted blobs carry the v1 origin marker (machine-key derived)", async () => {
    const { manager, store } = loadManager(() => TEST_MACHINE_ID);
    await manager.saveMitmSettings(true, "hunter2");
    expect(store.mitmSudoEncrypted.startsWith("v1:")).toBe(true);
  });

  it("legacy unmarked blob encrypted with the real machine id still decodes and is NOT purged", async () => {
    const { manager, store, written } = loadManager(() => TEST_MACHINE_ID);
    store.mitmSudoEncrypted = encryptLegacy("legacy-ok", machineKey(TEST_MACHINE_ID));

    expect(await manager.loadEncryptedPassword()).toBe("legacy-ok");
    await new Promise((r) => setImmediate(r));
    expect(written.some((u) => u && "mitmSudoEncrypted" in u && u.mitmSudoEncrypted === null)).toBe(false);
  });

  it("legacy unmarked blob written with the removed predictable fallback is not decrypted and is purged from settings", async () => {
    const { manager, store, written, flush } = loadManager(() => TEST_MACHINE_ID);
    // Ciphertext as the OLD fallback produced it: key = sha256(SALT), unmarked.
    store.mitmSudoEncrypted = encryptLegacy("s3cret-sudo", attackerKey());

    expect(await manager.loadEncryptedPassword()).toBeNull();

    // The exposure must be removed so GET /api/settings stops serving it.
    await flush();
    expect(written.some((u) => u && u.mitmSudoEncrypted === null)).toBe(true);
    expect(store.mitmSudoEncrypted).toBeUndefined();
  });
});
