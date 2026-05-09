"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    convertCustomRouteSource: null,
    createRouteTypesManifest: null,
    extractRouteParams: null,
    writeRouteTypesManifest: null,
    writeValidatorFile: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    convertCustomRouteSource: function() {
        return convertCustomRouteSource;
    },
    createRouteTypesManifest: function() {
        return createRouteTypesManifest;
    },
    extractRouteParams: function() {
        return extractRouteParams;
    },
    writeRouteTypesManifest: function() {
        return writeRouteTypesManifest;
    },
    writeValidatorFile: function() {
        return writeValidatorFile;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _routeregex = require("../../../shared/lib/router/utils/route-regex");
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _typegen = require("./typegen");
const _trytoparsepath = require("../../../lib/try-to-parse-path");
const _interceptionroutes = require("../../../shared/lib/router/utils/interception-routes");
const _entryconstants = require("../../../shared/lib/entry-constants");
const _normalizepathsep = require("../../../shared/lib/page-path/normalize-path-sep");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function convertCustomRouteSource(source) {
    const parseResult = (0, _trytoparsepath.tryToParsePath)(source);
    if (parseResult.error || !parseResult.tokens) {
        // Fallback to original source if parsing fails
        return source.startsWith('/') ? [
            source
        ] : [
            '/' + source
        ];
    }
    const possibleNormalizedRoutes = [
        ''
    ];
    let slugCnt = 1;
    function append(suffix) {
        for(let i = 0; i < possibleNormalizedRoutes.length; i++){
            possibleNormalizedRoutes[i] += suffix;
        }
    }
    function fork(suffix) {
        const currentLength = possibleNormalizedRoutes.length;
        for(let i = 0; i < currentLength; i++){
            possibleNormalizedRoutes.push(possibleNormalizedRoutes[i] + suffix);
        }
    }
    for (const token of parseResult.tokens){
        if (typeof token === 'object') {
            // Make sure the slug is always named.
            const slug = token.name || (slugCnt++ === 1 ? 'slug' : `slug${slugCnt}`);
            if (token.modifier === '*') {
                append(`${token.prefix}[[...${slug}]]`);
            } else if (token.modifier === '+') {
                append(`${token.prefix}[...${slug}]`);
            } else if (token.modifier === '') {
                if (token.pattern === '[^\\/#\\?]+?') {
                    // A safe slug
                    append(`${token.prefix}[${slug}]`);
                } else if (token.pattern === '.*') {
                    // An optional catch-all slug
                    append(`${token.prefix}[[...${slug}]]`);
                } else if (token.pattern === '.+') {
                    // A catch-all slug
                    append(`${token.prefix}[...${slug}]`);
                } else {
                    // Other regex patterns are not supported. Skip this route.
                    return [];
                }
            } else if (token.modifier === '?') {
                if (/^[a-zA-Z0-9_/]*$/.test(token.pattern)) {
                    // An optional slug with plain text only, fork the route.
                    append(token.prefix);
                    fork(token.pattern);
                } else {
                    // Optional modifier `?` and regex patterns are not supported.
                    return [];
                }
            }
        } else if (typeof token === 'string') {
            append(token);
        }
    }
    // Ensure leading slash
    return possibleNormalizedRoutes.map((route)=>route.startsWith('/') ? route : '/' + route);
}
function extractRouteParams(route) {
    const regex = (0, _routeregex.getRouteRegex)(route);
    return regex.groups;
}
/**
 * Resolves an intercepting route to its canonical equivalent
 * Example: /gallery/test/(..)photo/[id] -> /gallery/photo/[id]
 */ function resolveInterceptingRoute(route) {
    // Reuse centralized interception route normalization logic
    try {
        if (!(0, _interceptionroutes.isInterceptionRouteAppPath)(route)) return route;
        const { interceptedRoute } = (0, _interceptionroutes.extractInterceptionRouteInformation)(route);
        return interceptedRoute;
    } catch  {
        // If parsing fails, fall back to the original route
        return route;
    }
}
async function createRouteTypesManifest({ dir, pageRoutes, appRoutes, appRouteHandlers, pageApiRoutes, layoutRoutes, slots, redirects, rewrites, validatorFilePath }) {
    // Helper function to calculate the correct relative path
    const getRelativePath = (filePath)=>{
        if (validatorFilePath) {
            // For validator generation, calculate path relative to validator directory
            return (0, _normalizepathsep.normalizePathSep)(_path.default.relative(_path.default.dirname(validatorFilePath), filePath));
        }
        // For other uses, calculate path relative to project directory
        return (0, _normalizepathsep.normalizePathSep)(_path.default.relative(dir, filePath));
    };
    const manifest = {
        appRoutes: {},
        pageRoutes: {},
        layoutRoutes: {},
        appRouteHandlerRoutes: {},
        redirectRoutes: {},
        rewriteRoutes: {},
        appRouteHandlers: new Set(appRouteHandlers.map(({ filePath })=>getRelativePath(filePath))),
        pageApiRoutes: new Set(pageApiRoutes.map(({ filePath })=>getRelativePath(filePath))),
        appPagePaths: new Set(appRoutes.map(({ filePath })=>getRelativePath(filePath))),
        pagesRouterPagePaths: new Set(pageRoutes.map(({ filePath })=>getRelativePath(filePath))),
        layoutPaths: new Set(layoutRoutes.map(({ filePath })=>getRelativePath(filePath))),
        filePathToRoute: new Map([
            ...appRoutes.map(({ route, filePath })=>[
                    getRelativePath(filePath),
                    resolveInterceptingRoute(route)
                ]),
            ...layoutRoutes.map(({ route, filePath })=>[
                    getRelativePath(filePath),
                    resolveInterceptingRoute(route)
                ]),
            ...appRouteHandlers.map(({ route, filePath })=>[
                    getRelativePath(filePath),
                    resolveInterceptingRoute(route)
                ]),
            ...pageRoutes.map(({ route, filePath })=>[
                    getRelativePath(filePath),
                    route
                ]),
            ...pageApiRoutes.map(({ route, filePath })=>[
                    getRelativePath(filePath),
                    route
                ])
        ])
    };
    // Process page routes
    for (const { route, filePath } of pageRoutes){
        manifest.pageRoutes[route] = {
            path: getRelativePath(filePath),
            groups: extractRouteParams(route)
        };
    }
    // Process layout routes (exclude internal app error/not-found layouts)
    for (const { route, filePath } of layoutRoutes){
        if (route === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE || route === _entryconstants.UNDERSCORE_NOT_FOUND_ROUTE) continue;
        // Use the resolved route (for interception routes, this gives us the canonical route)
        const resolvedRoute = resolveInterceptingRoute(route);
        if (!manifest.layoutRoutes[resolvedRoute]) {
            manifest.layoutRoutes[resolvedRoute] = {
                path: getRelativePath(filePath),
                groups: extractRouteParams(resolvedRoute),
                slots: []
            };
        }
    }
    // Process slots
    for (const slot of slots){
        if (manifest.layoutRoutes[slot.parent]) {
            manifest.layoutRoutes[slot.parent].slots.push(slot.name);
        }
    }
    // Process app routes (exclude internal app routes)
    for (const { route, filePath } of appRoutes){
        if (route === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE || route === _entryconstants.UNDERSCORE_NOT_FOUND_ROUTE) continue;
        // Don't include metadata routes or pages
        if (!filePath.endsWith('page.ts') && !filePath.endsWith('page.tsx') && !filePath.endsWith('.mdx') && !filePath.endsWith('.md')) {
            continue;
        }
        // Use the resolved route (for interception routes, this gives us the canonical route)
        const resolvedRoute = resolveInterceptingRoute(route);
        if (!manifest.appRoutes[resolvedRoute]) {
            manifest.appRoutes[resolvedRoute] = {
                path: getRelativePath(filePath),
                groups: extractRouteParams(resolvedRoute)
            };
        }
    }
    // Process app route handlers
    for (const { route, filePath } of appRouteHandlers){
        // Use the resolved route (for interception routes, this gives us the canonical route)
        const resolvedRoute = resolveInterceptingRoute(route);
        if (!manifest.appRouteHandlerRoutes[resolvedRoute]) {
            manifest.appRouteHandlerRoutes[resolvedRoute] = {
                path: getRelativePath(filePath),
                groups: extractRouteParams(resolvedRoute)
            };
        }
    }
    // Process redirects
    if (typeof redirects === 'function') {
        const rd = await redirects();
        for (const item of rd){
            const possibleRoutes = convertCustomRouteSource(item.source);
            for (const route of possibleRoutes){
                manifest.redirectRoutes[route] = {
                    path: route,
                    groups: extractRouteParams(route)
                };
            }
        }
    }
    // Process rewrites
    if (typeof rewrites === 'function') {
        const rw = await rewrites();
        const allSources = Array.isArray(rw) ? rw : [
            ...(rw == null ? void 0 : rw.beforeFiles) || [],
            ...(rw == null ? void 0 : rw.afterFiles) || [],
            ...(rw == null ? void 0 : rw.fallback) || []
        ];
        for (const item of allSources){
            const possibleRoutes = convertCustomRouteSource(item.source);
            for (const route of possibleRoutes){
                manifest.rewriteRoutes[route] = {
                    path: route,
                    groups: extractRouteParams(route)
                };
            }
        }
    }
    return manifest;
}
async function writeRouteTypesManifest(manifest, filePath, config) {
    const dirname = _path.default.dirname(filePath);
    if (!_fs.default.existsSync(dirname)) {
        await _fs.default.promises.mkdir(dirname, {
            recursive: true
        });
    }
    // Write the main routes.d.ts file
    await _fs.default.promises.writeFile(filePath, config.experimental.strictRouteTypes ? (0, _typegen.generateRouteTypesFileStrict)(manifest) : (0, _typegen.generateRouteTypesFile)(manifest));
    // Write the link.d.ts file if typedRoutes is enabled
    if (config.typedRoutes === true) {
        const linkTypesPath = _path.default.join(dirname, 'link.d.ts');
        await _fs.default.promises.writeFile(linkTypesPath, (0, _typegen.generateLinkTypesFile)(manifest));
    }
}
async function writeValidatorFile(manifest, filePath, strict) {
    const dirname = _path.default.dirname(filePath);
    if (!_fs.default.existsSync(dirname)) {
        await _fs.default.promises.mkdir(dirname, {
            recursive: true
        });
    }
    await _fs.default.promises.writeFile(filePath, strict ? (0, _typegen.generateValidatorFileStrict)(manifest) : (0, _typegen.generateValidatorFile)(manifest));
}

//# sourceMappingURL=route-types-utils.js.map