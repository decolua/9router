"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    encodeParam: null,
    extractPathnameRouteParamSegments: null,
    extractPathnameRouteParamSegmentsFromSegments: null,
    normalizePathname: null,
    resolveRouteParamsFromTree: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    encodeParam: function() {
        return encodeParam;
    },
    extractPathnameRouteParamSegments: function() {
        return extractPathnameRouteParamSegments;
    },
    extractPathnameRouteParamSegmentsFromSegments: function() {
        return extractPathnameRouteParamSegmentsFromSegments;
    },
    normalizePathname: function() {
        return normalizePathname;
    },
    resolveRouteParamsFromTree: function() {
        return resolveRouteParamsFromTree;
    }
});
const _checks = require("../../server/route-modules/checks");
const _app = require("../../shared/lib/router/routes/app");
const _parseloadertree = require("../../shared/lib/router/utils/parse-loader-tree");
const _extractpathnamerouteparamsegmentsfromloadertree = require("./app/extract-pathname-route-param-segments-from-loader-tree");
const _resolveparamvalue = require("../../shared/lib/router/utils/resolve-param-value");
function encodeParam(value, encoder) {
    let replaceValue;
    if (Array.isArray(value)) {
        replaceValue = value.map(encoder).join('/');
    } else {
        replaceValue = encoder(value);
    }
    return replaceValue;
}
function normalizePathname(pathname) {
    return pathname.replace(/\\/g, '/').replace(/(?!^)\/$/, '');
}
function extractPathnameRouteParamSegments(routeModule, segments, route) {
    // For AppPageRouteModule, use the loaderTree traversal approach
    if ((0, _checks.isAppPageRouteModule)(routeModule)) {
        const { pathnameRouteParamSegments } = (0, _extractpathnamerouteparamsegmentsfromloadertree.extractPathnameRouteParamSegmentsFromLoaderTree)(routeModule.userland.loaderTree, route);
        return pathnameRouteParamSegments;
    }
    return extractPathnameRouteParamSegmentsFromSegments(segments);
}
function extractPathnameRouteParamSegmentsFromSegments(segments) {
    // TODO: should we consider what values are already present in the page?
    // For AppRouteRouteModule, filter the segments array to get the route params
    // that contribute to the pathname.
    const result = [];
    for (const segment of segments){
        // Skip segments without param info.
        if (!segment.paramName || !segment.paramType) continue;
        // Collect all the route param keys that contribute to the pathname.
        result.push({
            name: segment.name,
            paramName: segment.paramName,
            paramType: segment.paramType
        });
    }
    return result;
}
function resolveRouteParamsFromTree(loaderTree, params, route, fallbackRouteParams) {
    // Stack-based traversal with depth tracking
    const stack = [
        {
            tree: loaderTree,
            depth: 0
        }
    ];
    while(stack.length > 0){
        const { tree, depth } = stack.pop();
        const { segment, parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
        const appSegment = (0, _app.parseAppRouteSegment)(segment);
        // If this segment is a route parameter, then we should process it if it's
        // not already known and is not already marked as a fallback route param.
        if ((appSegment == null ? void 0 : appSegment.type) === 'dynamic' && !params.hasOwnProperty(appSegment.param.paramName) && !fallbackRouteParams.some((param)=>param.paramName === appSegment.param.paramName)) {
            const { paramName, paramType } = appSegment.param;
            const paramValue = (0, _resolveparamvalue.resolveParamValue)(paramName, paramType, depth, route, params);
            if (paramValue !== undefined) {
                params[paramName] = paramValue;
            } else if (paramType !== 'optional-catchall') {
                // If we couldn't resolve the param, mark it as a fallback
                fallbackRouteParams.push({
                    paramName,
                    paramType
                });
            }
        }
        // Calculate next depth - increment if this is not a route group and not empty
        let nextDepth = depth;
        if (appSegment && appSegment.type !== 'route-group' && appSegment.type !== 'parallel-route') {
            nextDepth++;
        }
        // Add all parallel routes to the stack for processing.
        for (const parallelRoute of Object.values(parallelRoutes)){
            stack.push({
                tree: parallelRoute,
                depth: nextDepth
            });
        }
    }
}

//# sourceMappingURL=utils.js.map