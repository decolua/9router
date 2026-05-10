"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    buildDynamicSegmentPlaceholder: null,
    createOpaqueFallbackRouteParams: null,
    getFallbackRouteParams: null,
    getPlaceholderFallbackRouteParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    buildDynamicSegmentPlaceholder: function() {
        return buildDynamicSegmentPlaceholder;
    },
    createOpaqueFallbackRouteParams: function() {
        return createOpaqueFallbackRouteParams;
    },
    getFallbackRouteParams: function() {
        return getFallbackRouteParams;
    },
    getPlaceholderFallbackRouteParams: function() {
        return getPlaceholderFallbackRouteParams;
    }
});
const _utils = require("../../build/static-paths/utils");
const _getshortdynamicparamtype = require("../app-render/get-short-dynamic-param-type");
const _app = require("../../shared/lib/router/routes/app");
const _extractpathnamerouteparamsegmentsfromloadertree = require("../../build/static-paths/app/extract-pathname-route-param-segments-from-loader-tree");
const _getsegmentparam = require("../../shared/lib/router/utils/get-segment-param");
function createOpaqueFallbackRouteParams(fallbackRouteParams) {
    // If there are no fallback route params, we can return early.
    if (fallbackRouteParams.length === 0) return null;
    // As we're creating unique keys for each of the dynamic route params, we only
    // need to generate a unique ID once per request because each of the keys will
    // be also be unique.
    const uniqueID = Math.random().toString(16).slice(2);
    const keys = new Map();
    // Generate a unique key for the fallback route param, if this key is found
    // in the static output, it represents a bug in cache components.
    for (const { paramName, paramType } of fallbackRouteParams){
        keys.set(paramName, [
            `%%drp:${paramName}:${uniqueID}%%`,
            _getshortdynamicparamtype.dynamicParamTypes[paramType]
        ]);
    }
    return keys;
}
function buildDynamicSegmentPlaceholder(param) {
    const { repeat, optional } = (0, _getsegmentparam.getParamProperties)(param.paramType);
    if (optional) {
        return `[[...${param.paramName}]]`;
    }
    if (repeat) {
        return `[...${param.paramName}]`;
    }
    return `[${param.paramName}]`;
}
function getPlaceholderFallbackRouteParams(params, fallbackRouteParams) {
    return fallbackRouteParams.filter((param)=>{
        const placeholder = buildDynamicSegmentPlaceholder(param);
        const value = params == null ? void 0 : params[param.paramName];
        return value === placeholder || Array.isArray(value) && value.length === 1 && value[0] === placeholder;
    });
}
function getFallbackRouteParams(page, routeModule) {
    const route = (0, _app.parseAppRoute)(page, true);
    // Extract the pathname-contributing segments from the loader tree. This
    // mirrors the logic in buildAppStaticPaths where we determine which segments
    // actually contribute to the pathname.
    const { pathnameRouteParamSegments, params } = (0, _extractpathnamerouteparamsegmentsfromloadertree.extractPathnameRouteParamSegmentsFromLoaderTree)(routeModule.userland.loaderTree, route);
    // Create fallback route params for the pathname segments.
    const fallbackRouteParams = pathnameRouteParamSegments.map(({ paramName, paramType })=>({
            paramName,
            paramType
        }));
    // Resolve route params from the loader tree. This mutates the
    // fallbackRouteParams array to add any route params that are
    // unknown at request time.
    //
    // The page parameter contains placeholders like [slug], which helps
    // resolveRouteParamsFromTree determine which params are unknown.
    (0, _utils.resolveRouteParamsFromTree)(routeModule.userland.loaderTree, params, route, fallbackRouteParams // Will be mutated to add route params
    );
    // Convert the fallback route params to an opaque format that can be safely
    // used in the postponed state without exposing implementation details.
    return createOpaqueFallbackRouteParams(fallbackRouteParams);
}

//# sourceMappingURL=fallback-params.js.map