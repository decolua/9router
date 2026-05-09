"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createInitialRSCPayloadFromFallbackPrerender: null,
    getFlightDataPartsFromPath: null,
    getNextFlightSegmentPath: null,
    normalizeFlightData: null,
    prepareFlightRouterStateForRequest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createInitialRSCPayloadFromFallbackPrerender: function() {
        return createInitialRSCPayloadFromFallbackPrerender;
    },
    getFlightDataPartsFromPath: function() {
        return getFlightDataPartsFromPath;
    },
    getNextFlightSegmentPath: function() {
        return getNextFlightSegmentPath;
    },
    normalizeFlightData: function() {
        return normalizeFlightData;
    },
    prepareFlightRouterStateForRequest: function() {
        return prepareFlightRouterStateForRequest;
    }
});
const _segment = require("../shared/lib/segment");
const _routeparams = require("./route-params");
const _createhreffromurl = require("./components/router-reducer/create-href-from-url");
function getFlightDataPartsFromPath(flightDataPath) {
    // Pick the last 4 items from the `FlightDataPath` to get the [tree, seedData, viewport, isHeadPartial].
    const flightDataPathLength = 4;
    // tree, seedData, and head are *always* the last three items in the `FlightDataPath`.
    const [tree, seedData, head, isHeadPartial] = flightDataPath.slice(-flightDataPathLength);
    // The `FlightSegmentPath` is everything except the last three items. For a root render, it won't be present.
    const segmentPath = flightDataPath.slice(0, -flightDataPathLength);
    return {
        // TODO: Unify these two segment path helpers. We are inconsistently pushing an empty segment ("")
        // to the start of the segment path in some places which makes it hard to use solely the segment path.
        // Look for "// TODO-APP: remove ''" in the codebase.
        pathToSegment: segmentPath.slice(0, -1),
        segmentPath,
        // if the `FlightDataPath` corresponds with the root, there'll be no segment path,
        // in which case we default to ''.
        segment: segmentPath[segmentPath.length - 1] ?? '',
        tree,
        seedData,
        head,
        isHeadPartial,
        isRootRender: flightDataPath.length === flightDataPathLength
    };
}
function createInitialRSCPayloadFromFallbackPrerender(response, fallbackInitialRSCPayload) {
    // This is a static fallback page. In order to hydrate the page, we need to
    // parse the client params from the URL, but to account for the possibility
    // that the page was rewritten, we need to check the response headers
    // for x-nextjs-rewritten-path or x-nextjs-rewritten-query headers. Since
    // we can't access the headers of the initial document response, the client
    // performs a fetch request to the current location. Since it's possible that
    // the fetch request will be dynamically rewritten to a different path than
    // the initial document, this fetch request delivers _all_ the hydration data
    // for the page; it was not inlined into the document, like it normally
    // would be.
    //
    // TODO: Consider treating the case where fetch is rewritten to a different
    // path from the document as a special deopt case. We should optimistically
    // assume this won't happen, inline the data into the document, and perform
    // a minimal request (like a HEAD or range request) to verify that the
    // response matches. Tricky to get right because we need to account for
    // all the different deployment environments we support, like output:
    // "export" mode, where we currently don't assume that custom response
    // headers are present.
    // Patch the Flight data sent by the server with the correct params parsed
    // from the URL + response object.
    const renderedPathname = (0, _routeparams.getRenderedPathname)(response);
    const renderedSearch = (0, _routeparams.getRenderedSearch)(response);
    const canonicalUrl = (0, _createhreffromurl.createHrefFromUrl)(new URL(location.href));
    const originalFlightDataPath = fallbackInitialRSCPayload.f[0];
    const originalFlightRouterState = originalFlightDataPath[0];
    const payload = {
        c: canonicalUrl.split('/'),
        q: renderedSearch,
        i: fallbackInitialRSCPayload.i,
        f: [
            [
                fillInFallbackFlightRouterState(originalFlightRouterState, renderedPathname, renderedSearch),
                originalFlightDataPath[1],
                originalFlightDataPath[2],
                originalFlightDataPath[2]
            ]
        ],
        m: fallbackInitialRSCPayload.m,
        G: fallbackInitialRSCPayload.G,
        S: fallbackInitialRSCPayload.S,
        h: fallbackInitialRSCPayload.h
    };
    if (fallbackInitialRSCPayload.b) {
        payload.b = fallbackInitialRSCPayload.b;
    }
    return payload;
}
function fillInFallbackFlightRouterState(flightRouterState, renderedPathname, renderedSearch) {
    const pathnameParts = renderedPathname.split('/').filter((p)=>p !== '');
    const index = 0;
    return fillInFallbackFlightRouterStateImpl(flightRouterState, renderedSearch, pathnameParts, index);
}
function fillInFallbackFlightRouterStateImpl(flightRouterState, renderedSearch, pathnameParts, pathnamePartsIndex) {
    const originalSegment = flightRouterState[0];
    let newSegment;
    let doesAppearInURL;
    if (typeof originalSegment === 'string') {
        newSegment = originalSegment;
        doesAppearInURL = (0, _routeparams.doesStaticSegmentAppearInURL)(originalSegment);
    } else {
        const paramName = originalSegment[0];
        const paramType = originalSegment[2];
        const staticSiblings = originalSegment[3];
        const paramValue = (0, _routeparams.parseDynamicParamFromURLPart)(paramType, pathnameParts, pathnamePartsIndex);
        const cacheKey = (0, _routeparams.getCacheKeyForDynamicParam)(paramValue, renderedSearch);
        newSegment = [
            paramName,
            cacheKey,
            paramType,
            staticSiblings
        ];
        doesAppearInURL = true;
    }
    // Only increment the index if the segment appears in the URL. If it's a
    // "virtual" segment, like a route group, it remains the same.
    const childPathnamePartsIndex = doesAppearInURL ? pathnamePartsIndex + 1 : pathnamePartsIndex;
    const children = flightRouterState[1];
    const newChildren = {};
    for(let key in children){
        const childFlightRouterState = children[key];
        newChildren[key] = fillInFallbackFlightRouterStateImpl(childFlightRouterState, renderedSearch, pathnameParts, childPathnamePartsIndex);
    }
    const newState = [
        newSegment,
        newChildren,
        null,
        flightRouterState[3],
        flightRouterState[4]
    ];
    return newState;
}
function getNextFlightSegmentPath(flightSegmentPath) {
    // Since `FlightSegmentPath` is a repeated tuple of `Segment` and `ParallelRouteKey`, we slice off two items
    // to get the next segment path.
    return flightSegmentPath.slice(2);
}
function normalizeFlightData(flightData) {
    // FlightData can be a string when the server didn't respond with a proper flight response,
    // or when a redirect happens, to signal to the client that it needs to perform an MPA navigation.
    if (typeof flightData === 'string') {
        return flightData;
    }
    return flightData.map((flightDataPath)=>getFlightDataPartsFromPath(flightDataPath));
}
function prepareFlightRouterStateForRequest(flightRouterState, isHmrRefresh) {
    // HMR requests need the complete, unmodified state for proper functionality
    if (isHmrRefresh) {
        return encodeURIComponent(JSON.stringify(flightRouterState));
    }
    return encodeURIComponent(JSON.stringify(stripClientOnlyDataFromFlightRouterState(flightRouterState)));
}
/**
 * Recursively strips client-only data from FlightRouterState while preserving
 * server-needed information for proper rendering decisions.
 */ function stripClientOnlyDataFromFlightRouterState(flightRouterState) {
    const [segment, parallelRoutes, _refreshState, refreshMarker, prefetchHints] = flightRouterState;
    // Strip client-only data from the segment
    const cleanedSegment = stripClientOnlyDataFromSegment(segment);
    // Recursively process parallel routes
    const cleanedParallelRoutes = {};
    for (const [key, childState] of Object.entries(parallelRoutes)){
        cleanedParallelRoutes[key] = stripClientOnlyDataFromFlightRouterState(childState);
    }
    const result = [
        cleanedSegment,
        cleanedParallelRoutes
    ];
    if (refreshMarker) {
        result[2] = null // null slightly more compact than undefined
        ;
        result[3] = refreshMarker;
    }
    // Append optional fields if present
    if (prefetchHints !== undefined) {
        result[4] = prefetchHints;
    }
    // Everything else is used only by the client and is not needed for requests.
    return result;
}
/**
 * Strips client-only data from segments:
 * - Search parameters from __PAGE__ segments
 * - staticSiblings from dynamic segment tuples (only needed for client-side
 *   prefetch reuse decisions)
 */ function stripClientOnlyDataFromSegment(segment) {
    if (typeof segment === 'string') {
        // Strip search params from __PAGE__ segments
        if (segment.startsWith(_segment.PAGE_SEGMENT_KEY + '?')) {
            return _segment.PAGE_SEGMENT_KEY;
        }
        return segment;
    }
    // Dynamic segment tuple: [paramName, paramCacheKey, paramType, staticSiblings]
    // Strip staticSiblings (4th element) since server doesn't need it
    const [paramName, paramCacheKey, paramType] = segment;
    return [
        paramName,
        paramCacheKey,
        paramType,
        null
    ];
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=flight-data-helpers.js.map