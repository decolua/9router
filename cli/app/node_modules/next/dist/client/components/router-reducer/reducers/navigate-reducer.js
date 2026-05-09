"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DYNAMIC_STALETIME_MS: null,
    STATIC_STALETIME_MS: null,
    navigateReducer: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DYNAMIC_STALETIME_MS: function() {
        return DYNAMIC_STALETIME_MS;
    },
    STATIC_STALETIME_MS: function() {
        return STATIC_STALETIME_MS;
    },
    navigateReducer: function() {
        return navigateReducer;
    }
});
const _navigation = require("../../segment-cache/navigation");
const _cache = require("../../segment-cache/cache");
const _pprnavigations = require("../ppr-navigations");
const DYNAMIC_STALETIME_MS = Number(process.env.__NEXT_CLIENT_ROUTER_DYNAMIC_STALETIME) * 1000;
const STATIC_STALETIME_MS = (0, _cache.getStaleTimeMs)(Number(process.env.__NEXT_CLIENT_ROUTER_STATIC_STALETIME));
function navigateReducer(state, action) {
    const { url, isExternalUrl, navigateType, scrollBehavior } = action;
    if (isExternalUrl) {
        return (0, _navigation.completeHardNavigation)(state, url, navigateType);
    }
    // Handles case where `<meta http-equiv="refresh">` tag is present,
    // which will trigger an MPA navigation.
    if (document.getElementById('__next-page-redirect')) {
        return (0, _navigation.completeHardNavigation)(state, url, navigateType);
    }
    // Temporary glue code between the router reducer and the new navigation
    // implementation. Eventually we'll rewrite the router reducer to a
    // state machine.
    const currentUrl = new URL(state.canonicalUrl, location.origin);
    const currentRenderedSearch = state.renderedSearch;
    return (0, _navigation.navigate)(state, url, currentUrl, currentRenderedSearch, state.cache, state.tree, state.nextUrl, _pprnavigations.FreshnessPolicy.Default, scrollBehavior, navigateType);
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=navigate-reducer.js.map