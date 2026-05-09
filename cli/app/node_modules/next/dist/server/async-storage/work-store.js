"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createWorkStore", {
    enumerable: true,
    get: function() {
        return createWorkStore;
    }
});
const _aftercontext = require("../after/after-context");
const _apppaths = require("../../shared/lib/router/utils/app-paths");
const _lazyresult = require("../lib/lazy-result");
const _handlers = require("../use-cache/handlers");
const _asynclocalstorage = require("../app-render/async-local-storage");
function createWorkStore({ page, renderOpts, isPrefetchRequest, buildId, previouslyRevalidatedTags, nonce }) {
    /**
   * Rules of Static & Dynamic HTML:
   *
   *    1.) We must generate static HTML unless the caller explicitly opts
   *        in to dynamic HTML support.
   *
   *    2.) If dynamic HTML support is requested, we must honor that request
   *        or throw an error. It is the sole responsibility of the caller to
   *        ensure they aren't e.g. requesting dynamic HTML for a static page.
   *
   *    3.) If the request is in draft mode, we must generate dynamic HTML.
   *
   *    4.) If the request is a server action, we must generate dynamic HTML.
   *
   * These rules help ensure that other existing features like request caching,
   * coalescing, and ISR continue working as intended.
   */ const isStaticGeneration = !renderOpts.shouldWaitOnAllReady && !renderOpts.supportsDynamicResponse && !renderOpts.isDraftMode && !renderOpts.isPossibleServerAction;
    const shouldTrackFetchMetrics = !!process.env.__NEXT_DEV_SERVER || // The only times we want to track fetch metrics outside of development is
    // when we are performing a static generation and we either are in debug
    // mode, or tracking fetch metrics was specifically opted into.
    isStaticGeneration && (!!process.env.NEXT_DEBUG_BUILD || process.env.NEXT_SSG_FETCH_METRICS === '1');
    const store = {
        isStaticGeneration,
        page,
        route: (0, _apppaths.normalizeAppPath)(page),
        incrementalCache: // we fallback to a global incremental cache for edge-runtime locally
        // so that it can access the fs cache without mocks
        renderOpts.incrementalCache || globalThis.__incrementalCache,
        cacheLifeProfiles: renderOpts.cacheLifeProfiles,
        isBuildTimePrerendering: renderOpts.isBuildTimePrerendering,
        fetchCache: renderOpts.fetchCache,
        isOnDemandRevalidate: renderOpts.isOnDemandRevalidate,
        isDraftMode: renderOpts.isDraftMode,
        isPrefetchRequest,
        buildId,
        reactLoadableManifest: (renderOpts == null ? void 0 : renderOpts.reactLoadableManifest) || {},
        assetPrefix: (renderOpts == null ? void 0 : renderOpts.assetPrefix) || '',
        nonce,
        afterContext: createAfterContext(renderOpts),
        cacheComponentsEnabled: renderOpts.cacheComponents,
        previouslyRevalidatedTags,
        refreshTagsByCacheKind: createRefreshTagsByCacheKind(),
        runInCleanSnapshot: (0, _asynclocalstorage.createSnapshot)(),
        shouldTrackFetchMetrics,
        reactServerErrorsByDigest: new Map()
    };
    // TODO: remove this when we resolve accessing the store outside the execution context
    renderOpts.store = store;
    return store;
}
function createAfterContext(renderOpts) {
    const { waitUntil, onClose, onAfterTaskError } = renderOpts;
    return new _aftercontext.AfterContext({
        waitUntil,
        onClose,
        onTaskError: onAfterTaskError
    });
}
/**
 * Creates a map with lazy results that refresh tags for the respective cache
 * kind when they're awaited for the first time.
 */ function createRefreshTagsByCacheKind() {
    const refreshTagsByCacheKind = new Map();
    const cacheHandlers = (0, _handlers.getCacheHandlerEntries)();
    if (cacheHandlers) {
        for (const [kind, cacheHandler] of cacheHandlers){
            if ('refreshTags' in cacheHandler) {
                refreshTagsByCacheKind.set(kind, (0, _lazyresult.createLazyResult)(async ()=>cacheHandler.refreshTags()));
            }
        }
    }
    return refreshTagsByCacheKind;
}

//# sourceMappingURL=work-store.js.map