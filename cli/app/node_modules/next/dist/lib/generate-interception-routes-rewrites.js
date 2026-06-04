"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "generateInterceptionRoutesRewrites", {
    enumerable: true,
    get: function() {
        return generateInterceptionRoutesRewrites;
    }
});
const _approuterheaders = require("../client/components/app-router-headers");
const _interceptionroutes = require("../shared/lib/router/utils/interception-routes");
const _routeregex = require("../shared/lib/router/utils/route-regex");
function generateInterceptionRoutesRewrites(appPaths, basePath = '') {
    const rewrites = [];
    for (const appPath of appPaths){
        if ((0, _interceptionroutes.isInterceptionRouteAppPath)(appPath)) {
            const { interceptingRoute, interceptedRoute } = (0, _interceptionroutes.extractInterceptionRouteInformation)(appPath);
            const destination = (0, _routeregex.getNamedRouteRegex)(basePath + appPath, {
                prefixRouteKeys: true
            });
            const header = (0, _routeregex.getNamedRouteRegex)(interceptingRoute, {
                prefixRouteKeys: true,
                reference: destination.reference
            });
            const source = (0, _routeregex.getNamedRouteRegex)(basePath + interceptedRoute, {
                prefixRouteKeys: true,
                reference: header.reference
            });
            const headerRegex = header.namedRegex// Strip ^ and $ anchors since matchHas() will add them automatically
            .replace(/^\^/, '').replace(/\$$/, '')// Replace matching the `/` with matching any route segment.
            .replace(/^\/\(\?:\/\)\?$/, '/.*')// Replace the optional trailing with slash capture group with one that
            // will match any descendants.
            .replace(/\(\?:\/\)\?$/, '(?:/.*)?');
            rewrites.push({
                source: source.pathToRegexpPattern,
                destination: destination.pathToRegexpPattern,
                has: [
                    {
                        type: 'header',
                        key: _approuterheaders.NEXT_URL,
                        value: headerRegex
                    }
                ],
                regex: source.namedRegex
            });
        }
    }
    return rewrites;
}

//# sourceMappingURL=generate-interception-routes-rewrites.js.map