"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createFlightRouterStateFromLoaderTree: null,
    createRouteTreePrefetch: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createFlightRouterStateFromLoaderTree: function() {
        return createFlightRouterStateFromLoaderTree;
    },
    createRouteTreePrefetch: function() {
        return createRouteTreePrefetch;
    }
});
const _approutertypes = require("../../shared/lib/app-router-types");
const _segment = require("../../shared/lib/segment");
async function createFlightRouterStateFromLoaderTreeImpl(loaderTree, hintTree, getDynamicParamFromSegment, searchParams, didFindRootLayout) {
    const [segment, parallelRoutes, { layout, loading, page }] = loaderTree;
    const dynamicParam = getDynamicParamFromSegment(loaderTree);
    const treeSegment = dynamicParam ? dynamicParam.treeSegment : segment;
    const segmentTree = [
        (0, _segment.addSearchParamsIfPageSegment)(treeSegment, searchParams),
        {}
    ];
    // Load the layout or page module to check for unstable_instant config
    const mod = layout ? await layout[0]() : page ? await page[0]() : undefined;
    const instantConfig = mod ? mod.unstable_instant : undefined;
    let prefetchHints = 0;
    // Union in the precomputed build-time hints (e.g. segment inlining
    // decisions) if available. When hints are not available (e.g. dev mode or
    // if prefetch-hints.json was not generated), we fall through and still
    // compute the other hints below. In the future this should be a build
    // error, but for now we gracefully degrade.
    //
    // TODO: Move more of the hints computation (IsRootLayout, instant config,
    // loading boundary detection) into the build-time measurement step in
    // collectPrefetchHints, so this function only needs to union the
    // precomputed bitmask rather than re-derive hints on every render.
    if (hintTree !== null) {
        prefetchHints |= hintTree.hints;
    }
    // Mark the first segment that has a layout as the "root" layout
    if (!didFindRootLayout && typeof layout !== 'undefined') {
        didFindRootLayout = true;
        prefetchHints |= _approutertypes.PrefetchHint.IsRootLayout;
    }
    if (instantConfig && typeof instantConfig === 'object') {
        prefetchHints |= _approutertypes.PrefetchHint.SubtreeHasInstant;
        if (instantConfig.prefetch === 'runtime') {
            prefetchHints |= _approutertypes.PrefetchHint.HasRuntimePrefetch;
        }
    }
    // Check if this segment has a loading boundary
    if (loading) {
        prefetchHints |= _approutertypes.PrefetchHint.SegmentHasLoadingBoundary;
    }
    const children = {};
    for(const parallelRouteKey in parallelRoutes){
        var _hintTree_slots;
        // Look up the child hint node by parallel route key, traversing the
        // hint tree in parallel with the loader tree.
        const childHintNode = (hintTree == null ? void 0 : (_hintTree_slots = hintTree.slots) == null ? void 0 : _hintTree_slots[parallelRouteKey]) ?? null;
        const child = await createFlightRouterStateFromLoaderTreeImpl(parallelRoutes[parallelRouteKey], childHintNode, getDynamicParamFromSegment, searchParams, didFindRootLayout);
        // Propagate subtree flags from children
        if (child[4] !== undefined) {
            prefetchHints |= child[4] & (_approutertypes.PrefetchHint.SubtreeHasInstant | _approutertypes.PrefetchHint.SubtreeHasLoadingBoundary);
            // If a child has a loading boundary (either directly or in its subtree),
            // propagate that as SubtreeHasLoadingBoundary to this segment.
            if (child[4] & (_approutertypes.PrefetchHint.SegmentHasLoadingBoundary | _approutertypes.PrefetchHint.SubtreeHasLoadingBoundary)) {
                prefetchHints |= _approutertypes.PrefetchHint.SubtreeHasLoadingBoundary;
            }
        }
        children[parallelRouteKey] = child;
    }
    segmentTree[1] = children;
    if (prefetchHints !== 0) {
        segmentTree[4] = prefetchHints;
    }
    return segmentTree;
}
async function createFlightRouterStateFromLoaderTree(loaderTree, hintTree, getDynamicParamFromSegment, searchParams) {
    const didFindRootLayout = false;
    return createFlightRouterStateFromLoaderTreeImpl(loaderTree, hintTree, getDynamicParamFromSegment, searchParams, didFindRootLayout);
}
async function createRouteTreePrefetch(loaderTree, hintTree, getDynamicParamFromSegment) {
    // Search params should not be added to page segment's cache key during a
    // route tree prefetch request, because they do not affect the structure of
    // the route. The client cache has its own logic to handle search params.
    const searchParams = {};
    const didFindRootLayout = false;
    return createFlightRouterStateFromLoaderTreeImpl(loaderTree, hintTree, getDynamicParamFromSegment, searchParams, didFindRootLayout);
}

//# sourceMappingURL=create-flight-router-state-from-loader-tree.js.map