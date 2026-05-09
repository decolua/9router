"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getNamedMiddlewareRegex: null,
    getNamedRouteRegex: null,
    getRouteRegex: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getNamedMiddlewareRegex: function() {
        return getNamedMiddlewareRegex;
    },
    getNamedRouteRegex: function() {
        return getNamedRouteRegex;
    },
    getRouteRegex: function() {
        return getRouteRegex;
    }
});
const _constants = require("../../../../lib/constants");
const _interceptionroutes = require("./interception-routes");
const _escaperegexp = require("../../escape-regexp");
const _removetrailingslash = require("./remove-trailing-slash");
const _getdynamicparam = require("./get-dynamic-param");
function getParametrizedRoute(route, includeSuffix, includePrefix) {
    const groups = {};
    let groupIndex = 1;
    const segments = [];
    for (const segment of (0, _removetrailingslash.removeTrailingSlash)(route).slice(1).split('/')){
        const markerMatch = _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.find((m)=>segment.startsWith(m));
        const paramMatches = segment.match(_getdynamicparam.PARAMETER_PATTERN) // Check for parameters
        ;
        if (markerMatch && paramMatches && paramMatches[2]) {
            const { key, optional, repeat } = (0, _getdynamicparam.parseMatchedParameter)(paramMatches[2]);
            groups[key] = {
                pos: groupIndex++,
                repeat,
                optional
            };
            segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(markerMatch)}([^/]+?)`);
        } else if (paramMatches && paramMatches[2]) {
            const { key, repeat, optional } = (0, _getdynamicparam.parseMatchedParameter)(paramMatches[2]);
            groups[key] = {
                pos: groupIndex++,
                repeat,
                optional
            };
            if (includePrefix && paramMatches[1]) {
                segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(paramMatches[1])}`);
            }
            let s = repeat ? optional ? '(?:/(.+?))?' : '/(.+?)' : '/([^/]+?)';
            // Remove the leading slash if includePrefix already added it.
            if (includePrefix && paramMatches[1]) {
                s = s.substring(1);
            }
            segments.push(s);
        } else {
            segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(segment)}`);
        }
        // If there's a suffix, add it to the segments if it's enabled.
        if (includeSuffix && paramMatches && paramMatches[3]) {
            segments.push((0, _escaperegexp.escapeStringRegexp)(paramMatches[3]));
        }
    }
    return {
        parameterizedRoute: segments.join(''),
        groups
    };
}
function getRouteRegex(normalizedRoute, { includeSuffix = false, includePrefix = false, excludeOptionalTrailingSlash = false } = {}) {
    const { parameterizedRoute, groups } = getParametrizedRoute(normalizedRoute, includeSuffix, includePrefix);
    let re = parameterizedRoute;
    if (!excludeOptionalTrailingSlash) {
        re += '(?:/)?';
    }
    return {
        re: new RegExp(`^${re}$`),
        groups: groups
    };
}
/**
 * Builds a function to generate a minimal routeKey using only a-z and minimal
 * number of characters.
 */ function buildGetSafeRouteKey() {
    let i = 0;
    return ()=>{
        let routeKey = '';
        let j = ++i;
        while(j > 0){
            routeKey += String.fromCharCode(97 + (j - 1) % 26);
            j = Math.floor((j - 1) / 26);
        }
        return routeKey;
    };
}
function getSafeKeyFromSegment({ interceptionMarker, getSafeRouteKey, segment, routeKeys, keyPrefix, backreferenceDuplicateKeys }) {
    const { key, optional, repeat } = (0, _getdynamicparam.parseMatchedParameter)(segment);
    // replace any non-word characters since they can break
    // the named regex
    let cleanedKey = key.replace(/\W/g, '');
    if (keyPrefix) {
        cleanedKey = `${keyPrefix}${cleanedKey}`;
    }
    let invalidKey = false;
    // check if the key is still invalid and fallback to using a known
    // safe key
    if (cleanedKey.length === 0 || cleanedKey.length > 30) {
        invalidKey = true;
    }
    if (!isNaN(parseInt(cleanedKey.slice(0, 1)))) {
        invalidKey = true;
    }
    if (invalidKey) {
        cleanedKey = getSafeRouteKey();
    }
    const duplicateKey = cleanedKey in routeKeys;
    if (keyPrefix) {
        routeKeys[cleanedKey] = `${keyPrefix}${key}`;
    } else {
        routeKeys[cleanedKey] = key;
    }
    // if the segment has an interception marker, make sure that's part of the regex pattern
    // this is to ensure that the route with the interception marker doesn't incorrectly match
    // the non-intercepted route (ie /app/(.)[username] should not match /app/[username])
    const interceptionPrefix = interceptionMarker ? (0, _escaperegexp.escapeStringRegexp)(interceptionMarker) : '';
    let pattern;
    if (duplicateKey && backreferenceDuplicateKeys) {
        // Use a backreference to the key to ensure that the key is the same value
        // in each of the placeholders.
        pattern = `\\k<${cleanedKey}>`;
    } else if (repeat) {
        pattern = `(?<${cleanedKey}>.+?)`;
    } else {
        pattern = `(?<${cleanedKey}>[^/]+?)`;
    }
    return {
        key,
        pattern: optional ? `(?:/${interceptionPrefix}${pattern})?` : `/${interceptionPrefix}${pattern}`,
        cleanedKey: cleanedKey,
        optional,
        repeat
    };
}
function getNamedParametrizedRoute(route, prefixRouteKeys, includeSuffix, includePrefix, backreferenceDuplicateKeys, reference = {
    names: {},
    intercepted: {}
}) {
    const getSafeRouteKey = buildGetSafeRouteKey();
    const routeKeys = {};
    const segments = [];
    const inverseParts = [];
    // Ensure we don't mutate the original reference object.
    reference = structuredClone(reference);
    for (const segment of (0, _removetrailingslash.removeTrailingSlash)(route).slice(1).split('/')){
        const hasInterceptionMarker = _interceptionroutes.INTERCEPTION_ROUTE_MARKERS.some((m)=>segment.startsWith(m));
        const paramMatches = segment.match(_getdynamicparam.PARAMETER_PATTERN) // Check for parameters
        ;
        const interceptionMarker = hasInterceptionMarker ? paramMatches?.[1] : undefined;
        let keyPrefix;
        if (interceptionMarker && paramMatches?.[2]) {
            keyPrefix = prefixRouteKeys ? _constants.NEXT_INTERCEPTION_MARKER_PREFIX : undefined;
            reference.intercepted[paramMatches[2]] = interceptionMarker;
        } else if (paramMatches?.[2] && reference.intercepted[paramMatches[2]]) {
            keyPrefix = prefixRouteKeys ? _constants.NEXT_INTERCEPTION_MARKER_PREFIX : undefined;
        } else {
            keyPrefix = prefixRouteKeys ? _constants.NEXT_QUERY_PARAM_PREFIX : undefined;
        }
        if (interceptionMarker && paramMatches && paramMatches[2]) {
            // If there's an interception marker, add it to the segments.
            const { key, pattern, cleanedKey, repeat, optional } = getSafeKeyFromSegment({
                getSafeRouteKey,
                interceptionMarker,
                segment: paramMatches[2],
                routeKeys,
                keyPrefix,
                backreferenceDuplicateKeys
            });
            segments.push(pattern);
            inverseParts.push(`/${paramMatches[1]}:${reference.names[key] ?? cleanedKey}${repeat ? optional ? '*' : '+' : ''}`);
            reference.names[key] ??= cleanedKey;
        } else if (paramMatches && paramMatches[2]) {
            // If there's a prefix, add it to the segments if it's enabled.
            if (includePrefix && paramMatches[1]) {
                segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(paramMatches[1])}`);
                inverseParts.push(`/${paramMatches[1]}`);
            }
            const { key, pattern, cleanedKey, repeat, optional } = getSafeKeyFromSegment({
                getSafeRouteKey,
                segment: paramMatches[2],
                routeKeys,
                keyPrefix,
                backreferenceDuplicateKeys
            });
            // Remove the leading slash if includePrefix already added it.
            let s = pattern;
            if (includePrefix && paramMatches[1]) {
                s = s.substring(1);
            }
            segments.push(s);
            inverseParts.push(`/:${reference.names[key] ?? cleanedKey}${repeat ? optional ? '*' : '+' : ''}`);
            reference.names[key] ??= cleanedKey;
        } else {
            segments.push(`/${(0, _escaperegexp.escapeStringRegexp)(segment)}`);
            inverseParts.push(`/${segment}`);
        }
        // If there's a suffix, add it to the segments if it's enabled.
        if (includeSuffix && paramMatches && paramMatches[3]) {
            segments.push((0, _escaperegexp.escapeStringRegexp)(paramMatches[3]));
            inverseParts.push(paramMatches[3]);
        }
    }
    return {
        namedParameterizedRoute: segments.join(''),
        routeKeys,
        pathToRegexpPattern: inverseParts.join(''),
        reference
    };
}
function getNamedRouteRegex(normalizedRoute, options) {
    const result = getNamedParametrizedRoute(normalizedRoute, options.prefixRouteKeys, options.includeSuffix ?? false, options.includePrefix ?? false, options.backreferenceDuplicateKeys ?? false, options.reference);
    let namedRegex = result.namedParameterizedRoute;
    if (!options.excludeOptionalTrailingSlash) {
        namedRegex += '(?:/)?';
    }
    return {
        ...getRouteRegex(normalizedRoute, options),
        namedRegex: `^${namedRegex}$`,
        routeKeys: result.routeKeys,
        pathToRegexpPattern: result.pathToRegexpPattern,
        reference: result.reference
    };
}
function getNamedMiddlewareRegex(normalizedRoute, options) {
    const { parameterizedRoute } = getParametrizedRoute(normalizedRoute, false, false);
    const { catchAll = true } = options;
    if (parameterizedRoute === '/') {
        let catchAllRegex = catchAll ? '.*' : '';
        return {
            namedRegex: `^/${catchAllRegex}$`
        };
    }
    const { namedParameterizedRoute } = getNamedParametrizedRoute(normalizedRoute, false, false, false, false, undefined);
    let catchAllGroupedRegex = catchAll ? '(?:(/.*)?)' : '';
    return {
        namedRegex: `^${namedParameterizedRoute}${catchAllGroupedRegex}$`
    };
}

//# sourceMappingURL=route-regex.js.map