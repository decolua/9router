"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    checkFileSystemCacheInvalidationAndCleanup: null,
    invalidateFileSystemCache: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    checkFileSystemCacheInvalidationAndCleanup: function() {
        return checkFileSystemCacheInvalidationAndCleanup;
    },
    invalidateFileSystemCache: function() {
        return invalidateFileSystemCache;
    }
});
const _promises = /*#__PURE__*/ _interop_require_default(require("node:fs/promises"));
const _nodepath = /*#__PURE__*/ _interop_require_default(require("node:path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const INVALIDATION_MARKER = '__nextjs_invalidated_cache';
async function invalidateFileSystemCache(cacheDirectory) {
    let file;
    try {
        // We're just opening it so that `open()` creates the file.
        file = await _promises.default.open(_nodepath.default.join(cacheDirectory, INVALIDATION_MARKER), 'w');
    // We don't currently write anything to the file, but we could choose to
    // later, e.g. a reason for the invalidation.
    } catch (err) {
        // it's valid for the cache to not exist at all
        if (err.code !== 'ENOENT') {
            throw err;
        }
    } finally{
        file == null ? void 0 : file.close();
    }
}
async function checkFileSystemCacheInvalidationAndCleanup(cacheDirectory) {
    const invalidated = await _promises.default.access(_nodepath.default.join(cacheDirectory, INVALIDATION_MARKER)).then(()=>true, ()=>false);
    if (invalidated) {
        await cleanupFileSystemCache(cacheDirectory);
    }
}
/**
 * Helper for `checkFileSystemCacheInvalidationAndCleanup`. You can call this to
 * explicitly clean up a database after running `invalidateFileSystemCache` when
 * webpack is not running.
 *
 * You should not run this if the cache has not yet been invalidated, as this
 * operation is not atomic and could result in a partially-deleted and corrupted
 * database.
 */ async function cleanupFileSystemCache(cacheDirectory) {
    try {
        await cleanupFileSystemCacheInner(cacheDirectory);
    } catch (e) {
        // generate a user-friendly error message
        throw Object.defineProperty(new Error(`Unable to remove an invalidated webpack cache. If this issue persists ` + `you can work around it by deleting ${cacheDirectory}`, {
            cause: e
        }), "__NEXT_ERROR_CODE", {
            value: "E710",
            enumerable: false,
            configurable: true
        });
    }
}
async function cleanupFileSystemCacheInner(cacheDirectory) {
    const files = await _promises.default.readdir(cacheDirectory);
    // delete everything except the invalidation marker
    await Promise.all(files.map((name)=>name !== INVALIDATION_MARKER ? _promises.default.rm(_nodepath.default.join(cacheDirectory, name), {
            force: true,
            recursive: true,
            maxRetries: 2
        }) : null));
    // delete the invalidation marker last, once we're sure everything is cleaned
    // up
    await _promises.default.rm(_nodepath.default.join(cacheDirectory, INVALIDATION_MARKER), {
        force: true,
        maxRetries: 2
    });
}

//# sourceMappingURL=cache-invalidation.js.map