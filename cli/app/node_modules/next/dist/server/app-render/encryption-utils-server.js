// This file should never be bundled into application's runtime code and should
// stay in the Next.js server.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "generateEncryptionKeyBase64", {
    enumerable: true,
    get: function() {
        return generateEncryptionKeyBase64;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _cachedir = require("../cache-dir");
const _encryptionutils = require("./encryption-utils");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Keep the key in memory as it should never change during the lifetime of the server in
// both development and production.
let __next_encryption_key_generation_promise = null;
const CONFIG_FILE = '.rscinfo';
const ENCRYPTION_KEY = 'encryption.key';
const ENCRYPTION_EXPIRE_AT = 'encryption.expire_at';
const EXPIRATION = 1000 * 60 * 60 * 24 * 14 // 14 days
;
async function writeCache(distDir, configValue) {
    const cacheBaseDir = (0, _cachedir.getStorageDirectory)(distDir);
    if (!cacheBaseDir) return;
    const configPath = _path.default.join(cacheBaseDir, CONFIG_FILE);
    if (!_fs.default.existsSync(cacheBaseDir)) {
        await _fs.default.promises.mkdir(cacheBaseDir, {
            recursive: true
        });
    }
    await _fs.default.promises.writeFile(configPath, JSON.stringify({
        [ENCRYPTION_KEY]: configValue,
        [ENCRYPTION_EXPIRE_AT]: Date.now() + EXPIRATION
    }));
}
// This utility is used to get a key for the cache directory. If the
// key is not present, it will generate a new one and store it in the
// cache directory inside dist.
// The key will also expire after a certain amount of time. Once it
// expires, a new one will be generated.
// During the lifetime of the server, it will be reused and never refreshed.
async function loadOrGenerateKey(distDir, isBuild, generateKey) {
    const cacheBaseDir = (0, _cachedir.getStorageDirectory)(distDir);
    if (!cacheBaseDir) {
        // There's no persistent storage available. We generate a new key.
        // This also covers development time.
        return await generateKey();
    }
    const configPath = _path.default.join(cacheBaseDir, CONFIG_FILE);
    async function hasCachedKey() {
        if (!_fs.default.existsSync(configPath)) return false;
        try {
            const config = JSON.parse(await _fs.default.promises.readFile(configPath, 'utf8'));
            if (!config) return false;
            if (typeof config[ENCRYPTION_KEY] !== 'string' || typeof config[ENCRYPTION_EXPIRE_AT] !== 'number') {
                return false;
            }
            // For build time, we need to rotate the key if it's expired. Otherwise
            // (next start) we have to keep the key as it is so the runtime key matches
            // the build time key.
            if (isBuild && config[ENCRYPTION_EXPIRE_AT] < Date.now()) {
                return false;
            }
            const cachedKey = config[ENCRYPTION_KEY];
            // If encryption key is provided via env, and it's not same as valid cache,
            //  we should not use the cached key and respect the env key.
            if (cachedKey && process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY && cachedKey !== process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) {
                return false;
            }
            return cachedKey;
        } catch  {
            // Broken config file. We should generate a new key and overwrite it.
            return false;
        }
    }
    const maybeValidKey = await hasCachedKey();
    if (typeof maybeValidKey === 'string') {
        return maybeValidKey;
    }
    const key = await generateKey();
    await writeCache(distDir, key);
    return key;
}
async function generateEncryptionKeyBase64({ isBuild, distDir }) {
    // This avoids it being generated multiple times in parallel.
    if (!__next_encryption_key_generation_promise) {
        __next_encryption_key_generation_promise = loadOrGenerateKey(distDir, isBuild, async ()=>{
            const providedKey = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
            if (providedKey) {
                return providedKey;
            }
            const key = await crypto.subtle.generateKey({
                name: 'AES-GCM',
                length: 256
            }, true, [
                'encrypt',
                'decrypt'
            ]);
            const exported = await crypto.subtle.exportKey('raw', key);
            return btoa((0, _encryptionutils.arrayBufferToString)(exported));
        });
    }
    return __next_encryption_key_generation_promise;
}

//# sourceMappingURL=encryption-utils-server.js.map