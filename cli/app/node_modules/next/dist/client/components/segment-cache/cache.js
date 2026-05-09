"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    EntryStatus: null,
    attemptToFulfillDynamicSegmentFromBFCache: null,
    attemptToUpgradeSegmentFromBFCache: null,
    canNewFetchStrategyProvideMoreContent: null,
    convertReusedFlightRouterStateToRouteTree: null,
    convertRootFlightRouterStateToRouteTree: null,
    convertRouteTreeToFlightRouterState: null,
    createDetachedSegmentCacheEntry: null,
    createMetadataRouteTree: null,
    deprecated_requestOptimisticRouteCacheEntry: null,
    fetchInlinedSegmentsOnCacheMiss: null,
    fetchRouteOnCacheMiss: null,
    fetchSegmentOnCacheMiss: null,
    fetchSegmentPrefetchesUsingDynamicRequest: null,
    fulfillRouteCacheEntry: null,
    getCurrentRouteCacheVersion: null,
    getCurrentSegmentCacheVersion: null,
    getStaleAt: null,
    getStaleTimeMs: null,
    invalidateEntirePrefetchCache: null,
    invalidateRouteCacheEntries: null,
    invalidateSegmentCacheEntries: null,
    markRouteEntryAsDynamicRewrite: null,
    overwriteRevalidatingSegmentCacheEntry: null,
    pingInvalidationListeners: null,
    processRuntimePrefetchStream: null,
    readOrCreateRevalidatingSegmentEntry: null,
    readOrCreateRouteCacheEntry: null,
    readOrCreateSegmentCacheEntry: null,
    readRouteCacheEntry: null,
    readSegmentCacheEntry: null,
    stripIsPartialByte: null,
    upgradeToPendingSegment: null,
    upsertSegmentEntry: null,
    waitForSegmentCacheEntry: null,
    writeDynamicRenderResponseIntoCache: null,
    writeRouteIntoCache: null,
    writeStaticStageResponseIntoCache: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    EntryStatus: function() {
        return EntryStatus;
    },
    attemptToFulfillDynamicSegmentFromBFCache: function() {
        return attemptToFulfillDynamicSegmentFromBFCache;
    },
    attemptToUpgradeSegmentFromBFCache: function() {
        return attemptToUpgradeSegmentFromBFCache;
    },
    canNewFetchStrategyProvideMoreContent: function() {
        return canNewFetchStrategyProvideMoreContent;
    },
    convertReusedFlightRouterStateToRouteTree: function() {
        return convertReusedFlightRouterStateToRouteTree;
    },
    convertRootFlightRouterStateToRouteTree: function() {
        return convertRootFlightRouterStateToRouteTree;
    },
    convertRouteTreeToFlightRouterState: function() {
        return convertRouteTreeToFlightRouterState;
    },
    createDetachedSegmentCacheEntry: function() {
        return createDetachedSegmentCacheEntry;
    },
    createMetadataRouteTree: function() {
        return createMetadataRouteTree;
    },
    deprecated_requestOptimisticRouteCacheEntry: function() {
        return deprecated_requestOptimisticRouteCacheEntry;
    },
    fetchInlinedSegmentsOnCacheMiss: function() {
        return fetchInlinedSegmentsOnCacheMiss;
    },
    fetchRouteOnCacheMiss: function() {
        return fetchRouteOnCacheMiss;
    },
    fetchSegmentOnCacheMiss: function() {
        return fetchSegmentOnCacheMiss;
    },
    fetchSegmentPrefetchesUsingDynamicRequest: function() {
        return fetchSegmentPrefetchesUsingDynamicRequest;
    },
    fulfillRouteCacheEntry: function() {
        return fulfillRouteCacheEntry;
    },
    getCurrentRouteCacheVersion: function() {
        return getCurrentRouteCacheVersion;
    },
    getCurrentSegmentCacheVersion: function() {
        return getCurrentSegmentCacheVersion;
    },
    getStaleAt: function() {
        return getStaleAt;
    },
    getStaleTimeMs: function() {
        return getStaleTimeMs;
    },
    invalidateEntirePrefetchCache: function() {
        return invalidateEntirePrefetchCache;
    },
    invalidateRouteCacheEntries: function() {
        return invalidateRouteCacheEntries;
    },
    invalidateSegmentCacheEntries: function() {
        return invalidateSegmentCacheEntries;
    },
    markRouteEntryAsDynamicRewrite: function() {
        return markRouteEntryAsDynamicRewrite;
    },
    overwriteRevalidatingSegmentCacheEntry: function() {
        return overwriteRevalidatingSegmentCacheEntry;
    },
    pingInvalidationListeners: function() {
        return pingInvalidationListeners;
    },
    processRuntimePrefetchStream: function() {
        return processRuntimePrefetchStream;
    },
    readOrCreateRevalidatingSegmentEntry: function() {
        return readOrCreateRevalidatingSegmentEntry;
    },
    readOrCreateRouteCacheEntry: function() {
        return readOrCreateRouteCacheEntry;
    },
    readOrCreateSegmentCacheEntry: function() {
        return readOrCreateSegmentCacheEntry;
    },
    readRouteCacheEntry: function() {
        return readRouteCacheEntry;
    },
    readSegmentCacheEntry: function() {
        return readSegmentCacheEntry;
    },
    stripIsPartialByte: function() {
        return stripIsPartialByte;
    },
    upgradeToPendingSegment: function() {
        return upgradeToPendingSegment;
    },
    upsertSegmentEntry: function() {
        return upsertSegmentEntry;
    },
    waitForSegmentCacheEntry: function() {
        return waitForSegmentCacheEntry;
    },
    writeDynamicRenderResponseIntoCache: function() {
        return writeDynamicRenderResponseIntoCache;
    },
    writeRouteIntoCache: function() {
        return writeRouteIntoCache;
    },
    writeStaticStageResponseIntoCache: function() {
        return writeStaticStageResponseIntoCache;
    }
});
const _varyparamsdecoding = require("../../../shared/lib/segment-cache/vary-params-decoding");
const _approuterheaders = require("../app-router-headers");
const _fetchserverresponse = require("../router-reducer/fetch-server-response");
const _scheduler = require("./scheduler");
const _varypath = require("./vary-path");
const _createhreffromurl = require("../router-reducer/create-href-from-url");
const _cachekey = require("./cache-key");
const _routeparams = require("../../route-params");
const _cachemap = require("./cache-map");
const _segmentvalueencoding = require("../../../shared/lib/segment-cache/segment-value-encoding");
const _flightdatahelpers = require("../../flight-data-helpers");
const _navigatereducer = require("../router-reducer/reducers/navigate-reducer");
const _links = require("../links");
const _segment = require("../../../shared/lib/segment");
const _types = require("./types");
const _promisewithresolvers = require("../../../shared/lib/promise-with-resolvers");
const _bfcache = require("./bfcache");
const _optimisticroutes = require("./optimistic-routes");
const _navigation = require("./navigation");
const _navigationbuildid = require("../../navigation-build-id");
const _constants = require("../../../lib/constants");
function getStaleTimeMs(staleTimeSeconds) {
    return Math.max(staleTimeSeconds, 30) * 1000;
}
var EntryStatus = /*#__PURE__*/ function(EntryStatus) {
    EntryStatus[EntryStatus["Empty"] = 0] = "Empty";
    EntryStatus[EntryStatus["Pending"] = 1] = "Pending";
    EntryStatus[EntryStatus["Fulfilled"] = 2] = "Fulfilled";
    EntryStatus[EntryStatus["Rejected"] = 3] = "Rejected";
    return EntryStatus;
}({});
const isOutputExportMode = process.env.NODE_ENV === 'production' && process.env.__NEXT_CONFIG_OUTPUT === 'export';
const MetadataOnlyRequestTree = [
    '',
    {},
    null,
    'metadata-only'
];
let routeCacheMap = (0, _cachemap.createCacheMap)();
let segmentCacheMap = (0, _cachemap.createCacheMap)();
// All invalidation listeners for the whole cache are tracked in single set.
// Since we don't yet support tag or path-based invalidation, there's no point
// tracking them any more granularly than this. Once we add granular
// invalidation, that may change, though generally the model is to just notify
// the listeners and allow the caller to poll the prefetch cache with a new
// prefetch task if desired.
let invalidationListeners = null;
// Incrementing counters used to track cache invalidations. Route and segment
// caches have separate versions so they can be invalidated independently.
// Invalidation does not eagerly evict anything from the cache; entries are
// lazily evicted when read.
let currentRouteCacheVersion = 0;
let currentSegmentCacheVersion = 0;
function getCurrentRouteCacheVersion() {
    return currentRouteCacheVersion;
}
function getCurrentSegmentCacheVersion() {
    return currentSegmentCacheVersion;
}
function invalidateEntirePrefetchCache(nextUrl, tree) {
    currentRouteCacheVersion++;
    currentSegmentCacheVersion++;
    (0, _links.pingVisibleLinks)(nextUrl, tree);
    pingInvalidationListeners(nextUrl, tree);
}
function invalidateRouteCacheEntries(nextUrl, tree) {
    currentRouteCacheVersion++;
    (0, _links.pingVisibleLinks)(nextUrl, tree);
    pingInvalidationListeners(nextUrl, tree);
}
function invalidateSegmentCacheEntries(nextUrl, tree) {
    currentSegmentCacheVersion++;
    (0, _links.pingVisibleLinks)(nextUrl, tree);
    pingInvalidationListeners(nextUrl, tree);
}
function attachInvalidationListener(task) {
    // This function is called whenever a prefetch task reads a cache entry. If
    // the task has an onInvalidate function associated with it — i.e. the one
    // optionally passed to router.prefetch(onInvalidate) — then we attach that
    // listener to the every cache entry that the task reads. Then, if an entry
    // is invalidated, we call the function.
    if (task.onInvalidate !== null) {
        if (invalidationListeners === null) {
            invalidationListeners = new Set([
                task
            ]);
        } else {
            invalidationListeners.add(task);
        }
    }
}
function notifyInvalidationListener(task) {
    const onInvalidate = task.onInvalidate;
    if (onInvalidate !== null) {
        // Clear the callback from the task object to guarantee it's not called more
        // than once.
        task.onInvalidate = null;
        // This is a user-space function, so we must wrap in try/catch.
        try {
            onInvalidate();
        } catch (error) {
            if (typeof reportError === 'function') {
                reportError(error);
            } else {
                console.error(error);
            }
        }
    }
}
function pingInvalidationListeners(nextUrl, tree) {
    // The rough equivalent of pingVisibleLinks, but for onInvalidate callbacks.
    // This is called when the Next-Url or the base tree changes, since those
    // may affect the result of a prefetch task. It's also called after a
    // cache invalidation.
    if (invalidationListeners !== null) {
        const tasks = invalidationListeners;
        invalidationListeners = null;
        for (const task of tasks){
            if ((0, _scheduler.isPrefetchTaskDirty)(task, nextUrl, tree)) {
                notifyInvalidationListener(task);
            }
        }
    }
}
function readRouteCacheEntry(now, key) {
    const varyPath = (0, _varypath.getRouteVaryPath)(key.pathname, key.search, key.nextUrl);
    const isRevalidation = false;
    const existingEntry = (0, _cachemap.getFromCacheMap)(now, getCurrentRouteCacheVersion(), routeCacheMap, varyPath, isRevalidation);
    if (existingEntry !== null) {
        return existingEntry;
    }
    // No cache hit. Attempt to construct from template using the new
    // optimistic routing mechanism (pattern-based matching).
    if (process.env.__NEXT_OPTIMISTIC_ROUTING) {
        return (0, _optimisticroutes.matchKnownRoute)(key.pathname, key.search);
    }
    return null;
}
function readSegmentCacheEntry(now, varyPath) {
    const isRevalidation = false;
    return (0, _cachemap.getFromCacheMap)(now, getCurrentSegmentCacheVersion(), segmentCacheMap, varyPath, isRevalidation);
}
function readRevalidatingSegmentCacheEntry(now, varyPath) {
    const isRevalidation = true;
    return (0, _cachemap.getFromCacheMap)(now, getCurrentSegmentCacheVersion(), segmentCacheMap, varyPath, isRevalidation);
}
function waitForSegmentCacheEntry(pendingEntry) {
    // Because the entry is pending, there's already a in-progress request.
    // Attach a promise to the entry that will resolve when the server responds.
    let promiseWithResolvers = pendingEntry.promise;
    if (promiseWithResolvers === null) {
        promiseWithResolvers = pendingEntry.promise = (0, _promisewithresolvers.createPromiseWithResolvers)();
    } else {
    // There's already a promise we can use
    }
    return promiseWithResolvers.promise;
}
function createDetachedRouteCacheEntry() {
    return {
        canonicalUrl: null,
        status: 0,
        blockedTasks: null,
        tree: null,
        metadata: null,
        // This is initialized to true because we don't know yet whether the route
        // could be intercepted. It's only set to false once we receive a response
        // from the server.
        couldBeIntercepted: true,
        // Similarly, we don't yet know if the route supports PPR.
        supportsPerSegmentPrefetching: false,
        renderedSearch: null,
        // Map-related fields
        ref: null,
        size: 0,
        // Since this is an empty entry, there's no reason to ever evict it. It will
        // be updated when the data is populated.
        staleAt: Infinity,
        version: getCurrentRouteCacheVersion()
    };
}
function readOrCreateRouteCacheEntry(now, task, key) {
    attachInvalidationListener(task);
    const existingEntry = readRouteCacheEntry(now, key);
    if (existingEntry !== null) {
        return existingEntry;
    }
    // Create a pending entry and add it to the cache.
    const pendingEntry = createDetachedRouteCacheEntry();
    const varyPath = (0, _varypath.getRouteVaryPath)(key.pathname, key.search, key.nextUrl);
    const isRevalidation = false;
    (0, _cachemap.setInCacheMap)(routeCacheMap, varyPath, pendingEntry, isRevalidation);
    return pendingEntry;
}
function deprecated_requestOptimisticRouteCacheEntry(now, requestedUrl, nextUrl) {
    // This function is called during a navigation when there was no matching
    // route tree in the prefetch cache. Before de-opting to a blocking,
    // unprefetched navigation, we will first attempt to construct an "optimistic"
    // route tree by checking the cache for similar routes.
    //
    // Check if there's a route with the same pathname, but with different
    // search params. We can then base our optimistic route tree on this entry.
    //
    // Conceptually, we are simulating what would happen if we did perform a
    // prefetch the requested URL, under the assumption that the server will
    // not redirect or rewrite the request in a different manner than the
    // base route tree. This assumption might not hold, in which case we'll have
    // to recover when we perform the dynamic navigation request. However, this
    // is what would happen if a route were dynamically rewritten/redirected
    // in between the prefetch and the navigation. So the logic needs to exist
    // to handle this case regardless.
    // Look for a route with the same pathname, but with an empty search string.
    // TODO: There's nothing inherently special about the empty search string;
    // it's chosen somewhat arbitrarily, with the rationale that it's the most
    // likely one to exist. But we should update this to match _any_ search
    // string. The plan is to generalize this logic alongside other improvements
    // related to "fallback" cache entries.
    const requestedSearch = requestedUrl.search;
    if (requestedSearch === '') {
        // The caller would have already checked if a route with an empty search
        // string is in the cache. So we can bail out here.
        return null;
    }
    const urlWithoutSearchParams = new URL(requestedUrl);
    urlWithoutSearchParams.search = '';
    const routeWithNoSearchParams = readRouteCacheEntry(now, (0, _cachekey.createCacheKey)(urlWithoutSearchParams.href, nextUrl));
    if (routeWithNoSearchParams === null || routeWithNoSearchParams.status !== 2) {
        // Bail out of constructing an optimistic route tree. This will result in
        // a blocking, unprefetched navigation.
        return null;
    }
    // Now we have a base route tree we can "patch" with our optimistic values.
    // Optimistically assume that redirects for the requested pathname do
    // not vary on the search string. Therefore, if the base route was
    // redirected to a different search string, then the optimistic route
    // should be redirected to the same search string. Otherwise, we use
    // the requested search string.
    const canonicalUrlForRouteWithNoSearchParams = new URL(routeWithNoSearchParams.canonicalUrl, requestedUrl.origin);
    const optimisticCanonicalSearch = canonicalUrlForRouteWithNoSearchParams.search !== '' ? canonicalUrlForRouteWithNoSearchParams.search : requestedSearch;
    // Similarly, optimistically assume that rewrites for the requested
    // pathname do not vary on the search string. Therefore, if the base
    // route was rewritten to a different search string, then the optimistic
    // route should be rewritten to the same search string. Otherwise, we use
    // the requested search string.
    const optimisticRenderedSearch = routeWithNoSearchParams.renderedSearch !== '' ? routeWithNoSearchParams.renderedSearch : requestedSearch;
    const optimisticUrl = new URL(routeWithNoSearchParams.canonicalUrl, location.origin);
    optimisticUrl.search = optimisticCanonicalSearch;
    const optimisticCanonicalUrl = (0, _createhreffromurl.createHrefFromUrl)(optimisticUrl);
    const optimisticRouteTree = deprecated_createOptimisticRouteTree(routeWithNoSearchParams.tree, optimisticRenderedSearch);
    const optimisticMetadataTree = deprecated_createOptimisticRouteTree(routeWithNoSearchParams.metadata, optimisticRenderedSearch);
    // Clone the base route tree, and override the relevant fields with our
    // optimistic values.
    const optimisticEntry = {
        canonicalUrl: optimisticCanonicalUrl,
        status: 2,
        // This isn't cloned because it's instance-specific
        blockedTasks: null,
        tree: optimisticRouteTree,
        metadata: optimisticMetadataTree,
        couldBeIntercepted: routeWithNoSearchParams.couldBeIntercepted,
        supportsPerSegmentPrefetching: routeWithNoSearchParams.supportsPerSegmentPrefetching,
        hasDynamicRewrite: routeWithNoSearchParams.hasDynamicRewrite,
        // Override the rendered search with the optimistic value.
        renderedSearch: optimisticRenderedSearch,
        // Map-related fields
        ref: null,
        size: 0,
        staleAt: routeWithNoSearchParams.staleAt,
        version: routeWithNoSearchParams.version
    };
    // Do not insert this entry into the cache. It only exists so we can
    // perform the current navigation. Just return it to the caller.
    return optimisticEntry;
}
function deprecated_createOptimisticRouteTree(tree, newRenderedSearch) {
    // Create a new route tree that identical to the original one except for
    // the rendered search string, which is contained in the vary path.
    let clonedSlots = null;
    const originalSlots = tree.slots;
    if (originalSlots !== null) {
        clonedSlots = {};
        for(const parallelRouteKey in originalSlots){
            const childTree = originalSlots[parallelRouteKey];
            clonedSlots[parallelRouteKey] = deprecated_createOptimisticRouteTree(childTree, newRenderedSearch);
        }
    }
    // We only need to clone the vary path if the route is a page.
    if (tree.isPage) {
        return {
            requestKey: tree.requestKey,
            segment: tree.segment,
            refreshState: tree.refreshState,
            varyPath: (0, _varypath.clonePageVaryPathWithNewSearchParams)(tree.varyPath, newRenderedSearch),
            isPage: true,
            slots: clonedSlots,
            prefetchHints: tree.prefetchHints
        };
    }
    return {
        requestKey: tree.requestKey,
        segment: tree.segment,
        refreshState: tree.refreshState,
        varyPath: tree.varyPath,
        isPage: false,
        slots: clonedSlots,
        prefetchHints: tree.prefetchHints
    };
}
function readOrCreateSegmentCacheEntry(now, fetchStrategy, tree) {
    const existingEntry = readSegmentCacheEntry(now, tree.varyPath);
    if (existingEntry !== null) {
        return existingEntry;
    }
    // Create a pending entry and add it to the cache. The stale time is set to a
    // default value; the actual stale time will be set when the entry is
    // fulfilled with data from the server response.
    const varyPathForRequest = (0, _varypath.getSegmentVaryPathForRequest)(fetchStrategy, tree);
    const pendingEntry = createDetachedSegmentCacheEntry(now);
    const isRevalidation = false;
    (0, _cachemap.setInCacheMap)(segmentCacheMap, varyPathForRequest, pendingEntry, isRevalidation);
    return pendingEntry;
}
function readOrCreateRevalidatingSegmentEntry(now, fetchStrategy, tree) {
    // This function is called when we've already confirmed that a particular
    // segment is cached, but we want to perform another request anyway in case it
    // returns more complete and/or fresher data than we already have. The logic
    // for deciding whether to replace the existing entry is handled elsewhere;
    // this function just handles retrieving a cache entry that we can use to
    // track the revalidation.
    //
    // The reason revalidations are stored in the cache is because we need to be
    // able to dedupe multiple revalidation requests. The reason they have to be
    // handled specially is because we shouldn't overwrite a "normal" entry if
    // one exists at the same keypath. So, for each internal cache location, there
    // is a special "revalidation" slot that is used solely for this purpose.
    //
    // You can think of it as if all the revalidation entries were stored in a
    // separate cache map from the canonical entries, and then transfered to the
    // canonical cache map once the request is complete — this isn't how it's
    // actually implemented, since it's more efficient to store them in the same
    // data structure as the normal entries, but that's how it's modeled
    // conceptually.
    // TODO: Once we implement Fallback behavior for params, where an entry is
    // re-keyed based on response information, we'll need to account for the
    // possibility that the keypath of the previous entry is more generic than
    // the keypath of the revalidating entry. In other words, the server could
    // return a less generic entry upon revalidation. For now, though, this isn't
    // a concern because the keypath is based solely on the prefetch strategy,
    // not on data contained in the response.
    const existingEntry = readRevalidatingSegmentCacheEntry(now, tree.varyPath);
    if (existingEntry !== null) {
        return existingEntry;
    }
    // Create a pending entry and add it to the cache. The stale time is set to a
    // default value; the actual stale time will be set when the entry is
    // fulfilled with data from the server response.
    const varyPathForRequest = (0, _varypath.getSegmentVaryPathForRequest)(fetchStrategy, tree);
    const pendingEntry = createDetachedSegmentCacheEntry(now);
    const isRevalidation = true;
    (0, _cachemap.setInCacheMap)(segmentCacheMap, varyPathForRequest, pendingEntry, isRevalidation);
    return pendingEntry;
}
function overwriteRevalidatingSegmentCacheEntry(now, fetchStrategy, tree) {
    // This function is called when we've already decided to replace an existing
    // revalidation entry. Create a new entry and write it into the cache,
    // overwriting the previous value. The stale time is set to a default value;
    // the actual stale time will be set when the entry is fulfilled with data
    // from the server response.
    const varyPathForRequest = (0, _varypath.getSegmentVaryPathForRequest)(fetchStrategy, tree);
    const pendingEntry = createDetachedSegmentCacheEntry(now);
    const isRevalidation = true;
    (0, _cachemap.setInCacheMap)(segmentCacheMap, varyPathForRequest, pendingEntry, isRevalidation);
    return pendingEntry;
}
function upsertSegmentEntry(now, varyPath, candidateEntry) {
    // We have a new entry that has not yet been inserted into the cache. Before
    // we do so, we need to confirm whether it takes precedence over the existing
    // entry (if one exists).
    // TODO: We should not upsert an entry if its key was invalidated in the time
    // since the request was made. We can do that by passing the "owner" entry to
    // this function and confirming it's the same as `existingEntry`.
    if ((0, _cachemap.isValueExpired)(now, getCurrentSegmentCacheVersion(), candidateEntry)) {
        // The entry is expired. We cannot upsert it.
        return null;
    }
    const existingEntry = readSegmentCacheEntry(now, varyPath);
    if (existingEntry !== null) {
        // Don't replace a more specific segment with a less-specific one. A case where this
        // might happen is if the existing segment was fetched via
        // `<Link prefetch={true}>`.
        if (// We fetched the new segment using a different, less specific fetch strategy
        // than the segment we already have in the cache, so it can't have more content.
        candidateEntry.fetchStrategy !== existingEntry.fetchStrategy && !canNewFetchStrategyProvideMoreContent(existingEntry.fetchStrategy, candidateEntry.fetchStrategy) || // The existing entry isn't partial, but the new one is.
        // (TODO: can this be true if `candidateEntry.fetchStrategy >= existingEntry.fetchStrategy`?)
        !existingEntry.isPartial && candidateEntry.isPartial) {
            // We're going to leave revalidating entry in the cache so that it doesn't
            // get revalidated again unnecessarily. Downgrade the Fulfilled entry to
            // Rejected and null out the data so it can be garbage collected. We leave
            // `staleAt` intact to prevent subsequent revalidation attempts only until
            // the entry expires.
            const rejectedEntry = candidateEntry;
            rejectedEntry.status = 3;
            rejectedEntry.rsc = null;
            return null;
        }
        // Evict the existing entry from the cache.
        (0, _cachemap.deleteFromCacheMap)(existingEntry);
    }
    const isRevalidation = false;
    (0, _cachemap.setInCacheMap)(segmentCacheMap, varyPath, candidateEntry, isRevalidation);
    return candidateEntry;
}
function createDetachedSegmentCacheEntry(now) {
    // Default stale time for pending segment cache entries. The actual stale time
    // is set when the entry is fulfilled with data from the server response.
    const staleAt = now + 30 * 1000;
    const emptyEntry = {
        status: 0,
        // Default to assuming the fetch strategy will be PPR. This will be updated
        // when a fetch is actually initiated.
        fetchStrategy: _types.FetchStrategy.PPR,
        rsc: null,
        isPartial: true,
        promise: null,
        // Map-related fields
        ref: null,
        size: 0,
        staleAt,
        version: 0
    };
    return emptyEntry;
}
function upgradeToPendingSegment(emptyEntry, fetchStrategy) {
    const pendingEntry = emptyEntry;
    pendingEntry.status = 1;
    pendingEntry.fetchStrategy = fetchStrategy;
    if (fetchStrategy === _types.FetchStrategy.Full) {
        // We can assume the response will contain the full segment data. Set this
        // to false so we know it's OK to omit this segment from any navigation
        // requests that may happen while the data is still pending.
        pendingEntry.isPartial = false;
    }
    // Set the version here, since this is right before the request is initiated.
    // The next time the segment cache version is incremented, the entry will
    // effectively be evicted. This happens before initiating the request, rather
    // than when receiving the response, because it's guaranteed to happen
    // before the data is read on the server.
    pendingEntry.version = getCurrentSegmentCacheVersion();
    return pendingEntry;
}
function attemptToFulfillDynamicSegmentFromBFCache(now, segment, tree) {
    // Attempts to fulfill an empty segment cache entry using data from the
    // bfcache. This is only valid during a Full prefetch (i.e. one that includes
    // dynamic data), because the bfcache stores data from navigations which
    // always include dynamic data.
    // We always use the canonical vary path when checking the bfcache. This is
    // the same operation we'd use to access the cache during a
    // regular navigation.
    const varyPath = tree.varyPath;
    // Read from the BFCache without expiring it (pass -1). We check freshness
    // ourselves using navigatedAt, because the BFCache's staleAt may have been
    // overridden by a per-page unstable_dynamicStaleTime and can't be used to
    // derive the original request time.
    const bfcacheEntry = (0, _bfcache.readFromBFCache)(varyPath);
    if (bfcacheEntry !== null) {
        // The stale time for dynamic prefetches (default: 5 mins) is different
        // from the stale time for regular navigations (default: 0 secs). Use
        // navigatedAt to compute the correct expiry for prefetch purposes.
        const dynamicPrefetchStaleAt = bfcacheEntry.navigatedAt + _navigatereducer.STATIC_STALETIME_MS;
        if (now > dynamicPrefetchStaleAt) {
            return null;
        }
        const pendingSegment = upgradeToPendingSegment(segment, _types.FetchStrategy.Full);
        const isPartial = false;
        return fulfillSegmentCacheEntry(pendingSegment, bfcacheEntry.rsc, dynamicPrefetchStaleAt, isPartial);
    }
    return null;
}
function attemptToUpgradeSegmentFromBFCache(now, tree) {
    const varyPath = tree.varyPath;
    const bfcacheEntry = (0, _bfcache.readFromBFCache)(varyPath);
    if (bfcacheEntry !== null) {
        const dynamicPrefetchStaleAt = bfcacheEntry.navigatedAt + _navigatereducer.STATIC_STALETIME_MS;
        if (now > dynamicPrefetchStaleAt) {
            return null;
        }
        const pendingSegment = upgradeToPendingSegment(createDetachedSegmentCacheEntry(now), _types.FetchStrategy.Full);
        const isPartial = false;
        const newEntry = fulfillSegmentCacheEntry(pendingSegment, bfcacheEntry.rsc, dynamicPrefetchStaleAt, isPartial);
        const segmentVaryPath = (0, _varypath.getSegmentVaryPathForRequest)(_types.FetchStrategy.Full, tree);
        const upserted = upsertSegmentEntry(now, segmentVaryPath, newEntry);
        if (upserted !== null && upserted.status === 2) {
            return upserted;
        }
    }
    return null;
}
function pingBlockedTasks(entry) {
    const blockedTasks = entry.blockedTasks;
    if (blockedTasks !== null) {
        for (const task of blockedTasks){
            (0, _scheduler.pingPrefetchTask)(task);
        }
        entry.blockedTasks = null;
    }
}
function createMetadataRouteTree(metadataVaryPath) {
    // The Head is not actually part of the route tree, but other than that, it's
    // fetched and cached like a segment. Some functions expect a RouteTree
    // object, so rather than fork the logic in all those places, we use this
    // "fake" one.
    const metadata = {
        requestKey: _segmentvalueencoding.HEAD_REQUEST_KEY,
        segment: _segmentvalueencoding.HEAD_REQUEST_KEY,
        refreshState: null,
        varyPath: metadataVaryPath,
        // The metadata isn't really a "page" (though it isn't really a "segment"
        // either) but for the purposes of how this field is used, it behaves like
        // one. If this logic ever gets more complex we can change this to an enum.
        isPage: true,
        slots: null,
        prefetchHints: 0
    };
    return metadata;
}
function fulfillRouteCacheEntry(now, entry, tree, metadataVaryPath, couldBeIntercepted, canonicalUrl, supportsPerSegmentPrefetching) {
    // Get the rendered search from the vary path
    const renderedSearch = (0, _varypath.getRenderedSearchFromVaryPath)(metadataVaryPath) ?? '';
    const fulfilledEntry = entry;
    fulfilledEntry.status = 2;
    fulfilledEntry.tree = tree;
    fulfilledEntry.metadata = createMetadataRouteTree(metadataVaryPath);
    // Route structure is essentially static — it only changes on deploy.
    // Always use the static stale time.
    // NOTE: An exception is rewrites/redirects in middleware or proxy, which can
    // change routes dynamically. We have other strategies for handling those.
    fulfilledEntry.staleAt = now + _navigatereducer.STATIC_STALETIME_MS;
    fulfilledEntry.couldBeIntercepted = couldBeIntercepted;
    fulfilledEntry.canonicalUrl = canonicalUrl;
    fulfilledEntry.renderedSearch = renderedSearch;
    fulfilledEntry.supportsPerSegmentPrefetching = supportsPerSegmentPrefetching;
    fulfilledEntry.hasDynamicRewrite = false;
    pingBlockedTasks(entry);
    return fulfilledEntry;
}
function writeRouteIntoCache(now, pathname, nextUrl, tree, metadataVaryPath, couldBeIntercepted, canonicalUrl, supportsPerSegmentPrefetching) {
    const pendingEntry = createDetachedRouteCacheEntry();
    const fulfilledEntry = fulfillRouteCacheEntry(now, pendingEntry, tree, metadataVaryPath, couldBeIntercepted, canonicalUrl, supportsPerSegmentPrefetching);
    const renderedSearch = fulfilledEntry.renderedSearch;
    const varyPath = (0, _varypath.getFulfilledRouteVaryPath)(pathname, renderedSearch, nextUrl, couldBeIntercepted);
    const isRevalidation = false;
    (0, _cachemap.setInCacheMap)(routeCacheMap, varyPath, fulfilledEntry, isRevalidation);
    return fulfilledEntry;
}
function markRouteEntryAsDynamicRewrite(entry) {
    entry.hasDynamicRewrite = true;
// Note: The caller is responsible for also calling invalidateRouteCacheEntries
// to invalidate other entries that may have been derived from this template
// before we knew it had a dynamic rewrite.
}
function fulfillSegmentCacheEntry(segmentCacheEntry, rsc, staleAt, isPartial) {
    const fulfilledEntry = segmentCacheEntry;
    fulfilledEntry.status = 2;
    fulfilledEntry.rsc = rsc;
    fulfilledEntry.staleAt = staleAt;
    fulfilledEntry.isPartial = isPartial;
    // Resolve any listeners that were waiting for this data.
    if (segmentCacheEntry.promise !== null) {
        segmentCacheEntry.promise.resolve(fulfilledEntry);
        // Free the promise for garbage collection.
        fulfilledEntry.promise = null;
    }
    return fulfilledEntry;
}
function rejectRouteCacheEntry(entry, staleAt) {
    const rejectedEntry = entry;
    rejectedEntry.status = 3;
    rejectedEntry.staleAt = staleAt;
    pingBlockedTasks(entry);
}
function rejectSegmentCacheEntry(entry, staleAt) {
    const rejectedEntry = entry;
    rejectedEntry.status = 3;
    rejectedEntry.staleAt = staleAt;
    if (entry.promise !== null) {
        // NOTE: We don't currently propagate the reason the prefetch was canceled
        // but we could by accepting a `reason` argument.
        entry.promise.resolve(null);
        entry.promise = null;
    }
}
function convertRootTreePrefetchToRouteTree(rootTree, renderedPathname, renderedSearch, acc) {
    // Remove trailing and leading slashes
    const pathnameParts = renderedPathname.split('/').filter((p)=>p !== '');
    const index = 0;
    const rootSegment = _segmentvalueencoding.ROOT_SEGMENT_REQUEST_KEY;
    return convertTreePrefetchToRouteTree(rootTree.tree, rootSegment, null, _segmentvalueencoding.ROOT_SEGMENT_REQUEST_KEY, pathnameParts, index, renderedSearch, acc);
}
function convertTreePrefetchToRouteTree(prefetch, segment, partialVaryPath, requestKey, pathnameParts, pathnamePartsIndex, renderedSearch, acc) {
    // Converts the route tree sent by the server into the format used by the
    // cache. The cached version of the tree includes additional fields, such as a
    // cache key for each segment. Since this is frequently accessed, we compute
    // it once instead of on every access. This same cache key is also used to
    // request the segment from the server.
    let slots = null;
    let isPage;
    let varyPath;
    const prefetchSlots = prefetch.slots;
    if (prefetchSlots !== null) {
        isPage = false;
        varyPath = (0, _varypath.finalizeLayoutVaryPath)(requestKey, partialVaryPath);
        slots = {};
        for(let parallelRouteKey in prefetchSlots){
            const childPrefetch = prefetchSlots[parallelRouteKey];
            const childSegmentName = childPrefetch.name;
            const childParam = childPrefetch.param;
            let childDoesAppearInURL;
            let childSegment;
            let childPartialVaryPath;
            if (childParam !== null) {
                // This segment is parameterized. Get the param from the pathname.
                const childParamValue = (0, _routeparams.parseDynamicParamFromURLPart)(childParam.type, pathnameParts, pathnamePartsIndex);
                // Assign a cache key to the segment, based on the param value. In the
                // pre-Segment Cache implementation, the server computes this and sends
                // it in the body of the response. In the Segment Cache implementation,
                // the server sends an empty string and we fill it in here.
                // TODO: We're intentionally not adding the search param to page
                // segments here; it's tracked separately and added back during a read.
                // This would clearer if we waited to construct the segment until it's
                // read from the cache, since that's effectively what we're
                // doing anyway.
                const childParamKey = // The server omits this field from the prefetch response when
                // cacheComponents is enabled.
                childParam.key !== null ? childParam.key : (0, _routeparams.getCacheKeyForDynamicParam)(childParamValue, '');
                childPartialVaryPath = (0, _varypath.appendLayoutVaryPath)(partialVaryPath, childParamKey, childSegmentName);
                childSegment = [
                    childSegmentName,
                    childParamKey,
                    childParam.type,
                    childParam.siblings
                ];
                childDoesAppearInURL = true;
            } else {
                // This segment does not have a param. Inherit the partial vary path of
                // the parent.
                childPartialVaryPath = partialVaryPath;
                childSegment = childSegmentName;
                childDoesAppearInURL = (0, _routeparams.doesStaticSegmentAppearInURL)(childSegmentName);
            }
            // Only increment the index if the segment appears in the URL. If it's a
            // "virtual" segment, like a route group, it remains the same.
            const childPathnamePartsIndex = childDoesAppearInURL ? pathnamePartsIndex + 1 : pathnamePartsIndex;
            const childRequestKeyPart = (0, _segmentvalueencoding.createSegmentRequestKeyPart)(childSegment);
            const childRequestKey = (0, _segmentvalueencoding.appendSegmentRequestKeyPart)(requestKey, parallelRouteKey, childRequestKeyPart);
            slots[parallelRouteKey] = convertTreePrefetchToRouteTree(childPrefetch, childSegment, childPartialVaryPath, childRequestKey, pathnameParts, childPathnamePartsIndex, renderedSearch, acc);
        }
    } else {
        if (requestKey.endsWith(_segment.PAGE_SEGMENT_KEY)) {
            // This is a page segment.
            isPage = true;
            varyPath = (0, _varypath.finalizePageVaryPath)(requestKey, renderedSearch, partialVaryPath);
            // The metadata "segment" is not part the route tree, but it has the same
            // conceptual params as a page segment. Write the vary path into the
            // accumulator object. If there are multiple parallel pages, we use the
            // first one. Which page we choose is arbitrary as long as it's
            // consistently the same one every time every time. See
            // finalizeMetadataVaryPath for more details.
            if (acc.metadataVaryPath === null) {
                acc.metadataVaryPath = (0, _varypath.finalizeMetadataVaryPath)(requestKey, renderedSearch, partialVaryPath);
            }
        } else {
            // This is a layout segment.
            isPage = false;
            varyPath = (0, _varypath.finalizeLayoutVaryPath)(requestKey, partialVaryPath);
        }
    }
    return {
        requestKey,
        segment,
        refreshState: null,
        // TODO: Cheating the type system here a bit because TypeScript can't tell
        // that the type of isPage and varyPath are consistent. The fix would be to
        // create separate constructors and call the appropriate one from each of
        // the branches above. Just seems a bit overkill only for one field so I'll
        // leave it as-is for now. If isPage were wrong it would break the behavior
        // and we'd catch it quickly, anyway.
        varyPath: varyPath,
        isPage: isPage,
        slots,
        prefetchHints: prefetch.prefetchHints
    };
}
function convertRootFlightRouterStateToRouteTree(flightRouterState, renderedSearch, acc) {
    return convertFlightRouterStateToRouteTree(flightRouterState, _segmentvalueencoding.ROOT_SEGMENT_REQUEST_KEY, null, renderedSearch, acc);
}
function convertReusedFlightRouterStateToRouteTree(parentRouteTree, parallelRouteKey, flightRouterState, renderedSearch, acc) {
    // Create a RouteTree for a FlightRouterState that was reused from an older
    // route. This happens during a navigation when a parallel route slot does not
    // match the target route; we reuse whatever slot was already active.
    // Unlike a FlightRouterState, the RouteTree type contains backreferences to
    // the parent segments. Append the vary path to the parent's vary path.
    const parentPartialVaryPath = parentRouteTree.isPage ? (0, _varypath.getPartialPageVaryPath)(parentRouteTree.varyPath) : (0, _varypath.getPartialLayoutVaryPath)(parentRouteTree.varyPath);
    const segment = flightRouterState[0];
    // And the request key.
    const parentRequestKey = parentRouteTree.requestKey;
    const requestKeyPart = (0, _segmentvalueencoding.createSegmentRequestKeyPart)(segment);
    const requestKey = (0, _segmentvalueencoding.appendSegmentRequestKeyPart)(parentRequestKey, parallelRouteKey, requestKeyPart);
    return convertFlightRouterStateToRouteTree(flightRouterState, requestKey, parentPartialVaryPath, renderedSearch, acc);
}
function convertFlightRouterStateToRouteTree(flightRouterState, requestKey, parentPartialVaryPath, parentRenderedSearch, acc) {
    const originalSegment = flightRouterState[0];
    // If the FlightRouterState has a refresh state, then this segment is part of
    // an inactive parallel route. It has a different rendered search query than
    // the outer parent route. In order to construct the inactive route correctly,
    // we must restore the query that was originally used to render it.
    const compressedRefreshState = flightRouterState[2] ?? null;
    const refreshState = compressedRefreshState !== null ? {
        canonicalUrl: compressedRefreshState[0],
        renderedSearch: compressedRefreshState[1]
    } : null;
    const renderedSearch = refreshState !== null ? refreshState.renderedSearch : parentRenderedSearch;
    let segment;
    let partialVaryPath;
    let isPage;
    let varyPath;
    if (Array.isArray(originalSegment)) {
        isPage = false;
        const paramCacheKey = originalSegment[1];
        const paramName = originalSegment[0];
        partialVaryPath = (0, _varypath.appendLayoutVaryPath)(parentPartialVaryPath, paramCacheKey, paramName);
        varyPath = (0, _varypath.finalizeLayoutVaryPath)(requestKey, partialVaryPath);
        segment = originalSegment;
    } else {
        // This segment does not have a param. Inherit the partial vary path of
        // the parent.
        partialVaryPath = parentPartialVaryPath;
        if (requestKey.endsWith(_segment.PAGE_SEGMENT_KEY)) {
            // This is a page segment.
            isPage = true;
            // The navigation implementation expects the search params to be included
            // in the segment. However, in the case of a static response, the search
            // params are omitted. So the client needs to add them back in when reading
            // from the Segment Cache.
            //
            // For consistency, we'll do this for dynamic responses, too.
            //
            // TODO: We should move search params out of FlightRouterState and handle
            // them entirely on the client, similar to our plan for dynamic params.
            segment = _segment.PAGE_SEGMENT_KEY;
            varyPath = (0, _varypath.finalizePageVaryPath)(requestKey, renderedSearch, partialVaryPath);
            // The metadata "segment" is not part the route tree, but it has the same
            // conceptual params as a page segment. Write the vary path into the
            // accumulator object. If there are multiple parallel pages, we use the
            // first one. Which page we choose is arbitrary as long as it's
            // consistently the same one every time every time. See
            // finalizeMetadataVaryPath for more details.
            if (acc.metadataVaryPath === null) {
                acc.metadataVaryPath = (0, _varypath.finalizeMetadataVaryPath)(requestKey, renderedSearch, partialVaryPath);
            }
        } else {
            // This is a layout segment.
            isPage = false;
            segment = originalSegment;
            varyPath = (0, _varypath.finalizeLayoutVaryPath)(requestKey, partialVaryPath);
        }
    }
    let slots = null;
    const parallelRoutes = flightRouterState[1];
    for(let parallelRouteKey in parallelRoutes){
        const childRouterState = parallelRoutes[parallelRouteKey];
        const childSegment = childRouterState[0];
        // TODO: Eventually, the param values will not be included in the response
        // from the server. We'll instead fill them in on the client by parsing
        // the URL. This is where we'll do that.
        const childRequestKeyPart = (0, _segmentvalueencoding.createSegmentRequestKeyPart)(childSegment);
        const childRequestKey = (0, _segmentvalueencoding.appendSegmentRequestKeyPart)(requestKey, parallelRouteKey, childRequestKeyPart);
        const childTree = convertFlightRouterStateToRouteTree(childRouterState, childRequestKey, partialVaryPath, renderedSearch, acc);
        if (slots === null) {
            slots = {
                [parallelRouteKey]: childTree
            };
        } else {
            slots[parallelRouteKey] = childTree;
        }
    }
    return {
        requestKey,
        segment,
        refreshState,
        // TODO: Cheating the type system here a bit because TypeScript can't tell
        // that the type of isPage and varyPath are consistent. The fix would be to
        // create separate constructors and call the appropriate one from each of
        // the branches above. Just seems a bit overkill only for one field so I'll
        // leave it as-is for now. If isPage were wrong it would break the behavior
        // and we'd catch it quickly, anyway.
        varyPath: varyPath,
        isPage: isPage,
        slots,
        prefetchHints: flightRouterState[4] ?? 0
    };
}
function convertRouteTreeToFlightRouterState(routeTree) {
    const parallelRoutes = {};
    if (routeTree.slots !== null) {
        for(const parallelRouteKey in routeTree.slots){
            parallelRoutes[parallelRouteKey] = convertRouteTreeToFlightRouterState(routeTree.slots[parallelRouteKey]);
        }
    }
    const flightRouterState = [
        routeTree.segment,
        parallelRoutes,
        null,
        null
    ];
    return flightRouterState;
}
async function fetchRouteOnCacheMiss(entry, key) {
    // This function is allowed to use async/await because it contains the actual
    // fetch that gets issued on a cache miss. Notice it writes the result to the
    // cache entry directly, rather than return data that is then written by
    // the caller.
    const pathname = key.pathname;
    const search = key.search;
    const nextUrl = key.nextUrl;
    const segmentPath = '/_tree';
    const headers = {
        [_approuterheaders.RSC_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER]: segmentPath
    };
    if (nextUrl !== null) {
        headers[_approuterheaders.NEXT_URL] = nextUrl;
    }
    // Tell the server to perform a static pre-render for the Instant Navigation
    // Testing API. Static pre-renders don't normally happen during development.
    addInstantPrefetchHeaderIfLocked(headers);
    try {
        const url = new URL(pathname + search, location.origin);
        let response;
        let urlAfterRedirects;
        if (isOutputExportMode) {
            // In output: "export" mode, we can't use headers to request a particular
            // segment. Instead, we encode the extra request information into the URL.
            // This is not part of the "public" interface of the app; it's an internal
            // Next.js implementation detail that the app developer should not need to
            // concern themselves with.
            //
            // For example, to request a segment:
            //
            //   Path passed to <Link>:   /path/to/page
            //   Path passed to fetch:    /path/to/page/__next-segments/_tree
            //
            //   (This is not the exact protocol, just an illustration.)
            //
            // Before we do that, though, we need to account for redirects. Even in
            // output: "export" mode, a proxy might redirect the page to a different
            // location, but we shouldn't assume or expect that they also redirect all
            // the segment files, too.
            //
            // To check whether the page is redirected, previously we perform a range
            // request of 64 bytes of the HTML document to check if the target page
            // is part of this app (by checking if build id matches). Only if the target
            // page is part of this app do we determine the final canonical URL.
            //
            // However, as mentioned in https://github.com/vercel/next.js/pull/85903,
            // some popular static hosting providers (like Cloudflare Pages or Render.com)
            // do not support range requests, in the worst case, the entire HTML instead
            // of 64 bytes could be returned, which is wasteful.
            //
            // So instead, we drops the check for build id here, and simply perform
            // a HEAD request to rejects 1xx/4xx/5xx responses, and then determine the
            // final URL after redirects.
            //
            // NOTE: We could embed the route tree into the HTML document, to avoid
            // a second request. We're not doing that currently because it would make
            // the HTML document larger and affect normal page loads.
            const headResponse = await fetch(url, {
                method: 'HEAD'
            });
            if (headResponse.status < 200 || headResponse.status >= 400) {
                // The target page responded w/o a successful status code
                // Could be a WAF serving a 403, or a 5xx from a backend
                //
                // Note that we can't use headResponse.ok here, because
                // Response#ok returns `false` with 3xx responses.
                rejectRouteCacheEntry(entry, Date.now() + 10 * 1000);
                return null;
            }
            urlAfterRedirects = headResponse.redirected ? new URL(headResponse.url) : url;
            response = await fetchPrefetchResponse(addSegmentPathToUrlInOutputExportMode(urlAfterRedirects, segmentPath), headers);
        } else {
            // "Server" mode. We can use request headers instead of the pathname.
            // TODO: The eventual plan is to get rid of our custom request headers and
            // encode everything into the URL, using a similar strategy to the
            // "output: export" block above.
            response = await fetchPrefetchResponse(url, headers);
            urlAfterRedirects = response !== null && response.redirected ? new URL(response.url) : url;
        }
        if (!response || !response.ok || // 204 is a Cache miss. Though theoretically this shouldn't happen when
        // PPR is enabled, because we always respond to route tree requests, even
        // if it needs to be blockingly generated on demand.
        response.status === 204 || !response.body) {
            // Server responded with an error, or with a miss. We should still cache
            // the response, but we can try again after 10 seconds.
            rejectRouteCacheEntry(entry, Date.now() + 10 * 1000);
            return null;
        }
        // TODO: The canonical URL is the href without the origin. I think
        // historically the reason for this is because the initial canonical URL
        // gets passed as a prop to the top-level React component, which means it
        // needs to be computed during SSR. If it were to include the origin, it
        // would need to always be same as location.origin on the client, to prevent
        // a hydration mismatch. To sidestep this complexity, we omit the origin.
        //
        // However, since this is neither a native URL object nor a fully qualified
        // URL string, we need to be careful about how we use it. To prevent subtle
        // mistakes, we should create a special type for it, instead of just string.
        // Or, we should just use a (readonly) URL object instead. The type of the
        // prop that we pass to seed the initial state does not need to be the same
        // type as the state itself.
        const canonicalUrl = (0, _createhreffromurl.createHrefFromUrl)(urlAfterRedirects);
        // Check whether the response varies based on the Next-Url header.
        const varyHeader = response.headers.get('vary');
        const couldBeIntercepted = varyHeader !== null && varyHeader.includes(_approuterheaders.NEXT_URL);
        // TODO: The `closed` promise was originally used to track when a streaming
        // network connection closes, so the scheduler could limit concurrent
        // connections. Now that prefetch responses are buffered, `closed` is
        // resolved immediately after buffering — before the outer function even
        // returns. This mechanism is only still meaningful for dynamic (Full)
        // prefetches, which use incremental streaming. Consider removing the
        // `closed` plumbing for buffered prefetch paths.
        const closed = (0, _promisewithresolvers.createPromiseWithResolvers)();
        // This checks whether the response was served from the per-segment cache,
        // rather than the old prefetching flow. If it fails, it implies that PPR
        // is disabled on this route.
        const routeIsPPREnabled = response.headers.get(_approuterheaders.NEXT_DID_POSTPONE_HEADER) === '2' || // In output: "export" mode, we can't rely on response headers. But if we
        // receive a well-formed response, we can assume it's a static response,
        // because all data is static in this mode.
        isOutputExportMode;
        if (routeIsPPREnabled) {
            const { stream: prefetchStream, size: responseSize } = await createNonTaskyPrefetchResponseStream(response.body);
            closed.resolve();
            (0, _cachemap.setSizeInCacheMap)(entry, responseSize);
            const serverData = await (0, _fetchserverresponse.createFromNextReadableStream)(prefetchStream, headers, {
                allowPartialStream: true
            });
            if ((response.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? serverData.buildId) !== (0, _navigationbuildid.getNavigationBuildId)()) {
                // The server build does not match the client. Treat as a 404. During
                // an actual navigation, the router will trigger an MPA navigation.
                // TODO: We should cache the fact that this is an MPA navigation.
                rejectRouteCacheEntry(entry, Date.now() + 10 * 1000);
                return null;
            }
            // Get the params that were used to render the target page. These may
            // be different from the params in the request URL, if the page
            // was rewritten.
            const renderedPathname = (0, _routeparams.getRenderedPathname)(response);
            const renderedSearch = (0, _routeparams.getRenderedSearch)(response);
            // Convert the server-sent data into the RouteTree format used by the
            // client cache.
            //
            // During this traversal, we accumulate additional data into this
            // "accumulator" object.
            const acc = {
                metadataVaryPath: null
            };
            const routeTree = convertRootTreePrefetchToRouteTree(serverData, renderedPathname, renderedSearch, acc);
            const metadataVaryPath = acc.metadataVaryPath;
            if (metadataVaryPath === null) {
                rejectRouteCacheEntry(entry, Date.now() + 10 * 1000);
                return null;
            }
            (0, _optimisticroutes.discoverKnownRoute)(Date.now(), pathname, nextUrl, entry, routeTree, metadataVaryPath, couldBeIntercepted, canonicalUrl, routeIsPPREnabled, false // hasDynamicRewrite
            );
        } else {
            // PPR is not enabled for this route. The server responds with a
            // different format (FlightRouterState) that we need to convert.
            // TODO: We will unify the responses eventually. I'm keeping the types
            // separate for now because FlightRouterState has so many
            // overloaded concerns.
            const { stream: prefetchStream, size: responseSize } = await createNonTaskyPrefetchResponseStream(response.body);
            closed.resolve();
            (0, _cachemap.setSizeInCacheMap)(entry, responseSize);
            const serverData = await (0, _fetchserverresponse.createFromNextReadableStream)(prefetchStream, headers, {
                allowPartialStream: true
            });
            if ((response.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? serverData.b) !== (0, _navigationbuildid.getNavigationBuildId)()) {
                // The server build does not match the client. Treat as a 404. During
                // an actual navigation, the router will trigger an MPA navigation.
                // TODO: We should cache the fact that this is an MPA navigation.
                rejectRouteCacheEntry(entry, Date.now() + 10 * 1000);
                return null;
            }
            // Read head vary params synchronously. Individual segments carry their
            // own thenables in CacheNodeSeedData.
            const headVaryParamsThenable = serverData.h;
            const headVaryParams = headVaryParamsThenable !== null ? (0, _varyparamsdecoding.readVaryParams)(headVaryParamsThenable) : null;
            writeDynamicTreeResponseIntoCache(Date.now(), // The non-PPR response format is what we'd get if we prefetched these segments
            // using the LoadingBoundary fetch strategy, so mark their cache entries accordingly.
            _types.FetchStrategy.LoadingBoundary, response, serverData, entry, couldBeIntercepted, canonicalUrl, routeIsPPREnabled, headVaryParams, pathname, nextUrl);
        }
        if (!couldBeIntercepted) {
            // This route will never be intercepted. So we can use this entry for all
            // requests to this route, regardless of the Next-Url header. This works
            // because when reading the cache we always check for a valid
            // non-intercepted entry first.
            // Re-key the entry. The `set` implementation handles removing it from
            // its previous position in the cache. We don't need to do anything to
            // update the LRU, because the entry is already in it.
            // TODO: Treat this as an upsert — should check if an entry already
            // exists at the new keypath, and if so, whether we should keep that
            // one instead.
            const fulfilledVaryPath = (0, _varypath.getFulfilledRouteVaryPath)(pathname, search, nextUrl, couldBeIntercepted);
            const isRevalidation = false;
            (0, _cachemap.setInCacheMap)(routeCacheMap, fulfilledVaryPath, entry, isRevalidation);
        }
        // Return a promise that resolves when the network connection closes, so
        // the scheduler can track the number of concurrent network connections.
        return {
            value: null,
            closed: closed.promise
        };
    } catch (error) {
        // Either the connection itself failed, or something bad happened while
        // decoding the response.
        rejectRouteCacheEntry(entry, Date.now() + 10 * 1000);
        return null;
    }
}
async function fetchSegmentOnCacheMiss(route, segmentCacheEntry, routeKey, tree) {
    // This function is allowed to use async/await because it contains the actual
    // fetch that gets issued on a cache miss. Notice it writes the result to the
    // cache entry directly, rather than return data that is then written by
    // the caller.
    //
    // Segment fetches are non-blocking so we don't need to ping the scheduler
    // on completion.
    // Use the canonical URL to request the segment, not the original URL. These
    // are usually the same, but the canonical URL will be different if the route
    // tree response was redirected. To avoid an extra waterfall on every segment
    // request, we pass the redirected URL instead of the original one.
    const url = new URL(route.canonicalUrl, location.origin);
    const nextUrl = routeKey.nextUrl;
    const requestKey = tree.requestKey;
    const normalizedRequestKey = requestKey === _segmentvalueencoding.ROOT_SEGMENT_REQUEST_KEY ? // handling of these requests, we encode the root segment path as
    // `_index` instead of as an empty string. This should be treated as
    // an implementation detail and not as a stable part of the protocol.
    // It just needs to match the equivalent logic that happens when
    // prerendering the responses. It should not leak outside of Next.js.
    '/_index' : requestKey;
    const headers = {
        [_approuterheaders.RSC_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER]: normalizedRequestKey
    };
    if (nextUrl !== null) {
        headers[_approuterheaders.NEXT_URL] = nextUrl;
    }
    // Tell the server to perform a static pre-render for the Instant Navigation
    // Testing API. Static pre-renders don't normally happen during development.
    addInstantPrefetchHeaderIfLocked(headers);
    const requestUrl = isOutputExportMode ? addSegmentPathToUrlInOutputExportMode(url, normalizedRequestKey) : url;
    try {
        const response = await fetchPrefetchResponse(requestUrl, headers);
        if (!response || !response.ok || response.status === 204 || // Cache miss
        // This checks whether the response was served from the per-segment cache,
        // rather than the old prefetching flow. If it fails, it implies that PPR
        // is disabled on this route. Theoretically this should never happen
        // because we only issue requests for segments once we've verified that
        // the route supports PPR.
        response.headers.get(_approuterheaders.NEXT_DID_POSTPONE_HEADER) !== '2' && // In output: "export" mode, we can't rely on response headers. But if
        // we receive a well-formed response, we can assume it's a static
        // response, because all data is static in this mode.
        !isOutputExportMode || !response.body) {
            // Server responded with an error, or with a miss. We should still cache
            // the response, but we can try again after 10 seconds.
            rejectSegmentCacheEntry(segmentCacheEntry, Date.now() + 10 * 1000);
            return null;
        }
        // See TODO in fetchRouteOnCacheMiss about removing `closed` for
        // buffered prefetch paths.
        const closed = (0, _promisewithresolvers.createPromiseWithResolvers)();
        const { stream: prefetchStream, size: responseSize } = await createNonTaskyPrefetchResponseStream(response.body);
        closed.resolve();
        (0, _cachemap.setSizeInCacheMap)(segmentCacheEntry, responseSize);
        const serverData = await (0, _fetchserverresponse.createFromNextReadableStream)(prefetchStream, headers, {
            allowPartialStream: true
        });
        if ((response.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? serverData.buildId) !== (0, _navigationbuildid.getNavigationBuildId)()) {
            // The server build does not match the client. Treat as a 404. During
            // an actual navigation, the router will trigger an MPA navigation.
            rejectSegmentCacheEntry(segmentCacheEntry, Date.now() + 10 * 1000);
            return null;
        }
        const now = Date.now();
        const staleAt = now + getStaleTimeMs(serverData.staleTime);
        const fulfilledEntry = fulfillSegmentCacheEntry(segmentCacheEntry, serverData.rsc, staleAt, serverData.isPartial);
        // If the server tells us which params the segment varies by, we can re-key
        // the entry to a more generic vary path. This allows the entry to be reused
        // across different param values for params that the segment doesn't
        // actually depend on.
        const varyParams = serverData.varyParams;
        const fulfilledVaryPath = process.env.__NEXT_VARY_PARAMS && varyParams !== null ? (0, _varypath.getFulfilledSegmentVaryPath)(tree.varyPath, varyParams) : (0, _varypath.getSegmentVaryPathForRequest)(segmentCacheEntry.fetchStrategy, tree);
        // Re-key and upsert the entry at the fulfilled vary path. This ensures
        // the entry is stored at the most generic path possible based on which
        // params the segment actually depends on.
        upsertSegmentEntry(now, fulfilledVaryPath, fulfilledEntry);
        return {
            value: fulfilledEntry,
            // Return a promise that resolves when the network connection closes, so
            // the scheduler can track the number of concurrent network connections.
            closed: closed.promise
        };
    } catch (error) {
        // Either the connection itself failed, or something bad happened while
        // decoding the response.
        rejectSegmentCacheEntry(segmentCacheEntry, Date.now() + 10 * 1000);
        return null;
    }
}
async function fetchInlinedSegmentsOnCacheMiss(route, routeKey, tree, spawnedEntries) {
    // When prefetch inlining is enabled, all segment data for a route is bundled
    // into a single /_inlined response instead of individual per-segment
    // requests. This function fetches that response and walks the tree to fill
    // all segment cache entries at once.
    const url = new URL(route.canonicalUrl, location.origin);
    const nextUrl = routeKey.nextUrl;
    const headers = {
        [_approuterheaders.RSC_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER]: '/' + _segment.PAGE_SEGMENT_KEY
    };
    if (nextUrl !== null) {
        headers[_approuterheaders.NEXT_URL] = nextUrl;
    }
    addInstantPrefetchHeaderIfLocked(headers);
    try {
        const response = await fetchPrefetchResponse(url, headers);
        if (!response || !response.ok || response.status === 204 || response.headers.get(_approuterheaders.NEXT_DID_POSTPONE_HEADER) !== '2' && !isOutputExportMode || !response.body) {
            rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
            return null;
        }
        // See TODO in fetchRouteOnCacheMiss about removing `closed` for
        // buffered prefetch paths.
        const closed = (0, _promisewithresolvers.createPromiseWithResolvers)();
        const { stream: prefetchStream } = await createNonTaskyPrefetchResponseStream(response.body);
        closed.resolve();
        const serverData = await (0, _fetchserverresponse.createFromNextReadableStream)(prefetchStream, headers, {
            allowPartialStream: true
        });
        if ((response.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? serverData.tree.segment.buildId) !== (0, _navigationbuildid.getNavigationBuildId)()) {
            rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
            return null;
        }
        const now = Date.now();
        // Walk the inlined tree in parallel with the RouteTree and fill
        // segment cache entries.
        fillInlinedSegmentEntries(now, route, tree, serverData.tree, spawnedEntries);
        // Fill the head entry.
        const headStaleAt = now + getStaleTimeMs(serverData.head.staleTime);
        const headKey = route.metadata.requestKey;
        const ownedHeadEntry = spawnedEntries.get(headKey);
        if (ownedHeadEntry !== undefined) {
            fulfillSegmentCacheEntry(ownedHeadEntry, serverData.head.rsc, headStaleAt, serverData.head.isPartial);
        } else {
            // The head was already cached. Try to upsert if the entry is empty.
            const existingEntry = readOrCreateSegmentCacheEntry(now, _types.FetchStrategy.PPR, route.metadata);
            if (existingEntry.status === 0) {
                fulfillSegmentCacheEntry(upgradeToPendingSegment(existingEntry, _types.FetchStrategy.PPR), serverData.head.rsc, headStaleAt, serverData.head.isPartial);
            }
        }
        // Reject any remaining entries that were not fulfilled by the response.
        rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
        return {
            value: null,
            closed: closed.promise
        };
    } catch (error) {
        rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
        return null;
    }
}
function fillInlinedSegmentEntries(now, route, tree, inlinedNode, spawnedEntries) {
    // Check if the spawned entries map has an entry for this segment's key.
    const segment = inlinedNode.segment;
    const staleAt = now + getStaleTimeMs(segment.staleTime);
    const ownedEntry = spawnedEntries.get(tree.requestKey);
    if (ownedEntry !== undefined) {
        // We own this entry. Fulfill it directly.
        fulfillSegmentCacheEntry(ownedEntry, segment.rsc, staleAt, segment.isPartial);
    } else {
        // Not owned by us — this is extra data from the inlined response for a
        // segment that was already cached. Try to upsert if the entry is empty.
        const existingEntry = readOrCreateSegmentCacheEntry(now, _types.FetchStrategy.PPR, tree);
        if (existingEntry.status === 0) {
            fulfillSegmentCacheEntry(upgradeToPendingSegment(existingEntry, _types.FetchStrategy.PPR), segment.rsc, staleAt, segment.isPartial);
        }
    }
    // Recurse into children.
    if (tree.slots !== null && inlinedNode.slots !== null) {
        for(const parallelRouteKey in tree.slots){
            const childTree = tree.slots[parallelRouteKey];
            const childInlinedNode = inlinedNode.slots[parallelRouteKey];
            if (childInlinedNode !== undefined) {
                fillInlinedSegmentEntries(now, route, childTree, childInlinedNode, spawnedEntries);
            }
        }
    }
}
async function fetchSegmentPrefetchesUsingDynamicRequest(task, route, fetchStrategy, dynamicRequestTree, spawnedEntries) {
    const key = task.key;
    const url = new URL(route.canonicalUrl, location.origin);
    const nextUrl = key.nextUrl;
    if (spawnedEntries.size === 1 && spawnedEntries.has(route.metadata.requestKey)) {
        // The only thing pending is the head. Instruct the server to
        // skip over everything else.
        dynamicRequestTree = MetadataOnlyRequestTree;
    }
    const headers = {
        [_approuterheaders.RSC_HEADER]: '1',
        [_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER]: (0, _flightdatahelpers.prepareFlightRouterStateForRequest)(dynamicRequestTree)
    };
    if (nextUrl !== null) {
        headers[_approuterheaders.NEXT_URL] = nextUrl;
    }
    switch(fetchStrategy){
        case _types.FetchStrategy.Full:
            {
                break;
            }
        case _types.FetchStrategy.PPRRuntime:
            {
                headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER] = '2';
                break;
            }
        case _types.FetchStrategy.LoadingBoundary:
            {
                headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER] = '1';
                break;
            }
        default:
            {
                fetchStrategy;
            }
    }
    try {
        const response = await fetchPrefetchResponse(url, headers);
        if (!response || !response.ok || !response.body) {
            // Server responded with an error, or with a miss. We should still cache
            // the response, but we can try again after 10 seconds.
            rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
            return null;
        }
        const renderedSearch = (0, _routeparams.getRenderedSearch)(response);
        if (renderedSearch !== route.renderedSearch) {
            // The search params that were used to render the target page are
            // different from the search params in the request URL. This only happens
            // when there's a dynamic rewrite in between the tree prefetch and the
            // data prefetch.
            // TODO: For now, since this is an edge case, we reject the prefetch, but
            // the proper way to handle this is to evict the stale route tree entry
            // then fill the cache with the new response.
            rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
            return null;
        }
        // Track when the network connection closes. Only meaningful for Full
        // (dynamic) prefetches which use incremental streaming. For buffered
        // paths, this is resolved immediately — see TODO in fetchRouteOnCacheMiss.
        const closed = (0, _promisewithresolvers.createPromiseWithResolvers)();
        let fulfilledEntries = null;
        let prefetchStream;
        let bufferedResponseSize = null;
        if (fetchStrategy === _types.FetchStrategy.Full) {
            // Full prefetches are dynamic responses stored in the prefetch cache.
            // They don't carry vary params or other cache metadata, so there's no
            // need to buffer them. Use the incremental version to allow data to be
            // processed as it arrives.
            prefetchStream = createIncrementalPrefetchResponseStream(response.body, closed.resolve, function onResponseSizeUpdate(totalBytesReceivedSoFar) {
                // When processing a dynamic response, we don't know how large each
                // individual segment is, so approximate by assigning each segment
                // the average of the total response size.
                if (fulfilledEntries === null) {
                    // Haven't received enough data yet to know which segments
                    // were included.
                    return;
                }
                const averageSize = totalBytesReceivedSoFar / fulfilledEntries.length;
                for (const entry of fulfilledEntries){
                    (0, _cachemap.setSizeInCacheMap)(entry, averageSize);
                }
            });
        } else {
            const { stream, size } = await createNonTaskyPrefetchResponseStream(response.body);
            closed.resolve();
            prefetchStream = stream;
            bufferedResponseSize = size;
        }
        const [serverData, cacheData] = await Promise.all([
            (0, _fetchserverresponse.createFromNextReadableStream)(prefetchStream, headers, {
                allowPartialStream: true
            }),
            response.cacheData
        ]);
        // Read head vary params synchronously. Individual segments carry their
        // own thenables in CacheNodeSeedData.
        const headVaryParamsThenable = serverData.h;
        const headVaryParams = headVaryParamsThenable !== null ? (0, _varyparamsdecoding.readVaryParams)(headVaryParamsThenable) : null;
        const now = Date.now();
        const staleAt = await getStaleAt(now, serverData.s, response);
        // PPRRuntime prefetches are partial when the server marks the response
        // as '~' (Partial). Full/LoadingBoundary prefetches are always complete.
        const isResponsePartial = fetchStrategy === _types.FetchStrategy.PPRRuntime && (cacheData?.isResponsePartial ?? false);
        // Aside from writing the data into the cache, this function also returns
        // the entries that were fulfilled, so we can streamingly update their sizes
        // in the LRU as more data comes in.
        const buildId = response.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? serverData.b;
        const flightDatas = (0, _flightdatahelpers.normalizeFlightData)(serverData.f);
        if (typeof flightDatas === 'string') {
            rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
            return null;
        }
        const navigationSeed = (0, _navigation.convertServerPatchToFullTree)(now, dynamicRequestTree, flightDatas, renderedSearch, // Not needed for prefetch responses; pass unknown to use the default.
        _bfcache.UnknownDynamicStaleTime);
        fulfilledEntries = writeDynamicRenderResponseIntoCache(now, fetchStrategy, flightDatas, buildId, isResponsePartial, headVaryParams, staleAt, navigationSeed, spawnedEntries);
        // For buffered responses, update LRU sizes now that we know which
        // entries were fulfilled.
        if (bufferedResponseSize !== null && fulfilledEntries !== null && fulfilledEntries.length > 0) {
            const averageSize = bufferedResponseSize / fulfilledEntries.length;
            for (const entry of fulfilledEntries){
                (0, _cachemap.setSizeInCacheMap)(entry, averageSize);
            }
        }
        // Return a promise that resolves when the network connection closes, so
        // the scheduler can track the number of concurrent network connections.
        return {
            value: null,
            closed: closed.promise
        };
    } catch (error) {
        rejectSegmentEntriesIfStillPending(spawnedEntries, Date.now() + 10 * 1000);
        return null;
    }
}
function writeDynamicTreeResponseIntoCache(now, fetchStrategy, response, serverData, entry, couldBeIntercepted, canonicalUrl, routeIsPPREnabled, headVaryParams, originalPathname, nextUrl) {
    const renderedSearch = (0, _routeparams.getRenderedSearch)(response);
    const normalizedFlightDataResult = (0, _flightdatahelpers.normalizeFlightData)(serverData.f);
    if (// A string result means navigating to this route will result in an
    // MPA navigation.
    typeof normalizedFlightDataResult === 'string' || normalizedFlightDataResult.length !== 1) {
        rejectRouteCacheEntry(entry, now + 10 * 1000);
        return;
    }
    const flightData = normalizedFlightDataResult[0];
    if (!flightData.isRootRender) {
        // Unexpected response format.
        rejectRouteCacheEntry(entry, now + 10 * 1000);
        return;
    }
    const flightRouterState = flightData.tree;
    // If the response was postponed, segments may contain dynamic holes.
    // The head has its own partiality flag (flightDataEntry.isHeadPartial)
    // which is handled separately in writeDynamicRenderResponseIntoCache.
    const isResponsePartial = response.headers.get(_approuterheaders.NEXT_DID_POSTPONE_HEADER) === '1';
    // Convert the server-sent data into the RouteTree format used by the
    // client cache.
    //
    // During this traversal, we accumulate additional data into this
    // "accumulator" object.
    const acc = {
        metadataVaryPath: null
    };
    const routeTree = convertRootFlightRouterStateToRouteTree(flightRouterState, renderedSearch, acc);
    const metadataVaryPath = acc.metadataVaryPath;
    if (metadataVaryPath === null) {
        rejectRouteCacheEntry(entry, now + 10 * 1000);
        return;
    }
    (0, _optimisticroutes.discoverKnownRoute)(now, originalPathname, nextUrl, entry, routeTree, metadataVaryPath, couldBeIntercepted, canonicalUrl, routeIsPPREnabled, false // hasDynamicRewrite
    );
    // If the server sent segment data as part of the response, we should write
    // it into the cache to prevent a second, redundant prefetch request.
    // TODO: This is a leftover branch from before Client Segment Cache was
    // enabled everywhere. Tree prefetches should never include segment data.  We
    // can delete it. Leaving for a subsequent PR.
    const navigationSeed = (0, _navigation.convertServerPatchToFullTree)(now, flightRouterState, normalizedFlightDataResult, renderedSearch, _bfcache.UnknownDynamicStaleTime);
    const buildId = response.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? serverData.b;
    writeDynamicRenderResponseIntoCache(now, fetchStrategy, normalizedFlightDataResult, buildId, isResponsePartial, headVaryParams, getStaleAtFromHeader(now, response), navigationSeed, null);
}
function rejectSegmentEntriesIfStillPending(entries, staleAt) {
    const fulfilledEntries = [];
    for (const entry of entries.values()){
        if (entry.status === 1) {
            rejectSegmentCacheEntry(entry, staleAt);
        } else if (entry.status === 2) {
            fulfilledEntries.push(entry);
        }
    }
    return fulfilledEntries;
}
function writeDynamicRenderResponseIntoCache(now, fetchStrategy, flightDatas, buildId, isResponsePartial, headVaryParams, staleAt, navigationSeed, spawnedEntries) {
    if (buildId && buildId !== (0, _navigationbuildid.getNavigationBuildId)()) {
        // The server build does not match the client. Treat as a 404. During
        // an actual navigation, the router will trigger an MPA navigation.
        if (spawnedEntries !== null) {
            rejectSegmentEntriesIfStillPending(spawnedEntries, now + 10 * 1000);
        }
        return null;
    }
    const routeTree = navigationSeed.routeTree;
    const metadataTree = navigationSeed.metadataVaryPath !== null ? createMetadataRouteTree(navigationSeed.metadataVaryPath) : null;
    for (const flightDataEntry of flightDatas){
        const seedData = flightDataEntry.seedData;
        if (seedData !== null) {
            // The data sent by the server represents only a subtree of the app. We
            // need to find the part of the task tree that matches the response.
            //
            // segmentPath represents the parent path of subtree. It's a repeating
            // pattern of parallel route key and segment:
            //
            //   [string, Segment, string, Segment, string, Segment, ...]
            const segmentPath = flightDataEntry.segmentPath;
            let tree = routeTree;
            for(let i = 0; i < segmentPath.length; i += 2){
                const parallelRouteKey = segmentPath[i];
                if (tree?.slots?.[parallelRouteKey] !== undefined) {
                    tree = tree.slots[parallelRouteKey];
                } else {
                    if (spawnedEntries !== null) {
                        rejectSegmentEntriesIfStillPending(spawnedEntries, now + 10 * 1000);
                    }
                    return null;
                }
            }
            writeSeedDataIntoCache(now, fetchStrategy, tree, staleAt, seedData, isResponsePartial, spawnedEntries);
        }
        const head = flightDataEntry.head;
        if (head !== null && metadataTree !== null) {
            // When Cache Components is enabled, the server conservatively marks
            // the head as partial during static generation (isPossiblyPartialHead
            // in app-render.tsx), even for fully static pages where the head is
            // actually complete. When the response is non-partial, we override
            // this since the server confirmed no dynamic content exists.
            //
            // Without Cache Components, the server always sends the correct
            // isHeadPartial value, so no override is needed.
            const isHeadPartial = !isResponsePartial && process.env.__NEXT_CACHE_COMPONENTS ? false : flightDataEntry.isHeadPartial;
            fulfillEntrySpawnedByRuntimePrefetch(now, fetchStrategy, head, isHeadPartial, staleAt, // For head entries, use the head-specific vary params passed as
            // parameter.
            headVaryParams, metadataTree, spawnedEntries);
        }
    }
    // Any entry that's still pending was intentionally not rendered by the
    // server, because it was inside the loading boundary. Mark them as rejected
    // so we know not to fetch them again.
    // TODO: If PPR is enabled on some routes but not others, then it's possible
    // that a different page is able to do a per-segment prefetch of one of the
    // segments we're marking as rejected here. We should mark on the segment
    // somehow that the reason for the rejection is because of a non-PPR prefetch.
    // That way a per-segment prefetch knows to disregard the rejection.
    if (spawnedEntries !== null) {
        const fulfilledEntries = rejectSegmentEntriesIfStillPending(spawnedEntries, now + 10 * 1000);
        return fulfilledEntries;
    }
    return null;
}
function writeSeedDataIntoCache(now, fetchStrategy, tree, staleAt, seedData, isResponsePartial, entriesOwnedByCurrentTask) {
    // This function is used to write the result of a runtime server request
    // (CacheNodeSeedData) into the prefetch cache.
    const rsc = seedData[0];
    const isPartial = rsc === null || isResponsePartial;
    const varyParamsThenable = seedData[4];
    // Each segment carries its own vary params thenable in the seed data. The
    // thenable resolves to the set of params the segment accessed during render.
    // A null thenable means tracking was not enabled (not a prerender).
    const varyParams = varyParamsThenable !== null ? (0, _varyparamsdecoding.readVaryParams)(varyParamsThenable) : null;
    fulfillEntrySpawnedByRuntimePrefetch(now, fetchStrategy, rsc, isPartial, staleAt, varyParams, tree, entriesOwnedByCurrentTask);
    // Recursively write the child data into the cache.
    const slots = tree.slots;
    if (slots !== null) {
        const seedDataChildren = seedData[1];
        for(const parallelRouteKey in slots){
            const childTree = slots[parallelRouteKey];
            const childSeedData = seedDataChildren[parallelRouteKey];
            if (childSeedData !== null && childSeedData !== undefined) {
                writeSeedDataIntoCache(now, fetchStrategy, childTree, staleAt, childSeedData, isResponsePartial, entriesOwnedByCurrentTask);
            }
        }
    }
}
function fulfillEntrySpawnedByRuntimePrefetch(now, fetchStrategy, rsc, isPartial, staleAt, segmentVaryParams, tree, entriesOwnedByCurrentTask) {
    // We should only write into cache entries that are owned by us. Or create
    // a new one and write into that. We must never write over an entry that was
    // created by a different task, because that causes data races.
    const ownedEntry = entriesOwnedByCurrentTask !== null ? entriesOwnedByCurrentTask.get(tree.requestKey) : undefined;
    if (ownedEntry !== undefined) {
        const fulfilledEntry = fulfillSegmentCacheEntry(ownedEntry, rsc, staleAt, isPartial);
        // Re-key the entry based on which params the segment actually depends on.
        if (process.env.__NEXT_VARY_PARAMS && segmentVaryParams !== null) {
            const fulfilledVaryPath = (0, _varypath.getFulfilledSegmentVaryPath)(tree.varyPath, segmentVaryParams);
            const isRevalidation = false;
            (0, _cachemap.setInCacheMap)(segmentCacheMap, fulfilledVaryPath, fulfilledEntry, isRevalidation);
        }
    } else {
        // There's no matching entry. Attempt to create a new one.
        const possiblyNewEntry = readOrCreateSegmentCacheEntry(now, fetchStrategy, tree);
        if (possiblyNewEntry.status === 0) {
            // Confirmed this is a new entry. We can fulfill it.
            const newEntry = possiblyNewEntry;
            const fulfilledEntry = fulfillSegmentCacheEntry(upgradeToPendingSegment(newEntry, fetchStrategy), rsc, staleAt, isPartial);
            // Re-key the entry based on which params the segment actually depends on.
            if (process.env.__NEXT_VARY_PARAMS && segmentVaryParams !== null) {
                const fulfilledVaryPath = (0, _varypath.getFulfilledSegmentVaryPath)(tree.varyPath, segmentVaryParams);
                const isRevalidation = false;
                (0, _cachemap.setInCacheMap)(segmentCacheMap, fulfilledVaryPath, fulfilledEntry, isRevalidation);
            }
        } else {
            // There was already an entry in the cache. But we may be able to
            // replace it with the new one from the server.
            const newEntry = fulfillSegmentCacheEntry(upgradeToPendingSegment(createDetachedSegmentCacheEntry(now), fetchStrategy), rsc, staleAt, isPartial);
            // Use the fulfilled vary path if available, otherwise fall back to
            // the request vary path.
            const varyPath = process.env.__NEXT_VARY_PARAMS && segmentVaryParams !== null ? (0, _varypath.getFulfilledSegmentVaryPath)(tree.varyPath, segmentVaryParams) : (0, _varypath.getSegmentVaryPathForRequest)(fetchStrategy, tree);
            upsertSegmentEntry(now, varyPath, newEntry);
        }
    }
}
async function fetchPrefetchResponse(url, headers) {
    const fetchPriority = 'low';
    // When issuing a prefetch request, don't immediately decode the response; we
    // use the lower level `createFromResponse` API instead because we need to do
    // some extra processing of the response stream. See
    // `createNonTaskyPrefetchResponseStream` for more details.
    const shouldImmediatelyDecode = false;
    const response = await (0, _fetchserverresponse.createFetch)(url, headers, fetchPriority, shouldImmediatelyDecode);
    if (!response.ok) {
        return null;
    }
    // Check the content type
    if (isOutputExportMode) {
    // In output: "export" mode, we relaxed about the content type, since it's
    // not Next.js that's serving the response. If the status is OK, assume the
    // response is valid. If it's not a valid response, the Flight client won't
    // be able to decode it, and we'll treat it as a miss.
    } else {
        const contentType = response.headers.get('content-type');
        const isFlightResponse = contentType && contentType.startsWith(_approuterheaders.RSC_CONTENT_TYPE_HEADER);
        if (!isFlightResponse) {
            return null;
        }
    }
    return response;
}
async function createNonTaskyPrefetchResponseStream(body) {
    // Buffer the entire response before passing it to the Flight client. This
    // ensures that when Flight processes the stream, all model data is available
    // synchronously. This is important for readVaryParams, which synchronously
    // checks the thenable status — if data arrived in multiple network chunks,
    // the thenables might not yet be fulfilled.
    //
    // TODO: There are too many intermediate stream transformations in the
    // prefetch response pipeline (e.g. stripIsPartialByte, this function).
    // These could all be consolidated into a single transformation. Refactor
    // once the cached navigations experiment lands.
    //
    // Read the entire response from the network.
    const reader = body.getReader();
    const chunks = [];
    let size = 0;
    while(true){
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
    }
    // Concatenate into a single chunk so that Flight's processBinaryChunk
    // processes all rows synchronously in one call. Multiple chunks would not
    // be sufficient: even though reader.read() resolves as a microtask for
    // already-enqueued data, the `await` continuation from
    // createFromReadableStream can interleave between chunks. If the root
    // model row isn't the first row (e.g. outlined values come first), the
    // PromiseResolveThenableJob from `await` can cause the root to initialize
    // eagerly, scheduling the continuation before remaining chunks (including
    // promise value rows) are processed. A single chunk avoids this.
    let buffer;
    if (chunks.length === 1) {
        buffer = chunks[0];
    } else if (chunks.length > 1) {
        buffer = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks){
            buffer.set(chunk, offset);
            offset += chunk.byteLength;
        }
    } else {
        buffer = new Uint8Array(0);
    }
    const stream = new ReadableStream({
        start (controller) {
            controller.enqueue(buffer);
            controller.close();
        }
    });
    return {
        stream,
        size
    };
}
/**
 * Creates a streaming (non-buffered) prefetch response stream for dynamic/Full
 * prefetches. These are essentially dynamic responses that get stored in the
 * prefetch cache — they don't carry vary params or other cache metadata that
 * requires synchronous thenable resolution, so there's no need to buffer them.
 * They should continue to stream so consumers can process data as it arrives.
 */ function createIncrementalPrefetchResponseStream(originalFlightStream, onStreamClose, onResponseSizeUpdate) {
    // While processing the original stream, we incrementally update the size
    // of the cache entry in the LRU.
    let totalByteLength = 0;
    const reader = originalFlightStream.getReader();
    return new ReadableStream({
        async pull (controller) {
            while(true){
                const { done, value } = await reader.read();
                if (!done) {
                    // Pass to the target stream and keep consuming the Flight response
                    // from the server.
                    controller.enqueue(value);
                    // Incrementally update the size of the cache entry in the LRU.
                    totalByteLength += value.byteLength;
                    onResponseSizeUpdate(totalByteLength);
                    continue;
                }
                controller.close();
                onStreamClose();
                return;
            }
        }
    });
}
function addSegmentPathToUrlInOutputExportMode(url, segmentPath) {
    if (isOutputExportMode) {
        // In output: "export" mode, we cannot use a header to encode the segment
        // path. Instead, we append it to the end of the pathname.
        const staticUrl = new URL(url);
        const routeDir = staticUrl.pathname.endsWith('/') ? staticUrl.pathname.slice(0, -1) : staticUrl.pathname;
        const staticExportFilename = (0, _segmentvalueencoding.convertSegmentPathToStaticExportFilename)(segmentPath);
        staticUrl.pathname = `${routeDir}/${staticExportFilename}`;
        return staticUrl;
    }
    return url;
}
function canNewFetchStrategyProvideMoreContent(currentStrategy, newStrategy) {
    return currentStrategy < newStrategy;
}
/**
 * Adds the instant prefetch header if the navigation lock is active.
 * Uses a lazy require to ensure dead code elimination.
 */ function addInstantPrefetchHeaderIfLocked(headers) {
    if (process.env.__NEXT_EXPOSE_TESTING_API) {
        const { isNavigationLocked } = require('./navigation-testing-lock');
        if (isNavigationLocked()) {
            headers[_approuterheaders.NEXT_INSTANT_PREFETCH_HEADER] = '1';
        }
    }
}
function getStaleAtFromHeader(now, response) {
    const staleTimeSeconds = parseInt(response.headers.get(_approuterheaders.NEXT_ROUTER_STALE_TIME_HEADER) ?? '', 10);
    const staleTimeMs = !isNaN(staleTimeSeconds) ? getStaleTimeMs(staleTimeSeconds) : _navigatereducer.STATIC_STALETIME_MS;
    return now + staleTimeMs;
}
async function getStaleAt(now, staleTimeIterable, response) {
    if (staleTimeIterable !== undefined) {
        // Iterate the async iterable and take the last yielded value. The server
        // yields updated staleTime values during the render; the last one is the
        // final staleTime.
        let staleTimeSeconds;
        for await (const value of staleTimeIterable){
            staleTimeSeconds = value;
        }
        if (staleTimeSeconds !== undefined) {
            const staleTimeMs = isNaN(staleTimeSeconds) ? _navigatereducer.STATIC_STALETIME_MS : getStaleTimeMs(staleTimeSeconds);
            return now + staleTimeMs;
        }
    }
    if (response !== undefined) {
        return getStaleAtFromHeader(now, response);
    }
    return now + _navigatereducer.STATIC_STALETIME_MS;
}
function writeStaticStageResponseIntoCache(now, flightData, buildId, headVaryParamsThenable, staleAt, baseTree, renderedSearch, isResponsePartial) {
    const fetchStrategy = isResponsePartial ? _types.FetchStrategy.PPR : _types.FetchStrategy.Full;
    const headVaryParams = headVaryParamsThenable !== null ? (0, _varyparamsdecoding.readVaryParams)(headVaryParamsThenable) : null;
    const flightDatas = (0, _flightdatahelpers.normalizeFlightData)(flightData);
    if (typeof flightDatas === 'string') {
        return;
    }
    const navigationSeed = (0, _navigation.convertServerPatchToFullTree)(now, baseTree, flightDatas, renderedSearch, _bfcache.UnknownDynamicStaleTime);
    writeDynamicRenderResponseIntoCache(now, fetchStrategy, flightDatas, buildId, isResponsePartial, headVaryParams, staleAt, navigationSeed, null // spawnedEntries — no pre-created entries; will create or upsert
    );
}
async function processRuntimePrefetchStream(now, runtimePrefetchStream, baseTree, renderedSearch) {
    const { stream, isPartial } = await stripIsPartialByte(runtimePrefetchStream);
    const serverData = await (0, _fetchserverresponse.createFromNextReadableStream)(stream, undefined, {
        allowPartialStream: true
    });
    const headVaryParamsThenable = serverData.h;
    const headVaryParams = headVaryParamsThenable !== null ? (0, _varyparamsdecoding.readVaryParams)(headVaryParamsThenable) : null;
    const staleAt = await getStaleAt(now, serverData.s);
    const flightDatas = (0, _flightdatahelpers.normalizeFlightData)(serverData.f);
    if (typeof flightDatas === 'string') {
        return null;
    }
    const navigationSeed = (0, _navigation.convertServerPatchToFullTree)(now, baseTree, flightDatas, renderedSearch, _bfcache.UnknownDynamicStaleTime);
    return {
        flightDatas,
        navigationSeed,
        buildId: serverData.b,
        isResponsePartial: isPartial,
        headVaryParams,
        staleAt
    };
}
async function stripIsPartialByte(stream) {
    // When there is no recognized marker byte, the fallback depends on whether
    // Cached Navigations is enabled. When enabled, dynamic navigation responses
    // don't have a marker but may contain dynamic holes, so they are treated as
    // partial. When disabled, unmarked responses are treated as non-partial.
    const defaultIsPartial = !!process.env.__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS;
    const reader = stream.getReader();
    const { done, value } = await reader.read();
    if (done || !value || value.byteLength === 0) {
        return {
            stream: new ReadableStream({
                start: (c)=>c.close()
            }),
            isPartial: defaultIsPartial
        };
    }
    const firstByte = value[0];
    const hasMarker = firstByte === 0x23 || firstByte === 0x7e;
    const isPartial = hasMarker ? firstByte === 0x7e : defaultIsPartial;
    const remainder = hasMarker ? value.byteLength > 1 ? value.subarray(1) : null : value;
    return {
        isPartial,
        stream: new ReadableStream({
            start (controller) {
                if (remainder) {
                    controller.enqueue(remainder);
                }
            },
            async pull (controller) {
                const result = await reader.read();
                if (result.done) {
                    controller.close();
                } else {
                    controller.enqueue(result.value);
                }
            }
        })
    };
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=cache.js.map