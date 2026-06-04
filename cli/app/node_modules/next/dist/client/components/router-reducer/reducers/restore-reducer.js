"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "restoreReducer", {
    enumerable: true,
    get: function() {
        return restoreReducer;
    }
});
const _computechangedpath = require("../compute-changed-path");
const _pprnavigations = require("../ppr-navigations");
const _navigation = require("../../segment-cache/navigation");
const _bfcache = require("../../segment-cache/bfcache");
function restoreReducer(state, action) {
    // This action is used to restore the router state from the history state.
    // However, it's possible that the history state no longer contains the `FlightRouterState`.
    // We will copy over the internal state on pushState/replaceState events, but if a history entry
    // occurred before hydration, or if the user navigated to a hash using a regular anchor link,
    // the history state will not contain the `FlightRouterState`.
    // In this case, we'll continue to use the existing tree so the router doesn't get into an invalid state.
    let treeToRestore;
    let renderedSearch;
    const historyState = action.historyState;
    if (historyState) {
        treeToRestore = historyState.tree;
        renderedSearch = historyState.renderedSearch;
    } else {
        treeToRestore = state.tree;
        renderedSearch = state.renderedSearch;
    }
    const currentUrl = new URL(state.canonicalUrl, location.origin);
    const restoredUrl = action.url;
    const restoredNextUrl = (0, _computechangedpath.extractPathFromFlightRouterState)(treeToRestore) ?? restoredUrl.pathname;
    const now = Date.now();
    // TODO: Store the dynamic stale time on the top-level state so it's known
    // during restores and refreshes.
    const accumulation = {
        separateRefreshUrls: null,
        scrollRef: null
    };
    const restoreSeed = (0, _navigation.convertServerPatchToFullTree)(now, treeToRestore, null, renderedSearch, _bfcache.UnknownDynamicStaleTime);
    const task = (0, _pprnavigations.startPPRNavigation)(now, currentUrl, state.renderedSearch, state.cache, state.tree, restoreSeed.routeTree, restoreSeed.metadataVaryPath, _pprnavigations.FreshnessPolicy.HistoryTraversal, null, null, restoreSeed.dynamicStaleAt, false, accumulation);
    if (task === null) {
        return (0, _navigation.completeHardNavigation)(state, restoredUrl, 'replace');
    }
    (0, _pprnavigations.spawnDynamicRequests)(task, restoredUrl, restoredNextUrl, _pprnavigations.FreshnessPolicy.HistoryTraversal, accumulation, // History traversal doesn't use route prediction, so there's no route
    // cache entry to mark as having a dynamic rewrite on mismatch. If a
    // mismatch occurs, the retry handler will traverse the known route tree
    // to find and mark the entry.
    null, // History traversal always uses 'replace'.
    'replace');
    return (0, _navigation.completeTraverseNavigation)(state, restoredUrl, renderedSearch, task.node, task.route, restoredNextUrl);
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=restore-reducer.js.map