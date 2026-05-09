"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    CacheHandler: null,
    IncrementalCache: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    CacheHandler: function() {
        return CacheHandler;
    },
    IncrementalCache: function() {
        return IncrementalCache;
    }
});
const _responsecache = require("../../response-cache");
const _filesystemcache = /*#__PURE__*/ _interop_require_default(require("./file-system-cache"));
const _normalizepagepath = require("../../../shared/lib/page-path/normalize-page-path");
const _constants = require("../../../lib/constants");
const _toroute = require("../to-route");
const _sharedcachecontrolsexternal = require("./shared-cache-controls.external");
const _workunitasyncstorageexternal = require("../../app-render/work-unit-async-storage.external");
const _invarianterror = require("../../../shared/lib/invariant-error");
const _serverutils = require("../../server-utils");
const _workasyncstorageexternal = require("../../app-render/work-async-storage.external");
const _detachedpromise = require("../../../lib/detached-promise");
const _tagsmanifestexternal = require("./tags-manifest.external");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class CacheHandler {
    // eslint-disable-next-line
    constructor(_ctx){}
    async get(_cacheKey, _ctx) {
        return {};
    }
    async set(_cacheKey, _data, _ctx) {}
    async revalidateTag(_tags, _durations) {}
    resetRequestCache() {}
}
class IncrementalCache {
    static #_ = this.debug = !!process.env.NEXT_PRIVATE_DEBUG_CACHE;
    constructor({ fs, dev, flushToDisk, minimalMode, serverDistDir, requestHeaders, maxMemoryCacheSize, getPrerenderManifest, fetchCacheKeyPrefix, CurCacheHandler, allowedRevalidateHeaderKeys }){
        var _this_prerenderManifest_preview, _this_prerenderManifest;
        this.locks = new Map();
        this.hasCustomCacheHandler = Boolean(CurCacheHandler);
        const cacheHandlersSymbol = Symbol.for('@next/cache-handlers');
        const _globalThis = globalThis;
        if (!CurCacheHandler) {
            // if we have a global cache handler available leverage it
            const globalCacheHandler = _globalThis[cacheHandlersSymbol];
            if (globalCacheHandler == null ? void 0 : globalCacheHandler.FetchCache) {
                CurCacheHandler = globalCacheHandler.FetchCache;
                if (IncrementalCache.debug) {
                    console.log('IncrementalCache: using global FetchCache cache handler');
                }
            } else {
                if (fs && serverDistDir) {
                    if (IncrementalCache.debug) {
                        console.log('IncrementalCache: using filesystem cache handler');
                    }
                    CurCacheHandler = _filesystemcache.default;
                }
            }
        } else if (IncrementalCache.debug) {
            console.log('IncrementalCache: using custom cache handler', CurCacheHandler.name);
        }
        if (process.env.__NEXT_TEST_MAX_ISR_CACHE) {
            // Allow cache size to be overridden for testing purposes
            maxMemoryCacheSize = parseInt(process.env.__NEXT_TEST_MAX_ISR_CACHE, 10);
        }
        this.dev = dev;
        this.disableForTestmode = process.env.NEXT_PRIVATE_TEST_PROXY === 'true';
        // this is a hack to avoid Webpack knowing this is equal to this.minimalMode
        // because we replace this.minimalMode to true in production bundles.
        const minimalModeKey = 'minimalMode';
        this[minimalModeKey] = minimalMode;
        this.requestHeaders = requestHeaders;
        this.allowedRevalidateHeaderKeys = allowedRevalidateHeaderKeys;
        this.prerenderManifest = getPrerenderManifest();
        this.cacheControls = new _sharedcachecontrolsexternal.SharedCacheControls(this.prerenderManifest);
        this.fetchCacheKeyPrefix = fetchCacheKeyPrefix;
        let revalidatedTags = [];
        if (requestHeaders[_constants.PRERENDER_REVALIDATE_HEADER] === ((_this_prerenderManifest = this.prerenderManifest) == null ? void 0 : (_this_prerenderManifest_preview = _this_prerenderManifest.preview) == null ? void 0 : _this_prerenderManifest_preview.previewModeId)) {
            this.isOnDemandRevalidate = true;
        }
        if (minimalMode) {
            var _this_prerenderManifest_preview1, _this_prerenderManifest1;
            revalidatedTags = this.revalidatedTags = (0, _serverutils.getPreviouslyRevalidatedTags)(requestHeaders, (_this_prerenderManifest1 = this.prerenderManifest) == null ? void 0 : (_this_prerenderManifest_preview1 = _this_prerenderManifest1.preview) == null ? void 0 : _this_prerenderManifest_preview1.previewModeId);
        }
        if (CurCacheHandler) {
            this.cacheHandler = new CurCacheHandler({
                dev,
                fs,
                flushToDisk,
                serverDistDir,
                revalidatedTags,
                maxMemoryCacheSize,
                _requestHeaders: requestHeaders,
                fetchCacheKeyPrefix
            });
        }
    }
    calculateRevalidate(pathname, fromTime, dev, isFallback) {
        // in development we don't have a prerender-manifest
        // and default to always revalidating to allow easier debugging
        if (dev) return Math.floor(performance.timeOrigin + performance.now() - 1000);
        const cacheControl = this.cacheControls.get((0, _toroute.toRoute)(pathname));
        // if an entry isn't present in routes we fallback to a default
        // of revalidating after 1 second unless it's a fallback request.
        const initialRevalidateSeconds = cacheControl ? cacheControl.revalidate : isFallback ? false : 1;
        const revalidateAfter = typeof initialRevalidateSeconds === 'number' ? initialRevalidateSeconds * 1000 + fromTime : initialRevalidateSeconds;
        return revalidateAfter;
    }
    _getPathname(pathname, fetchCache) {
        return fetchCache ? pathname : (0, _normalizepagepath.normalizePagePath)(pathname);
    }
    resetRequestCache() {
        var _this_cacheHandler_resetRequestCache, _this_cacheHandler;
        (_this_cacheHandler = this.cacheHandler) == null ? void 0 : (_this_cacheHandler_resetRequestCache = _this_cacheHandler.resetRequestCache) == null ? void 0 : _this_cacheHandler_resetRequestCache.call(_this_cacheHandler);
    }
    async lock(cacheKey) {
        // Wait for any existing lock on this cache key to be released
        // This implements a simple queue-based locking mechanism
        while(true){
            const lock = this.locks.get(cacheKey);
            if (IncrementalCache.debug) {
                console.log('IncrementalCache: lock get', cacheKey, !!lock);
            }
            // If no lock exists, we can proceed to acquire it
            if (!lock) break;
            // Wait for the existing lock to be released before trying again
            await lock;
        }
        // Create a new detached promise that will represent this lock
        // The resolve function (unlock) will be returned to the caller
        const { resolve, promise } = new _detachedpromise.DetachedPromise();
        if (IncrementalCache.debug) {
            console.log('IncrementalCache: successfully locked', cacheKey);
        }
        // Store the lock promise in the locks map
        this.locks.set(cacheKey, promise);
        return ()=>{
            // Resolve the promise to release the lock.
            resolve();
            // Remove the lock from the map once it's released so that future gets
            // can acquire the lock.
            this.locks.delete(cacheKey);
        };
    }
    async revalidateTag(tags, durations) {
        var _this_cacheHandler;
        return (_this_cacheHandler = this.cacheHandler) == null ? void 0 : _this_cacheHandler.revalidateTag(tags, durations);
    }
    // x-ref: https://github.com/facebook/react/blob/2655c9354d8e1c54ba888444220f63e836925caa/packages/react/src/ReactFetch.js#L23
    async generateCacheKey(url, init = {}) {
        // this should be bumped anytime a fix is made to cache entries
        // that should bust the cache
        const MAIN_KEY_PREFIX = 'v3';
        const bodyChunks = [];
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        if (init.body) {
            // handle Uint8Array body
            if (init.body instanceof Uint8Array) {
                bodyChunks.push(decoder.decode(init.body));
                init._ogBody = init.body;
            } else if (typeof init.body.getReader === 'function') {
                const readableBody = init.body;
                const chunks = [];
                try {
                    await readableBody.pipeTo(new WritableStream({
                        write (chunk) {
                            if (typeof chunk === 'string') {
                                chunks.push(encoder.encode(chunk));
                                bodyChunks.push(chunk);
                            } else {
                                chunks.push(chunk);
                                bodyChunks.push(decoder.decode(chunk, {
                                    stream: true
                                }));
                            }
                        }
                    }));
                    // Flush the decoder.
                    bodyChunks.push(decoder.decode());
                    // Create a new buffer with all the chunks.
                    const length = chunks.reduce((total, arr)=>total + arr.length, 0);
                    const arrayBuffer = new Uint8Array(length);
                    // Push each of the chunks into the new array buffer.
                    let offset = 0;
                    for (const chunk of chunks){
                        arrayBuffer.set(chunk, offset);
                        offset += chunk.length;
                    }
                    ;
                    init._ogBody = arrayBuffer;
                } catch (err) {
                    console.error('Problem reading body', err);
                }
            } else if (typeof init.body.keys === 'function') {
                const formData = init.body;
                init._ogBody = init.body;
                for (const key of new Set([
                    ...formData.keys()
                ])){
                    const values = formData.getAll(key);
                    bodyChunks.push(`${key}=${(await Promise.all(values.map(async (val)=>{
                        if (typeof val === 'string') {
                            return val;
                        } else {
                            return await val.text();
                        }
                    }))).join(',')}`);
                }
            // handle blob body
            } else if (typeof init.body.arrayBuffer === 'function') {
                const blob = init.body;
                const arrayBuffer = await blob.arrayBuffer();
                bodyChunks.push(await blob.text());
                init._ogBody = new Blob([
                    arrayBuffer
                ], {
                    type: blob.type
                });
            } else if (typeof init.body === 'string') {
                bodyChunks.push(init.body);
                init._ogBody = init.body;
            }
        }
        const headers = typeof (init.headers || {}).keys === 'function' ? Object.fromEntries(init.headers) : Object.assign({}, init.headers);
        // w3c trace context headers can break request caching and deduplication
        // so we remove them from the cache key
        if ('traceparent' in headers) delete headers['traceparent'];
        if ('tracestate' in headers) delete headers['tracestate'];
        const cacheString = JSON.stringify([
            MAIN_KEY_PREFIX,
            this.fetchCacheKeyPrefix || '',
            url,
            init.method,
            headers,
            init.mode,
            init.redirect,
            init.credentials,
            init.referrer,
            init.referrerPolicy,
            init.integrity,
            init.cache,
            bodyChunks
        ]);
        if (process.env.NEXT_RUNTIME === 'edge') {
            function bufferToHex(buffer) {
                return Array.prototype.map.call(new Uint8Array(buffer), (b)=>b.toString(16).padStart(2, '0')).join('');
            }
            const buffer = encoder.encode(cacheString);
            return bufferToHex(await crypto.subtle.digest('SHA-256', buffer));
        } else {
            const crypto1 = require('crypto');
            return crypto1.createHash('sha256').update(cacheString).digest('hex');
        }
    }
    async get(cacheKey, ctx) {
        var _this_cacheHandler, _cacheData_value;
        // Unlike other caches if we have a resume data cache, we use it even if
        // testmode would normally disable it or if requestHeaders say 'no-cache'.
        if (ctx.kind === _responsecache.IncrementalCacheKind.FETCH) {
            const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
            const resumeDataCache = workUnitStore ? (0, _workunitasyncstorageexternal.getRenderResumeDataCache)(workUnitStore) : null;
            if (resumeDataCache) {
                const memoryCacheData = resumeDataCache.fetch.get(cacheKey);
                if ((memoryCacheData == null ? void 0 : memoryCacheData.kind) === _responsecache.CachedRouteKind.FETCH) {
                    // Check if any tags were recently revalidated before returning RDC entry.
                    // When a server action calls updateTag(), the re-render should see fresh
                    // data instead of stale RDC data.
                    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
                    const combinedTags = [
                        ...ctx.tags || [],
                        ...ctx.softTags || []
                    ];
                    const hasRevalidatedTag = combinedTags.some((tag)=>{
                        var _this_revalidatedTags, _workStore_pendingRevalidatedTags;
                        return ((_this_revalidatedTags = this.revalidatedTags) == null ? void 0 : _this_revalidatedTags.includes(tag)) || (workStore == null ? void 0 : (_workStore_pendingRevalidatedTags = workStore.pendingRevalidatedTags) == null ? void 0 : _workStore_pendingRevalidatedTags.some((item)=>item.tag === tag));
                    });
                    if (hasRevalidatedTag) {
                        if (IncrementalCache.debug) {
                            console.log('IncrementalCache: rdc:revalidated-tag', cacheKey);
                        }
                    // Fall through to cacheHandler lookup
                    } else {
                        if (IncrementalCache.debug) {
                            console.log('IncrementalCache: rdc:hit', cacheKey);
                        }
                        return {
                            isStale: false,
                            value: memoryCacheData
                        };
                    }
                } else if (IncrementalCache.debug) {
                    console.log('IncrementalCache: rdc:miss', cacheKey);
                }
            } else {
                if (IncrementalCache.debug) {
                    console.log('IncrementalCache: rdc:no-resume-data');
                }
            }
        }
        // we don't leverage the prerender cache in dev mode
        // so that getStaticProps is always called for easier debugging
        if (this.disableForTestmode || this.dev && (ctx.kind !== _responsecache.IncrementalCacheKind.FETCH || this.requestHeaders['cache-control'] === 'no-cache')) {
            return null;
        }
        cacheKey = this._getPathname(cacheKey, ctx.kind === _responsecache.IncrementalCacheKind.FETCH);
        const cacheData = await ((_this_cacheHandler = this.cacheHandler) == null ? void 0 : _this_cacheHandler.get(cacheKey, ctx));
        if (ctx.kind === _responsecache.IncrementalCacheKind.FETCH) {
            var _cacheData_value1;
            if (!cacheData) {
                return null;
            }
            if (((_cacheData_value1 = cacheData.value) == null ? void 0 : _cacheData_value1.kind) !== _responsecache.CachedRouteKind.FETCH) {
                var _cacheData_value2;
                throw Object.defineProperty(new _invarianterror.InvariantError(`Expected cached value for cache key ${JSON.stringify(cacheKey)} to be a "FETCH" kind, got ${JSON.stringify((_cacheData_value2 = cacheData.value) == null ? void 0 : _cacheData_value2.kind)} instead.`), "__NEXT_ERROR_CODE", {
                    value: "E653",
                    enumerable: false,
                    configurable: true
                });
            }
            const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
            const combinedTags = [
                ...ctx.tags || [],
                ...ctx.softTags || []
            ];
            // if a tag was revalidated we don't return stale data
            if (combinedTags.some((tag)=>{
                var _this_revalidatedTags, _workStore_pendingRevalidatedTags;
                return ((_this_revalidatedTags = this.revalidatedTags) == null ? void 0 : _this_revalidatedTags.includes(tag)) || (workStore == null ? void 0 : (_workStore_pendingRevalidatedTags = workStore.pendingRevalidatedTags) == null ? void 0 : _workStore_pendingRevalidatedTags.some((item)=>item.tag === tag));
            })) {
                if (IncrementalCache.debug) {
                    console.log('IncrementalCache: expired tag', cacheKey);
                }
                return null;
            }
            // As we're able to get the cache entry for this fetch, and the prerender
            // resume data cache (RDC) is available, it must have been populated by a
            // previous fetch, but was not yet present in the in-memory cache. This
            // could be the case when performing multiple renders in parallel during
            // build time where we de-duplicate the fetch calls.
            //
            // We add it to the RDC so that the next fetch call will be able to use it
            // and it won't have to reach into the fetch cache implementation.
            const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
            if (workUnitStore) {
                const prerenderResumeDataCache = (0, _workunitasyncstorageexternal.getPrerenderResumeDataCache)(workUnitStore);
                if (prerenderResumeDataCache) {
                    if (IncrementalCache.debug) {
                        console.log('IncrementalCache: rdc:set', cacheKey);
                    }
                    prerenderResumeDataCache.fetch.set(cacheKey, cacheData.value);
                }
            }
            const revalidate = ctx.revalidate || cacheData.value.revalidate;
            const age = (performance.timeOrigin + performance.now() - (cacheData.lastModified || 0)) / 1000;
            let isStale = age > revalidate;
            const data = cacheData.value.data;
            if ((0, _tagsmanifestexternal.areTagsExpired)(combinedTags, cacheData.lastModified)) {
                return null;
            } else if ((0, _tagsmanifestexternal.areTagsStale)(combinedTags, cacheData.lastModified)) {
                isStale = true;
            }
            return {
                isStale,
                value: {
                    kind: _responsecache.CachedRouteKind.FETCH,
                    data,
                    revalidate
                }
            };
        } else if ((cacheData == null ? void 0 : (_cacheData_value = cacheData.value) == null ? void 0 : _cacheData_value.kind) === _responsecache.CachedRouteKind.FETCH) {
            throw Object.defineProperty(new _invarianterror.InvariantError(`Expected cached value for cache key ${JSON.stringify(cacheKey)} not to be a ${JSON.stringify(ctx.kind)} kind, got "FETCH" instead.`), "__NEXT_ERROR_CODE", {
                value: "E652",
                enumerable: false,
                configurable: true
            });
        }
        let entry = null;
        const { isFallback } = ctx;
        const cacheControl = this.cacheControls.get((0, _toroute.toRoute)(cacheKey));
        let isStale;
        let revalidateAfter;
        if ((cacheData == null ? void 0 : cacheData.lastModified) === -1) {
            isStale = -1;
            revalidateAfter = -1 * _constants.CACHE_ONE_YEAR_SECONDS * 1000;
        } else {
            var _cacheData_value3, _cacheData_value4;
            const now = performance.timeOrigin + performance.now();
            const lastModified = (cacheData == null ? void 0 : cacheData.lastModified) || now;
            revalidateAfter = this.calculateRevalidate(cacheKey, lastModified, this.dev ?? false, ctx.isFallback);
            isStale = revalidateAfter !== false && revalidateAfter < now ? true : undefined;
            // If the stale time couldn't be determined based on the revalidation
            // time, we check if the tags are expired or stale.
            if (isStale === undefined && ((cacheData == null ? void 0 : (_cacheData_value3 = cacheData.value) == null ? void 0 : _cacheData_value3.kind) === _responsecache.CachedRouteKind.APP_PAGE || (cacheData == null ? void 0 : (_cacheData_value4 = cacheData.value) == null ? void 0 : _cacheData_value4.kind) === _responsecache.CachedRouteKind.APP_ROUTE)) {
                var _cacheData_value_headers;
                const tagsHeader = (_cacheData_value_headers = cacheData.value.headers) == null ? void 0 : _cacheData_value_headers[_constants.NEXT_CACHE_TAGS_HEADER];
                if (typeof tagsHeader === 'string') {
                    const cacheTags = tagsHeader.split(',');
                    if (cacheTags.length > 0) {
                        if ((0, _tagsmanifestexternal.areTagsExpired)(cacheTags, lastModified)) {
                            isStale = -1;
                        } else if ((0, _tagsmanifestexternal.areTagsStale)(cacheTags, lastModified)) {
                            isStale = true;
                        }
                    }
                }
            }
        }
        if (cacheData) {
            entry = {
                isStale,
                cacheControl,
                revalidateAfter,
                value: cacheData.value,
                isFallback
            };
        }
        if (!cacheData && this.prerenderManifest.notFoundRoutes.includes(cacheKey)) {
            // for the first hit after starting the server the cache
            // may not have a way to save notFound: true so if
            // the prerender-manifest marks this as notFound then we
            // return that entry and trigger a cache set to give it a
            // chance to update in-memory entries
            entry = {
                isStale,
                value: null,
                cacheControl,
                revalidateAfter,
                isFallback
            };
            this.set(cacheKey, entry.value, {
                ...ctx,
                cacheControl
            });
        }
        return entry;
    }
    async set(pathname, data, ctx) {
        // Even if we otherwise disable caching for testMode or if no fetchCache is
        // configured we still always stash results in the resume data cache if one
        // exists. This is because this is a transient in memory cache that
        // populates caches ahead of a dynamic render in dev mode to allow the RSC
        // debug info to have the right environment associated to it.
        if ((data == null ? void 0 : data.kind) === _responsecache.CachedRouteKind.FETCH) {
            const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
            const prerenderResumeDataCache = workUnitStore ? (0, _workunitasyncstorageexternal.getPrerenderResumeDataCache)(workUnitStore) : null;
            if (prerenderResumeDataCache) {
                if (IncrementalCache.debug) {
                    console.log('IncrementalCache: rdc:set', pathname);
                }
                prerenderResumeDataCache.fetch.set(pathname, data);
            }
        }
        if (this.disableForTestmode || this.dev && !ctx.fetchCache) return;
        pathname = this._getPathname(pathname, ctx.fetchCache);
        // FetchCache has upper limit of 2MB per-entry currently
        const itemSize = JSON.stringify(data).length;
        if (ctx.fetchCache && itemSize > 2 * 1024 * 1024 && // We ignore the size limit when custom cache handler is being used, as it
        // might not have this limit
        !this.hasCustomCacheHandler && // We also ignore the size limit when it's an implicit build-time-only
        // caching that the user isn't even aware of.
        !ctx.isImplicitBuildTimeCache) {
            const warningText = `Failed to set Next.js data cache for ${ctx.fetchUrl || pathname}, items over 2MB can not be cached (${itemSize} bytes)`;
            if (this.dev) {
                throw Object.defineProperty(new Error(warningText), "__NEXT_ERROR_CODE", {
                    value: "E1003",
                    enumerable: false,
                    configurable: true
                });
            }
            console.warn(warningText);
            return;
        }
        try {
            var _this_cacheHandler;
            if (!ctx.fetchCache && ctx.cacheControl) {
                this.cacheControls.set((0, _toroute.toRoute)(pathname), ctx.cacheControl);
            }
            await ((_this_cacheHandler = this.cacheHandler) == null ? void 0 : _this_cacheHandler.set(pathname, data, ctx));
        } catch (error) {
            console.warn('Failed to update prerender cache for', pathname, error);
        }
    }
}

//# sourceMappingURL=index.js.map