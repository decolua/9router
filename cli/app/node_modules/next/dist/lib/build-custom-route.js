"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "buildCustomRoute", {
    enumerable: true,
    get: function() {
        return buildCustomRoute;
    }
});
const _pathtoregexp = require("next/dist/compiled/path-to-regexp");
const _loadcustomroutes = require("./load-custom-routes");
const _redirectstatus = require("./redirect-status");
function buildCustomRoute(type, route, restrictedRedirectPaths) {
    const compiled = (0, _pathtoregexp.pathToRegexp)(route.source, [], {
        strict: true,
        sensitive: false,
        delimiter: '/'
    });
    // If this is an internal rewrite and it already provides a regex, use it
    // otherwise, normalize the source to a regex.
    let regex;
    if (!route.internal || type !== 'rewrite' || !('regex' in route) || typeof route.regex !== 'string') {
        let source = compiled.source;
        if (!route.internal) {
            source = (0, _redirectstatus.modifyRouteRegex)(source, type === 'redirect' ? restrictedRedirectPaths : undefined);
        }
        regex = (0, _loadcustomroutes.normalizeRouteRegex)(source);
    } else {
        regex = route.regex;
    }
    if (type !== 'redirect') {
        return {
            ...route,
            regex
        };
    }
    return {
        ...route,
        statusCode: (0, _redirectstatus.getRedirectStatus)(route),
        permanent: undefined,
        regex
    };
}

//# sourceMappingURL=build-custom-route.js.map