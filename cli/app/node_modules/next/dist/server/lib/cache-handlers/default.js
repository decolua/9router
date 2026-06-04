/**
 * This is the default "use cache" handler it defaults to an in-memory store.
 * In-memory caches are fragile and should not use stale-while-revalidate
 * semantics on the caches because it's not worth warming up an entry that's
 * likely going to get evicted before we get to use it anyway. However, we also
 * don't want to reuse a stale entry for too long so stale entries should be
 * considered expired/missing in such cache handlers.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createDefaultCacheHandler", {
    enumerable: true,
    get: function() {
        return createDefaultCacheHandler;
    }
});
const _lrucache = require("../lru-cache");
const _tagsmanifestexternal = require("../incremental-cache/tags-manifest.external");
function createDefaultCacheHandler(maxSize) {
    // If the max size is 0, return a cache handler that doesn't cache anything,
    // this avoids an unnecessary LRUCache instance and potential memory
    // allocation.
    if (maxSize === 0) {
        return {
            get: ()=>Promise.resolve(undefined),
            set: ()=>Promise.resolve(),
            refreshTags: ()=>Promise.resolve(),
            getExpiration: ()=>Promise.resolve(0),
            updateTags: ()=>Promise.resolve()
        };
    }
    const memoryCache = new _lrucache.LRUCache(maxSize, (entry)=>entry.size);
    const pendingSets = new Map();
    const debug = process.env.NEXT_PRIVATE_DEBUG_CACHE ? console.debug.bind(console, 'DefaultCacheHandler:') : undefined;
    return {
        async get (cacheKey) {
            const pendingPromise = pendingSets.get(cacheKey);
            if (pendingPromise) {
                debug == null ? void 0 : debug('get', cacheKey, 'pending');
                await pendingPromise;
            }
            const privateEntry = memoryCache.get(cacheKey);
            if (!privateEntry) {
                debug == null ? void 0 : debug('get', cacheKey, 'not found');
                return undefined;
            }
            const entry = privateEntry.entry;
            if (performance.timeOrigin + performance.now() > entry.timestamp + entry.revalidate * 1000) {
                // In-memory caches should expire after revalidate time because it is
                // unlikely that a new entry will be able to be used before it is dropped
                // from the cache.
                debug == null ? void 0 : debug('get', cacheKey, 'expired');
                return undefined;
            }
            let revalidate = entry.revalidate;
            if ((0, _tagsmanifestexternal.areTagsExpired)(entry.tags, entry.timestamp)) {
                debug == null ? void 0 : debug('get', cacheKey, 'had expired tag');
                return undefined;
            }
            if ((0, _tagsmanifestexternal.areTagsStale)(entry.tags, entry.timestamp)) {
                debug == null ? void 0 : debug('get', cacheKey, 'had stale tag');
                revalidate = -1;
            }
            const [returnStream, newSaved] = entry.value.tee();
            entry.value = newSaved;
            debug == null ? void 0 : debug('get', cacheKey, 'found', {
                tags: entry.tags,
                timestamp: entry.timestamp,
                expire: entry.expire,
                revalidate
            });
            return {
                ...entry,
                revalidate,
                value: returnStream
            };
        },
        async set (cacheKey, pendingEntry) {
            debug == null ? void 0 : debug('set', cacheKey, 'start');
            let resolvePending = ()=>{};
            const pendingPromise = new Promise((resolve)=>{
                resolvePending = resolve;
            });
            pendingSets.set(cacheKey, pendingPromise);
            const entry = await pendingEntry;
            let size = 0;
            try {
                const [value, clonedValue] = entry.value.tee();
                entry.value = value;
                const reader = clonedValue.getReader();
                for(let chunk; !(chunk = await reader.read()).done;){
                    size += Buffer.from(chunk.value).byteLength;
                }
                memoryCache.set(cacheKey, {
                    entry,
                    isErrored: false,
                    errorRetryCount: 0,
                    size
                });
                debug == null ? void 0 : debug('set', cacheKey, 'done');
            } catch (err) {
                // TODO: store partial buffer with error after we retry 3 times
                debug == null ? void 0 : debug('set', cacheKey, 'failed', err);
            } finally{
                resolvePending();
                pendingSets.delete(cacheKey);
            }
        },
        async refreshTags () {
        // Nothing to do for an in-memory cache handler.
        },
        async getExpiration (tags) {
            const expirations = tags.map((tag)=>{
                const entry = _tagsmanifestexternal.tagsManifest.get(tag);
                if (!entry) return 0;
                // Return the most recent timestamp (either expired or stale)
                return entry.expired || 0;
            });
            const expiration = Math.max(...expirations, 0);
            debug == null ? void 0 : debug('getExpiration', {
                tags,
                expiration
            });
            return expiration;
        },
        async updateTags (tags, durations) {
            const now = Math.round(performance.timeOrigin + performance.now());
            debug == null ? void 0 : debug('updateTags', {
                tags,
                timestamp: now
            });
            for (const tag of tags){
                // TODO: update file-system-cache?
                const existingEntry = _tagsmanifestexternal.tagsManifest.get(tag) || {};
                if (durations) {
                    // Use provided durations directly
                    const updates = {
                        ...existingEntry
                    };
                    // mark as stale immediately
                    updates.stale = now;
                    if (durations.expire !== undefined) {
                        updates.expired = now + durations.expire * 1000 // Convert seconds to ms
                        ;
                    }
                    _tagsmanifestexternal.tagsManifest.set(tag, updates);
                } else {
                    // Update expired field for immediate expiration (default behavior when no durations provided)
                    _tagsmanifestexternal.tagsManifest.set(tag, {
                        ...existingEntry,
                        expired: now
                    });
                }
            }
        }
    };
}

//# sourceMappingURL=default.js.map