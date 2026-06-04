"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getCacheSignal: null,
    getDraftModeProviderForCacheScope: null,
    getHmrRefreshHash: null,
    getPrerenderResumeDataCache: null,
    getRenderResumeDataCache: null,
    getServerComponentsHmrCache: null,
    getStagedRenderingController: null,
    isHmrRefresh: null,
    isInEarlyRenderStage: null,
    throwForMissingRequestStore: null,
    throwInvariantForMissingStore: null,
    workUnitAsyncStorage: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getCacheSignal: function() {
        return getCacheSignal;
    },
    getDraftModeProviderForCacheScope: function() {
        return getDraftModeProviderForCacheScope;
    },
    getHmrRefreshHash: function() {
        return getHmrRefreshHash;
    },
    getPrerenderResumeDataCache: function() {
        return getPrerenderResumeDataCache;
    },
    getRenderResumeDataCache: function() {
        return getRenderResumeDataCache;
    },
    getServerComponentsHmrCache: function() {
        return getServerComponentsHmrCache;
    },
    getStagedRenderingController: function() {
        return getStagedRenderingController;
    },
    isHmrRefresh: function() {
        return isHmrRefresh;
    },
    isInEarlyRenderStage: function() {
        return isInEarlyRenderStage;
    },
    throwForMissingRequestStore: function() {
        return throwForMissingRequestStore;
    },
    throwInvariantForMissingStore: function() {
        return throwInvariantForMissingStore;
    },
    workUnitAsyncStorage: function() {
        return _workunitasyncstorageinstance.workUnitAsyncStorageInstance;
    }
});
const _workunitasyncstorageinstance = require("./work-unit-async-storage-instance");
const _approuterheaders = require("../../client/components/app-router-headers");
const _invarianterror = require("../../shared/lib/invariant-error");
const _stagedrendering = require("./staged-rendering");
function isInEarlyRenderStage(requestStore) {
    const stagedRendering = requestStore.stagedRendering;
    if (stagedRendering) {
        return stagedRendering.currentStage === _stagedrendering.RenderStage.EarlyStatic || stagedRendering.currentStage === _stagedrendering.RenderStage.EarlyRuntime;
    }
    return false;
}
function throwForMissingRequestStore(callingExpression) {
    throw Object.defineProperty(new Error(`\`${callingExpression}\` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context`), "__NEXT_ERROR_CODE", {
        value: "E251",
        enumerable: false,
        configurable: true
    });
}
function throwInvariantForMissingStore() {
    throw Object.defineProperty(new _invarianterror.InvariantError('Expected workUnitAsyncStorage to have a store.'), "__NEXT_ERROR_CODE", {
        value: "E696",
        enumerable: false,
        configurable: true
    });
}
function getPrerenderResumeDataCache(workUnitStore) {
    switch(workUnitStore.type){
        case 'prerender':
        case 'prerender-runtime':
        case 'prerender-ppr':
            return workUnitStore.prerenderResumeDataCache;
        case 'prerender-client':
        case 'validation-client':
            // TODO eliminate fetch caching in client scope and stop exposing this data
            // cache during SSR.
            return workUnitStore.prerenderResumeDataCache;
        case 'request':
            {
                // In dev, we might fill caches even during a dynamic request.
                if (workUnitStore.prerenderResumeDataCache) {
                    return workUnitStore.prerenderResumeDataCache;
                }
            // fallthrough
            }
        case 'prerender-legacy':
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'generate-static-params':
            return null;
        default:
            return workUnitStore;
    }
}
function getRenderResumeDataCache(workUnitStore) {
    switch(workUnitStore.type){
        case 'request':
        case 'prerender':
        case 'prerender-runtime':
        case 'prerender-client':
        case 'validation-client':
            if (workUnitStore.renderResumeDataCache) {
                // If we are in a prerender, we might have a render resume data cache
                // that is used to read from prefilled caches.
                return workUnitStore.renderResumeDataCache;
            }
        // fallthrough
        case 'prerender-ppr':
            // Otherwise we return the mutable resume data cache here as an immutable
            // version of the cache as it can also be used for reading.
            return workUnitStore.prerenderResumeDataCache ?? null;
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'prerender-legacy':
        case 'generate-static-params':
            return null;
        default:
            return workUnitStore;
    }
}
function getHmrRefreshHash(workUnitStore) {
    if (process.env.__NEXT_DEV_SERVER) {
        switch(workUnitStore.type){
            case 'cache':
            case 'private-cache':
            case 'prerender':
            case 'prerender-runtime':
                return workUnitStore.hmrRefreshHash;
            case 'request':
                var _workUnitStore_cookies_get;
                return (_workUnitStore_cookies_get = workUnitStore.cookies.get(_approuterheaders.NEXT_HMR_REFRESH_HASH_COOKIE)) == null ? void 0 : _workUnitStore_cookies_get.value;
            case 'prerender-client':
            case 'validation-client':
            case 'prerender-ppr':
            case 'prerender-legacy':
            case 'unstable-cache':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
    return undefined;
}
function isHmrRefresh(workUnitStore) {
    if (process.env.__NEXT_DEV_SERVER) {
        switch(workUnitStore.type){
            case 'cache':
            case 'private-cache':
            case 'request':
                return workUnitStore.isHmrRefresh ?? false;
            case 'prerender':
            case 'prerender-client':
            case 'validation-client':
            case 'prerender-runtime':
            case 'prerender-ppr':
            case 'prerender-legacy':
            case 'unstable-cache':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
    return false;
}
function getServerComponentsHmrCache(workUnitStore) {
    if (process.env.__NEXT_DEV_SERVER) {
        switch(workUnitStore.type){
            case 'cache':
            case 'private-cache':
            case 'request':
                return workUnitStore.serverComponentsHmrCache;
            case 'prerender':
            case 'prerender-client':
            case 'validation-client':
            case 'prerender-runtime':
            case 'prerender-ppr':
            case 'prerender-legacy':
            case 'unstable-cache':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
    return undefined;
}
function getDraftModeProviderForCacheScope(workStore, workUnitStore) {
    if (workStore.isDraftMode) {
        switch(workUnitStore.type){
            case 'cache':
            case 'private-cache':
            case 'unstable-cache':
            case 'prerender-runtime':
            case 'request':
                return workUnitStore.draftMode;
            case 'prerender':
            case 'prerender-client':
            case 'validation-client':
            case 'prerender-ppr':
            case 'prerender-legacy':
            case 'generate-static-params':
                break;
            default:
                workUnitStore;
        }
    }
    return undefined;
}
function getStagedRenderingController(workUnitStore) {
    switch(workUnitStore.type){
        case 'request':
        case 'prerender-runtime':
            return workUnitStore.stagedRendering ?? null;
        case 'prerender':
        case 'prerender-client':
        case 'validation-client':
        case 'prerender-ppr':
        case 'prerender-legacy':
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'generate-static-params':
            return null;
        default:
            return workUnitStore;
    }
}
function getCacheSignal(workUnitStore) {
    switch(workUnitStore.type){
        case 'prerender':
        case 'prerender-client':
        case 'validation-client':
        case 'prerender-runtime':
            return workUnitStore.cacheSignal;
        case 'request':
            {
                // In dev, we might fill caches even during a dynamic request.
                if (workUnitStore.cacheSignal) {
                    return workUnitStore.cacheSignal;
                }
            // fallthrough
            }
        case 'prerender-ppr':
        case 'prerender-legacy':
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'generate-static-params':
            return null;
        default:
            return workUnitStore;
    }
}

//# sourceMappingURL=work-unit-async-storage.external.js.map