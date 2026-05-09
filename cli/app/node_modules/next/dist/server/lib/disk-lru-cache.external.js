"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getOrInitDiskLRU: null,
    resetDiskLRU: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getOrInitDiskLRU: function() {
        return getOrInitDiskLRU;
    },
    resetDiskLRU: function() {
        return resetDiskLRU;
    }
});
const _fs = require("fs");
const _lrucache = require("./lru-cache");
/**
 * Module-level LRU singleton for disk cache eviction.
 * Initialized once on first `set()`, shared across all consumers.
 * Once resolved, the promise stays resolved — subsequent calls just await the cached result.
 */ let _diskLRUPromise = null;
async function getOrInitDiskLRU(cacheDir, maxDiskSize, readEntries, evictEntry) {
    if (!_diskLRUPromise) {
        _diskLRUPromise = (async ()=>{
            let maxSize = maxDiskSize;
            if (typeof maxSize === 'undefined') {
                // Ensure cacheDir exists before checking disk space
                await _fs.promises.mkdir(cacheDir, {
                    recursive: true
                });
                // Since config was not provided, default to 50% of available disk space
                const { bavail, bsize } = await _fs.promises.statfs(cacheDir);
                maxSize = Math.floor(bavail * bsize / 2);
            }
            const lru = new _lrucache.LRUCache(maxSize, (size)=>size, (cacheKey)=>evictEntry(cacheDir, cacheKey));
            const entries = await readEntries(cacheDir);
            for (const entry of entries){
                lru.set(entry.key, entry.size);
            }
            return lru;
        })();
    }
    return _diskLRUPromise;
}
function resetDiskLRU() {
    _diskLRUPromise = null;
}

//# sourceMappingURL=disk-lru-cache.external.js.map