"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    NestedMiddlewareError: null,
    RSPACK_DEFAULT_LAYERS_REGEX: null,
    collectMeta: null,
    collectRoutesUsingEdgeRuntime: null,
    copyTracedFiles: null,
    detectConflictingPaths: null,
    difference: null,
    filterAndSortList: null,
    getDefinedNamedExports: null,
    getPossibleInstrumentationHookFilenames: null,
    getPossibleMiddlewareFilenames: null,
    getSupportedBrowsers: null,
    hasCustomGetInitialProps: null,
    isAppBuiltinPage: null,
    isCustomErrorPage: null,
    isInstrumentationHookFile: null,
    isInstrumentationHookFilename: null,
    isMiddlewareFile: null,
    isMiddlewareFilename: null,
    isPageStatic: null,
    isProxyFile: null,
    isReservedPage: null,
    isWebpackAppPagesLayer: null,
    isWebpackBundledLayer: null,
    isWebpackClientOnlyLayer: null,
    isWebpackDefaultLayer: null,
    pageToRoute: null,
    printCustomRoutes: null,
    printTreeView: null,
    reduceAppConfig: null,
    shouldUseReactServerCondition: null,
    unique: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    NestedMiddlewareError: function() {
        return NestedMiddlewareError;
    },
    RSPACK_DEFAULT_LAYERS_REGEX: function() {
        return RSPACK_DEFAULT_LAYERS_REGEX;
    },
    collectMeta: function() {
        return collectMeta;
    },
    collectRoutesUsingEdgeRuntime: function() {
        return collectRoutesUsingEdgeRuntime;
    },
    copyTracedFiles: function() {
        return copyTracedFiles;
    },
    detectConflictingPaths: function() {
        return detectConflictingPaths;
    },
    difference: function() {
        return difference;
    },
    filterAndSortList: function() {
        return filterAndSortList;
    },
    getDefinedNamedExports: function() {
        return getDefinedNamedExports;
    },
    getPossibleInstrumentationHookFilenames: function() {
        return getPossibleInstrumentationHookFilenames;
    },
    getPossibleMiddlewareFilenames: function() {
        return getPossibleMiddlewareFilenames;
    },
    getSupportedBrowsers: function() {
        return _getsupportedbrowsers.getSupportedBrowsers;
    },
    hasCustomGetInitialProps: function() {
        return hasCustomGetInitialProps;
    },
    isAppBuiltinPage: function() {
        return isAppBuiltinPage;
    },
    isCustomErrorPage: function() {
        return isCustomErrorPage;
    },
    isInstrumentationHookFile: function() {
        return isInstrumentationHookFile;
    },
    isInstrumentationHookFilename: function() {
        return isInstrumentationHookFilename;
    },
    isMiddlewareFile: function() {
        return isMiddlewareFile;
    },
    isMiddlewareFilename: function() {
        return isMiddlewareFilename;
    },
    isPageStatic: function() {
        return isPageStatic;
    },
    isProxyFile: function() {
        return isProxyFile;
    },
    isReservedPage: function() {
        return isReservedPage;
    },
    isWebpackAppPagesLayer: function() {
        return isWebpackAppPagesLayer;
    },
    isWebpackBundledLayer: function() {
        return isWebpackBundledLayer;
    },
    isWebpackClientOnlyLayer: function() {
        return isWebpackClientOnlyLayer;
    },
    isWebpackDefaultLayer: function() {
        return isWebpackDefaultLayer;
    },
    pageToRoute: function() {
        return pageToRoute;
    },
    printCustomRoutes: function() {
        return printCustomRoutes;
    },
    printTreeView: function() {
        return printTreeView;
    },
    reduceAppConfig: function() {
        return reduceAppConfig;
    },
    shouldUseReactServerCondition: function() {
        return shouldUseReactServerCondition;
    },
    unique: function() {
        return unique;
    }
});
const _ppr = require("../server/lib/experimental/ppr");
const _loadcustomroutes = require("../lib/load-custom-routes");
const _constants = require("../lib/constants");
require("../server/require-hook");
require("../server/node-polyfill-crypto");
require("../server/node-environment");
const _picocolors = require("../lib/picocolors");
const _texttable = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/text-table"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _fs = require("fs");
const _reactis = require("next/dist/compiled/react-is");
const _stripansi = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/strip-ansi"));
const _constants1 = require("../shared/lib/constants");
const _isdynamic = require("../shared/lib/router/utils/is-dynamic");
const _findpagefile = require("../server/lib/find-page-file");
const _isedgeruntime = require("../lib/is-edge-runtime");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("./output/log"));
const _loadcomponents = require("../server/load-components");
const _trace = require("../trace");
const _setuphttpagentenv = require("../server/setup-http-agent-env");
const _asyncsema = require("next/dist/compiled/async-sema");
const _normalizepagepath = require("../shared/lib/page-path/normalize-page-path");
const _sandbox = require("../server/web/sandbox");
const _routekind = require("../server/route-kind");
const _appsegments = require("./segment-config/app/app-segments");
const _createincrementalcache = require("../export/helpers/create-incremental-cache");
const _collectrootparamkeys = require("./segment-config/app/collect-root-param-keys");
const _app = require("./static-paths/app");
const _pages = require("./static-paths/pages");
const _format = require("./output/format");
const _routeregex = require("../shared/lib/router/utils/route-regex");
const _app1 = require("../shared/lib/router/routes/app");
const _getmetadataroute = require("../lib/metadata/get-metadata-route");
const _ismetadataroute = require("../lib/metadata/is-metadata-route");
const _getsupportedbrowsers = require("./get-supported-browsers");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
// Build a set of static metadata image filenames for quick lookup
const staticMetadataImageFilenames = new Set(Object.values(_ismetadataroute.STATIC_METADATA_IMAGES).map((meta)=>meta.filename));
/**
 * Get the display path for build output. For static metadata files under
 * dynamic routes, this normalizes the path to use "-" placeholder.
 * e.g., /dynamic/[id]/icon.png -> /dynamic/-/icon.png
 */ function getTreeViewDisplayPath(pagePath) {
    // Check if the path contains dynamic segments
    if (!(0, _isdynamic.isDynamicRoute)(pagePath)) {
        return pagePath;
    }
    // Check if the filename is a static metadata image
    const lastSlash = pagePath.lastIndexOf('/');
    const filename = pagePath.slice(lastSlash + 1);
    const dotIndex = filename.lastIndexOf('.');
    const baseName = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    // Check against known static metadata image filenames (e.g., icon, apple-icon, opengraph-image)
    if (!staticMetadataImageFilenames.has(baseName)) {
        return pagePath;
    }
    // Transform using fillMetadataSegment with isStatic=true
    const segment = pagePath.slice(0, lastSlash);
    const lastSegment = filename;
    return (0, _getmetadataroute.fillMetadataSegment)(segment, {}, lastSegment, true);
}
// Use `print()` for expected console output
const print = console.log;
const RESERVED_PAGE = /^\/(_app|_error|_document|api(\/|$))/;
function unique(main, sub) {
    return [
        ...new Set([
            ...main,
            ...sub
        ])
    ];
}
function difference(main, sub) {
    const a = new Set(main);
    const b = new Set(sub);
    return [
        ...a
    ].filter((x)=>!b.has(x));
}
function isMiddlewareFilename(file) {
    return file === _constants.MIDDLEWARE_FILENAME || file === `src/${_constants.MIDDLEWARE_FILENAME}` || file === _constants.PROXY_FILENAME || file === `src/${_constants.PROXY_FILENAME}`;
}
function isInstrumentationHookFilename(file) {
    return file === _constants.INSTRUMENTATION_HOOK_FILENAME || file === `src/${_constants.INSTRUMENTATION_HOOK_FILENAME}`;
}
const filterAndSortList = (list, routeType, hasCustomApp)=>{
    let pages;
    if (routeType === 'app') {
        // filter out static app route of /favicon.ico and /_global-error
        pages = list.filter((e)=>{
            if (e === '/favicon.ico') return false;
            // Hide static /_global-error from build output
            if (e === '/_global-error') return false;
            return true;
        });
    } else {
        // filter built-in pages
        pages = list.slice().filter((e)=>!(e === '/_document' || e === '/_error' || !hasCustomApp && e === '/_app'));
    }
    return pages.sort((a, b)=>a.localeCompare(b));
};
function collectRoutesUsingEdgeRuntime(input) {
    const routesUsingEdgeRuntime = {};
    for (const [route, info] of input.entries()){
        if ((0, _isedgeruntime.isEdgeRuntime)(info.runtime)) {
            routesUsingEdgeRuntime[route] = 0;
        }
    }
    return routesUsingEdgeRuntime;
}
async function printTreeView(lists, pageInfos, { pagesDir, pageExtensions, middlewareManifest, functionsConfigManifest, useStaticPages404, hasGSPAndRevalidateZero }) {
    var _lists_app, _middlewareManifest_middleware_, _middlewareManifest_middleware, // 'nodejs' runtime middleware or proxy is set to
    // functions-config-manifest instead of middleware-manifest.
    _functionsConfigManifest_functions;
    // Can be overridden for test purposes to omit the build duration output.
    const MIN_DURATION = process.env.__NEXT_PRIVATE_DETERMINISTIC_BUILD_OUTPUT ? Infinity // Don't ever log build durations.
     : 300;
    const getPrettyDuration = (_duration)=>{
        const duration = `${_duration} ms`;
        // green for 300-1000ms
        if (_duration < 1000) return (0, _picocolors.green)(duration);
        // yellow for 1000-2000ms
        if (_duration < 2000) return (0, _picocolors.yellow)(duration);
        // red for >= 2000ms
        return (0, _picocolors.red)((0, _picocolors.bold)(duration));
    };
    // Check if we have a custom app.
    const hasCustomApp = !!(pagesDir && await (0, _findpagefile.findPageFile)(pagesDir, '/_app', pageExtensions, false));
    // Collect all the symbols we use so we can print the icons out.
    const usedSymbols = new Set();
    const messages = [];
    const printFileTree = async ({ list, routerType })=>{
        const filteredPages = filterAndSortList(list, routerType, hasCustomApp);
        if (filteredPages.length === 0) {
            return;
        }
        let showRevalidate = false;
        let showExpire = false;
        for (const page of filteredPages){
            var _pageInfos_get;
            const cacheControl = (_pageInfos_get = pageInfos.get(page)) == null ? void 0 : _pageInfos_get.initialCacheControl;
            if (cacheControl == null ? void 0 : cacheControl.revalidate) {
                showRevalidate = true;
            }
            if (cacheControl == null ? void 0 : cacheControl.expire) {
                showExpire = true;
            }
            if (showRevalidate && showExpire) {
                break;
            }
        }
        messages.push([
            routerType === 'app' ? 'Route (app)' : 'Route (pages)',
            showRevalidate ? 'Revalidate' : '',
            showExpire ? 'Expire' : ''
        ].filter((entry)=>entry !== '').map((entry)=>(0, _picocolors.underline)(entry)));
        filteredPages.forEach((item, i, arr)=>{
            var _pageInfo_ssgPageDurations, _pageInfo_ssgPageRoutes;
            const border = i === 0 ? arr.length === 1 ? '─' : '┌' : i === arr.length - 1 ? '└' : '├';
            const pageInfo = pageInfos.get(item);
            const totalDuration = ((pageInfo == null ? void 0 : pageInfo.pageDuration) || 0) + ((pageInfo == null ? void 0 : (_pageInfo_ssgPageDurations = pageInfo.ssgPageDurations) == null ? void 0 : _pageInfo_ssgPageDurations.reduce((a, b)=>a + (b || 0), 0)) || 0);
            let symbol;
            if (item === '/_app' || item === '/_app.server') {
                symbol = ' ';
            } else if ((0, _isedgeruntime.isEdgeRuntime)(pageInfo == null ? void 0 : pageInfo.runtime)) {
                symbol = 'ƒ';
            } else if (pageInfo == null ? void 0 : pageInfo.isRoutePPREnabled) {
                if (// If the page has an empty static shell, then it's equivalent to a
                // dynamic page
                (pageInfo == null ? void 0 : pageInfo.hasEmptyStaticShell) || // ensure we don't mark dynamic paths that postponed as being dynamic
                // since in this case we're able to partially prerender it
                pageInfo.isDynamicAppRoute && !pageInfo.hasPostponed) {
                    symbol = 'ƒ';
                } else if (!(pageInfo == null ? void 0 : pageInfo.hasPostponed)) {
                    symbol = '○';
                } else {
                    symbol = '◐';
                }
            } else if (pageInfo == null ? void 0 : pageInfo.isStatic) {
                symbol = '○';
            } else if (pageInfo == null ? void 0 : pageInfo.isSSG) {
                symbol = '●';
            } else {
                symbol = 'ƒ';
            }
            const displayPath = getTreeViewDisplayPath(item);
            if (hasGSPAndRevalidateZero.has(item)) {
                usedSymbols.add('ƒ');
                messages.push([
                    `${border} ƒ ${displayPath}${totalDuration > MIN_DURATION ? ` (${getPrettyDuration(totalDuration)})` : ''}`,
                    showRevalidate && (pageInfo == null ? void 0 : pageInfo.initialCacheControl) ? (0, _format.formatRevalidate)(pageInfo.initialCacheControl) : '',
                    showExpire && (pageInfo == null ? void 0 : pageInfo.initialCacheControl) ? (0, _format.formatExpire)(pageInfo.initialCacheControl) : ''
                ]);
            }
            usedSymbols.add(symbol);
            messages.push([
                `${border} ${symbol} ${displayPath}${totalDuration > MIN_DURATION ? ` (${getPrettyDuration(totalDuration)})` : ''}`,
                showRevalidate && (pageInfo == null ? void 0 : pageInfo.initialCacheControl) ? (0, _format.formatRevalidate)(pageInfo.initialCacheControl) : '',
                showExpire && (pageInfo == null ? void 0 : pageInfo.initialCacheControl) ? (0, _format.formatExpire)(pageInfo.initialCacheControl) : ''
            ]);
            if (pageInfo == null ? void 0 : (_pageInfo_ssgPageRoutes = pageInfo.ssgPageRoutes) == null ? void 0 : _pageInfo_ssgPageRoutes.length) {
                var _pageInfo_ssgPageDurations1;
                const totalRoutes = pageInfo.ssgPageRoutes.length;
                const contSymbol = i === arr.length - 1 ? ' ' : '│';
                // HERE
                let routes;
                if ((_pageInfo_ssgPageDurations1 = pageInfo.ssgPageDurations) == null ? void 0 : _pageInfo_ssgPageDurations1.some((d)=>d > MIN_DURATION)) {
                    const previewPages = totalRoutes === 8 ? 8 : Math.min(totalRoutes, 7);
                    const routesWithDuration = pageInfo.ssgPageRoutes.map((route, idx)=>({
                            route,
                            duration: pageInfo.ssgPageDurations[idx] || 0
                        })).sort(({ duration: a }, { duration: b })=>// Sort by duration
                        // keep too small durations in original order at the end
                        a <= MIN_DURATION && b <= MIN_DURATION ? 0 : b - a);
                    routes = routesWithDuration.slice(0, previewPages);
                    const remainingRoutes = routesWithDuration.slice(previewPages);
                    if (remainingRoutes.length) {
                        const remaining = remainingRoutes.length;
                        const avgDuration = Math.round(remainingRoutes.reduce((total, { duration })=>total + duration, 0) / remainingRoutes.length);
                        routes.push({
                            route: `[+${remaining} more paths]`,
                            duration: 0,
                            avgDuration
                        });
                    }
                } else {
                    const previewPages = totalRoutes === 4 ? 4 : Math.min(totalRoutes, 3);
                    routes = pageInfo.ssgPageRoutes.slice(0, previewPages).map((route)=>({
                            route,
                            duration: 0
                        }));
                    if (totalRoutes > previewPages) {
                        const remaining = totalRoutes - previewPages;
                        routes.push({
                            route: `[+${remaining} more paths]`,
                            duration: 0
                        });
                    }
                }
                routes.forEach(({ route, duration, avgDuration }, index, { length })=>{
                    var _pageInfos_get;
                    const innerSymbol = index === length - 1 ? '└' : '├';
                    const initialCacheControl = (_pageInfos_get = pageInfos.get(route)) == null ? void 0 : _pageInfos_get.initialCacheControl;
                    messages.push([
                        `${contSymbol} ${innerSymbol} ${route}${duration > MIN_DURATION ? ` (${getPrettyDuration(duration)})` : ''}${avgDuration && avgDuration > MIN_DURATION ? ` (avg ${getPrettyDuration(avgDuration)})` : ''}`,
                        showRevalidate && initialCacheControl ? (0, _format.formatRevalidate)(initialCacheControl) : '',
                        showExpire && initialCacheControl ? (0, _format.formatExpire)(initialCacheControl) : ''
                    ]);
                });
            }
        });
    };
    // If enabled, then print the tree for the app directory.
    if (lists.app) {
        await printFileTree({
            routerType: 'app',
            list: lists.app
        });
        messages.push([
            '',
            '',
            '',
            ''
        ]);
    }
    pageInfos.set('/404', {
        ...pageInfos.get('/404') || pageInfos.get('/_error'),
        isStatic: useStaticPages404
    });
    // If there's no app /_notFound page present, then the 404 is still using the pages/404
    if (!lists.pages.includes('/404') && !((_lists_app = lists.app) == null ? void 0 : _lists_app.includes(_constants1.UNDERSCORE_NOT_FOUND_ROUTE))) {
        lists.pages = [
            ...lists.pages,
            '/404'
        ];
    }
    // Print the tree view for the pages directory.
    await printFileTree({
        routerType: 'pages',
        list: lists.pages
    });
    if (((_middlewareManifest_middleware = middlewareManifest.middleware) == null ? void 0 : (_middlewareManifest_middleware_ = _middlewareManifest_middleware['/']) == null ? void 0 : _middlewareManifest_middleware_.files.length) > 0 || ((_functionsConfigManifest_functions = functionsConfigManifest.functions) == null ? void 0 : _functionsConfigManifest_functions['/_middleware'])) {
        messages.push([]);
        messages.push([
            'ƒ Proxy (Middleware)'
        ]);
    }
    print((0, _texttable.default)(messages, {
        align: [
            'l',
            'r',
            'r',
            'r'
        ],
        stringLength: (str)=>(0, _stripansi.default)(str).length
    }));
    const staticFunctionInfo = lists.app ? 'generateStaticParams' : 'getStaticProps';
    print();
    print((0, _texttable.default)([
        usedSymbols.has('○') && [
            '○',
            '(Static)',
            'prerendered as static content'
        ],
        usedSymbols.has('●') && [
            '●',
            '(SSG)',
            `prerendered as static HTML (uses ${(0, _picocolors.cyan)(staticFunctionInfo)})`
        ],
        usedSymbols.has('◐') && [
            '◐',
            '(Partial Prerender)',
            'prerendered as static HTML with dynamic server-streamed content'
        ],
        usedSymbols.has('ƒ') && [
            'ƒ',
            '(Dynamic)',
            `server-rendered on demand`
        ]
    ].filter((x)=>x), {
        align: [
            'l',
            'l',
            'l'
        ],
        stringLength: (str)=>(0, _stripansi.default)(str).length
    }));
    print();
}
function printCustomRoutes({ redirects, rewrites, headers, onMatchHeaders }) {
    const printRoutes = (routes, type)=>{
        const isRedirects = type === 'Redirects';
        const isHeaders = type === 'Headers' || type === 'On Match Headers';
        print((0, _picocolors.underline)(type));
        /*
        ┌ source
        ├ permanent/statusCode
        └ destination
     */ const routesStr = routes.map((route)=>{
            let routeStr = `┌ source: ${route.source}\n`;
            if (!isHeaders) {
                const r = route;
                routeStr += `${isRedirects ? '├' : '└'} destination: ${r.destination}\n`;
            }
            if (isRedirects) {
                const r = route;
                routeStr += `└ ${r.statusCode ? `status: ${r.statusCode}` : `permanent: ${r.permanent}`}\n`;
            }
            if (isHeaders) {
                const r = route;
                routeStr += `└ headers:\n`;
                for(let i = 0; i < r.headers.length; i++){
                    const header = r.headers[i];
                    const last = i === headers.length - 1;
                    routeStr += `  ${last ? '└' : '├'} ${header.key}: ${header.value}\n`;
                }
            }
            return routeStr;
        }).join('\n');
        print(`${routesStr}\n`);
    };
    print();
    if (redirects.length) {
        printRoutes(redirects, 'Redirects');
    }
    if (headers.length) {
        printRoutes(headers, 'Headers');
    }
    if (onMatchHeaders.length) {
        printRoutes(onMatchHeaders, 'On Match Headers');
    }
    const combinedRewrites = [
        ...rewrites.beforeFiles,
        ...rewrites.afterFiles,
        ...rewrites.fallback
    ];
    if (combinedRewrites.length) {
        printRoutes(combinedRewrites, 'Rewrites');
    }
}
async function isPageStatic({ dir, page, distDir, configFileName, httpAgentOptions, locales, defaultLocale, parentId, pageRuntime, edgeInfo, pageType, cacheComponents, authInterrupts, originalAppPath, isrFlushToDisk, cacheMaxMemorySize, nextConfigOutput, cacheHandler, cacheHandlers, cacheLifeProfiles, pprConfig, partialFallbacksEnabled, buildId, clientAssetToken, sriEnabled }) {
    // Skip page data collection for synthetic _global-error routes
    if (page === _constants1.UNDERSCORE_GLOBAL_ERROR_ROUTE) {
        return {
            isStatic: true,
            isRoutePPREnabled: false,
            prerenderFallbackMode: undefined,
            prerenderedRoutes: undefined,
            rootParamKeys: undefined,
            hasStaticProps: false,
            hasServerProps: false,
            isNextImageImported: false,
            appConfig: {}
        };
    }
    await (0, _createincrementalcache.createIncrementalCache)({
        cacheHandler,
        cacheHandlers,
        distDir,
        dir,
        flushToDisk: isrFlushToDisk,
        cacheMaxMemorySize
    });
    const isPageStaticSpan = (0, _trace.trace)('is-page-static-utils', parentId);
    return isPageStaticSpan.traceAsyncFn(async ()=>{
        (0, _setuphttpagentenv.setHttpClientAndAgentOptions)({
            httpAgentOptions
        });
        let componentsResult;
        let prerenderedRoutes;
        let prerenderFallbackMode;
        let appConfig = {};
        let rootParamKeys;
        const pathIsEdgeRuntime = (0, _isedgeruntime.isEdgeRuntime)(pageRuntime);
        if (pathIsEdgeRuntime) {
            const runtime = await (0, _sandbox.getRuntimeContext)({
                paths: edgeInfo.files.map((file)=>_path.default.join(distDir, file)),
                edgeFunctionEntry: {
                    ...edgeInfo,
                    wasm: (edgeInfo.wasm ?? []).map((binding)=>({
                            ...binding,
                            filePath: _path.default.join(distDir, binding.filePath)
                        }))
                },
                name: edgeInfo.name,
                useCache: true,
                distDir,
                clientAssetToken
            });
            const mod = (await runtime.context._ENTRIES[`middleware_${edgeInfo.name}`]).ComponentMod;
            // This is not needed during require.
            const buildManifest = {};
            componentsResult = {
                Component: mod.default,
                Document: mod.Document,
                App: mod.App,
                routeModule: mod.routeModule,
                page,
                ComponentMod: mod,
                pageConfig: mod.config || {},
                buildManifest,
                reactLoadableManifest: {},
                getServerSideProps: mod.getServerSideProps,
                getStaticPaths: mod.getStaticPaths,
                getStaticProps: mod.getStaticProps
            };
        } else {
            componentsResult = await (0, _loadcomponents.loadComponents)({
                distDir,
                page: originalAppPath || page,
                isAppPath: pageType === 'app',
                isDev: false,
                sriEnabled,
                needsManifestsForLegacyReasons: true
            });
        }
        const { Component, routeModule } = componentsResult;
        const Comp = Component;
        let isRoutePPREnabled = false;
        if (pageType === 'app') {
            // @ts-expect-error pageType is app, so we can assume AppPageModule | AppRouteModule
            const ComponentMod = componentsResult.ComponentMod;
            let segments;
            try {
                segments = await (0, _appsegments.collectSegments)(// We know this is an app page or app route module because we
                // checked above that the page type is 'app'.
                routeModule);
            } catch (err) {
                throw Object.defineProperty(new Error(`Failed to collect configuration for ${page}`, {
                    cause: err
                }), "__NEXT_ERROR_CODE", {
                    value: "E434",
                    enumerable: false,
                    configurable: true
                });
            }
            appConfig = originalAppPath === _constants1.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY ? {} : reduceAppConfig(segments);
            if (appConfig.dynamic === 'force-static' && pathIsEdgeRuntime) {
                _log.warn(`Page "${page}" is using runtime = 'edge' which is currently incompatible with dynamic = 'force-static'. Please remove either "runtime" or "force-static" for correct behavior`);
            }
            rootParamKeys = (0, _collectrootparamkeys.collectRootParamKeys)(routeModule);
            // A page supports partial prerendering if it is an app page and either
            // the whole app has PPR enabled or this page has PPR enabled when we're
            // in incremental mode.
            isRoutePPREnabled = routeModule.definition.kind === _routekind.RouteKind.APP_PAGE && (0, _ppr.checkIsRoutePPREnabled)(pprConfig);
            // If force dynamic was set and we don't have PPR enabled, then set the
            // revalidate to 0.
            // TODO: (PPR) remove this once PPR is enabled by default
            if (appConfig.dynamic === 'force-dynamic' && !isRoutePPREnabled) {
                appConfig.revalidate = 0;
            }
            const route = (0, _app1.parseAppRoute)(page, true);
            // If the page is dynamic and we're not in edge runtime, then we need to
            // build the static paths. The edge runtime doesn't support static
            // paths.
            if (route.dynamicSegments.length > 0 && !pathIsEdgeRuntime) {
                ;
                ({ prerenderedRoutes, fallbackMode: prerenderFallbackMode } = await (0, _app.buildAppStaticPaths)({
                    dir,
                    page,
                    route,
                    cacheComponents,
                    authInterrupts,
                    segments,
                    distDir,
                    requestHeaders: {},
                    isrFlushToDisk,
                    cacheMaxMemorySize,
                    cacheHandler,
                    cacheLifeProfiles,
                    ComponentMod,
                    nextConfigOutput,
                    isRoutePPREnabled,
                    partialFallbacksEnabled,
                    buildId,
                    rootParamKeys
                }));
            }
        } else {
            if (!Comp || !(0, _reactis.isValidElementType)(Comp) || typeof Comp === 'string') {
                throw Object.defineProperty(new Error('INVALID_DEFAULT_EXPORT'), "__NEXT_ERROR_CODE", {
                    value: "E457",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        const hasGetInitialProps = !!(Comp == null ? void 0 : Comp.getInitialProps);
        const hasStaticProps = !!componentsResult.getStaticProps;
        const hasStaticPaths = !!componentsResult.getStaticPaths;
        const hasServerProps = !!componentsResult.getServerSideProps;
        // A page cannot be prerendered _and_ define a data requirement. That's
        // contradictory!
        if (hasGetInitialProps && hasStaticProps) {
            throw Object.defineProperty(new Error(_constants.SSG_GET_INITIAL_PROPS_CONFLICT), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        if (hasGetInitialProps && hasServerProps) {
            throw Object.defineProperty(new Error(_constants.SERVER_PROPS_GET_INIT_PROPS_CONFLICT), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        if (hasStaticProps && hasServerProps) {
            throw Object.defineProperty(new Error(_constants.SERVER_PROPS_SSG_CONFLICT), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        const pageIsDynamic = (0, _isdynamic.isDynamicRoute)(page);
        // A page cannot have static parameters if it is not a dynamic page.
        if (hasStaticProps && hasStaticPaths && !pageIsDynamic) {
            throw Object.defineProperty(new Error(`getStaticPaths can only be used with dynamic pages, not '${page}'.` + `\nLearn more: https://nextjs.org/docs/routing/dynamic-routes`), "__NEXT_ERROR_CODE", {
                value: "E356",
                enumerable: false,
                configurable: true
            });
        }
        if (hasStaticProps && pageIsDynamic && !hasStaticPaths) {
            throw Object.defineProperty(new Error(`getStaticPaths is required for dynamic SSG pages and is missing for '${page}'.` + `\nRead more: https://nextjs.org/docs/messages/invalid-getstaticpaths-value`), "__NEXT_ERROR_CODE", {
                value: "E255",
                enumerable: false,
                configurable: true
            });
        }
        if (hasStaticProps && hasStaticPaths) {
            ;
            ({ prerenderedRoutes, fallbackMode: prerenderFallbackMode } = await (0, _pages.buildPagesStaticPaths)({
                page,
                locales,
                defaultLocale,
                configFileName,
                getStaticPaths: componentsResult.getStaticPaths
            }));
        }
        const isNextImageImported = globalThis.__NEXT_IMAGE_IMPORTED;
        let isStatic = false;
        if (!hasStaticProps && !hasGetInitialProps && !hasServerProps) {
            isStatic = true;
        }
        // When PPR is enabled, any route may be completely static, so
        // mark this route as static.
        if (isRoutePPREnabled) {
            isStatic = true;
        }
        return {
            isStatic,
            isRoutePPREnabled,
            prerenderFallbackMode,
            prerenderedRoutes,
            rootParamKeys,
            hasStaticProps,
            hasServerProps,
            isNextImageImported,
            appConfig
        };
    }).catch((err)=>{
        if (err.message === 'INVALID_DEFAULT_EXPORT') {
            throw err;
        }
        console.error(err);
        throw Object.defineProperty(new Error(`Failed to collect page data for ${page}`), "__NEXT_ERROR_CODE", {
            value: "E414",
            enumerable: false,
            configurable: true
        });
    });
}
function reduceAppConfig(segments) {
    const config = {};
    for (const segment of segments){
        const { dynamic, fetchCache, preferredRegion, revalidate, runtime, maxDuration } = segment.config || {};
        // TODO: should conflicting configs here throw an error
        // e.g. if layout defines one region but page defines another
        if (typeof preferredRegion !== 'undefined') {
            config.preferredRegion = preferredRegion;
        }
        if (typeof dynamic !== 'undefined') {
            config.dynamic = dynamic;
        }
        if (typeof fetchCache !== 'undefined') {
            config.fetchCache = fetchCache;
        }
        if (typeof revalidate !== 'undefined') {
            config.revalidate = revalidate;
        }
        // Any revalidate number overrides false, and shorter revalidate overrides
        // longer (initially).
        if (typeof revalidate === 'number' && (typeof config.revalidate !== 'number' || revalidate < config.revalidate)) {
            config.revalidate = revalidate;
        }
        if (typeof runtime !== 'undefined') {
            config.runtime = runtime;
        }
        if (typeof maxDuration !== 'undefined') {
            config.maxDuration = maxDuration;
        }
    }
    return config;
}
async function hasCustomGetInitialProps({ page, distDir, checkingApp, sriEnabled }) {
    const { ComponentMod } = await (0, _loadcomponents.loadComponents)({
        distDir,
        page: page,
        isAppPath: false,
        isDev: false,
        sriEnabled,
        needsManifestsForLegacyReasons: true
    });
    let mod = ComponentMod;
    if (checkingApp) {
        // @ts-expect-error very dynamic code
        mod = await mod._app || mod.default || mod;
    } else {
        // @ts-expect-error very dynamic code
        mod = mod.default || mod;
    }
    mod = await mod;
    // @ts-expect-error very dynamic code
    return mod.getInitialProps !== mod.origGetInitialProps;
}
async function getDefinedNamedExports({ page, distDir, sriEnabled }) {
    const { ComponentMod } = await (0, _loadcomponents.loadComponents)({
        distDir,
        page: page,
        isAppPath: false,
        isDev: false,
        sriEnabled,
        needsManifestsForLegacyReasons: true
    });
    return Object.keys(ComponentMod).filter((key)=>{
        return typeof ComponentMod[key] !== 'undefined';
    });
}
function detectConflictingPaths(combinedPages, ssgPages, additionalGeneratedSSGPaths) {
    const conflictingPaths = new Map();
    const dynamicSsgPages = [
        ...ssgPages
    ].filter((page)=>(0, _isdynamic.isDynamicRoute)(page));
    const additionalSsgPathsByPath = {};
    additionalGeneratedSSGPaths.forEach((paths, pathsPage)=>{
        additionalSsgPathsByPath[pathsPage] ||= {};
        paths.forEach((curPath)=>{
            const currentPath = curPath.toLowerCase();
            additionalSsgPathsByPath[pathsPage][currentPath] = curPath;
        });
    });
    additionalGeneratedSSGPaths.forEach((paths, pathsPage)=>{
        paths.forEach((curPath)=>{
            const lowerPath = curPath.toLowerCase();
            let conflictingPage = combinedPages.find((page)=>page.toLowerCase() === lowerPath);
            if (conflictingPage) {
                conflictingPaths.set(lowerPath, [
                    {
                        path: curPath,
                        page: pathsPage
                    },
                    {
                        path: conflictingPage,
                        page: conflictingPage
                    }
                ]);
            } else {
                let conflictingPath;
                conflictingPage = dynamicSsgPages.find((page)=>{
                    if (page === pathsPage) return false;
                    conflictingPath = additionalGeneratedSSGPaths.get(page) == null ? undefined : additionalSsgPathsByPath[page][lowerPath];
                    return conflictingPath;
                });
                if (conflictingPage && conflictingPath) {
                    conflictingPaths.set(lowerPath, [
                        {
                            path: curPath,
                            page: pathsPage
                        },
                        {
                            path: conflictingPath,
                            page: conflictingPage
                        }
                    ]);
                }
            }
        });
    });
    if (conflictingPaths.size > 0) {
        let conflictingPathsOutput = '';
        conflictingPaths.forEach((pathItems)=>{
            pathItems.forEach((pathItem, idx)=>{
                const isDynamic = pathItem.page !== pathItem.path;
                if (idx > 0) {
                    conflictingPathsOutput += 'conflicts with ';
                }
                conflictingPathsOutput += `path: "${pathItem.path}"${isDynamic ? ` from page: "${pathItem.page}" ` : ' '}`;
            });
            conflictingPathsOutput += '\n';
        });
        _log.error('Conflicting paths returned from getStaticPaths, paths must be unique per page.\n' + 'See more info here: https://nextjs.org/docs/messages/conflicting-ssg-paths\n\n' + conflictingPathsOutput);
        process.exit(1);
    }
}
async function copyTracedFiles(dir, distDir, pageKeys, appPageKeys, tracingRoot, serverConfig, middlewareManifest, hasNodeMiddleware, hasInstrumentationHook, staticPages) {
    const outputPath = _path.default.join(distDir, 'standalone');
    // Clean up standalone directory first.
    await _fs.promises.rm(outputPath, {
        recursive: true,
        force: true
    });
    let moduleType = false;
    const nextConfig = {
        ...serverConfig,
        distDir: `./${_path.default.relative(dir, distDir)}`
    };
    try {
        const packageJsonPath = _path.default.join(distDir, '../package.json');
        const packageJsonContent = await _fs.promises.readFile(/* turbopackIgnore: true */ packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);
        moduleType = packageJson.type === 'module';
        // we always copy the package.json to the standalone
        // folder to ensure any resolving logic is maintained
        const packageJsonOutputPath = _path.default.join(outputPath, _path.default.relative(tracingRoot, dir), 'package.json');
        await _fs.promises.mkdir(_path.default.dirname(packageJsonOutputPath), {
            recursive: true
        });
        await _fs.promises.writeFile(packageJsonOutputPath, packageJsonContent);
    } catch  {}
    const copiedFiles = new Set();
    async function handleTraceFiles(traceFilePath) {
        const traceData = JSON.parse(await _fs.promises.readFile(/* turbopackIgnore: true */ traceFilePath, 'utf8'));
        const copySema = new _asyncsema.Sema(10, {
            capacity: traceData.files.length
        });
        const traceFileDir = _path.default.dirname(traceFilePath);
        await Promise.all(traceData.files.map(async (relativeFile)=>{
            await copySema.acquire();
            const tracedFilePath = _path.default.join(traceFileDir, relativeFile);
            const fileOutputPath = _path.default.join(outputPath, _path.default.relative(tracingRoot, tracedFilePath));
            if (!copiedFiles.has(fileOutputPath)) {
                copiedFiles.add(fileOutputPath);
                await _fs.promises.mkdir(_path.default.dirname(fileOutputPath), {
                    recursive: true
                });
                const symlink = await _fs.promises.readlink(tracedFilePath).catch(()=>null);
                if (symlink) {
                    try {
                        await _fs.promises.symlink(symlink, fileOutputPath);
                    } catch (err) {
                        // Windows doesn't support creating symlinks without elevated privileges, unless
                        // "Developer Mode" is turned on. If we failed to create a symlink due to EPERM, try
                        // creating a junction point instead.
                        //
                        // Ideally we'd just preserve the input file type (junction point or symlink), but
                        // there's no API in node.js to differentiate between a junction point and a symlink,
                        // so we just try making a symlink first. Symlinks are preferred because they support
                        // relative paths and non-directory (file) targets.
                        if (process.platform === 'win32' && err.code === 'EPERM' && _path.default.isAbsolute(symlink)) {
                            try {
                                await _fs.promises.symlink(symlink, fileOutputPath, 'junction');
                            } catch (junctionErr) {
                                if (junctionErr.code !== 'EEXIST') {
                                    throw junctionErr;
                                }
                            }
                        } else if (err.code !== 'EEXIST') {
                            throw err;
                        }
                    }
                } else {
                    await _fs.promises.copyFile(tracedFilePath, fileOutputPath);
                }
            }
            await copySema.release();
        }));
    }
    async function handleEdgeFunction(page) {
        var _page_wasm, _page_assets;
        async function handleFile(file) {
            const originalPath = _path.default.join(distDir, file);
            const fileOutputPath = _path.default.join(outputPath, _path.default.relative(tracingRoot, distDir), file);
            await _fs.promises.mkdir(_path.default.dirname(fileOutputPath), {
                recursive: true
            });
            await _fs.promises.copyFile(originalPath, fileOutputPath);
        }
        await Promise.all([
            page.files.map(handleFile),
            (_page_wasm = page.wasm) == null ? void 0 : _page_wasm.map((file)=>handleFile(file.filePath)),
            (_page_assets = page.assets) == null ? void 0 : _page_assets.map((file)=>handleFile(file.filePath))
        ]);
    }
    const edgeFunctionHandlers = [];
    for (const middleware of Object.values(middlewareManifest.middleware)){
        if (isMiddlewareFilename(middleware.name)) {
            edgeFunctionHandlers.push(handleEdgeFunction(middleware));
        }
    }
    for (const page of Object.values(middlewareManifest.functions)){
        edgeFunctionHandlers.push(handleEdgeFunction(page));
    }
    await Promise.all(edgeFunctionHandlers);
    for (const page of pageKeys){
        if (middlewareManifest.functions.hasOwnProperty(page)) {
            continue;
        }
        const route = (0, _normalizepagepath.normalizePagePath)(page);
        if (staticPages.has(route)) {
            continue;
        }
        const pageFile = _path.default.join(distDir, 'server', 'pages', `${(0, _normalizepagepath.normalizePagePath)(page)}.js`);
        const pageTraceFile = `${pageFile}.nft.json`;
        await handleTraceFiles(pageTraceFile).catch((err)=>{
            if (err.code !== 'ENOENT' || page !== '/404' && page !== '/500') {
                _log.warn(`Failed to copy traced files for ${pageFile}`, err);
            }
        });
    }
    if (hasNodeMiddleware) {
        const middlewareFile = _path.default.join(distDir, 'server', 'middleware.js');
        const middlewareTrace = `${middlewareFile}.nft.json`;
        await handleTraceFiles(middlewareTrace);
    }
    if (appPageKeys) {
        for (const page of appPageKeys){
            if (middlewareManifest.functions.hasOwnProperty(page)) {
                continue;
            }
            const pageFile = _path.default.join(distDir, 'server', 'app', `${page}.js`);
            const pageTraceFile = `${pageFile}.nft.json`;
            await handleTraceFiles(pageTraceFile).catch((err)=>{
                _log.warn(`Failed to copy traced files for ${pageFile}`, err);
            });
        }
    }
    if (hasInstrumentationHook) {
        await handleTraceFiles(_path.default.join(distDir, 'server', 'instrumentation.js.nft.json'));
    }
    await handleTraceFiles(_path.default.join(distDir, 'next-server.js.nft.json'));
    const serverOutputPath = _path.default.join(outputPath, _path.default.relative(tracingRoot, dir), 'server.js');
    await _fs.promises.mkdir(_path.default.dirname(serverOutputPath), {
        recursive: true
    });
    await _fs.promises.writeFile(serverOutputPath, `${moduleType ? `performance.mark('next-start');
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import module from 'node:module'
const require = module.createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
` : `const path = require('path')`}

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = ${JSON.stringify(nextConfig)}

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});`);
}
function isReservedPage(page) {
    return RESERVED_PAGE.test(page);
}
function isAppBuiltinPage(page) {
    return /next[\\/]dist[\\/](esm[\\/])?client[\\/]components[\\/]builtin[\\/]/.test(page);
}
function isCustomErrorPage(page) {
    return page === '/404' || page === '/500';
}
function isMiddlewareFile(file) {
    return file === `/${_constants.MIDDLEWARE_FILENAME}` || file === `/src/${_constants.MIDDLEWARE_FILENAME}` || file === `/${_constants.PROXY_FILENAME}` || file === `/src/${_constants.PROXY_FILENAME}`;
}
function isProxyFile(file) {
    return file === `/${_constants.PROXY_FILENAME}` || file === `/src/${_constants.PROXY_FILENAME}`;
}
function isInstrumentationHookFile(file) {
    return file === `/${_constants.INSTRUMENTATION_HOOK_FILENAME}` || file === `/src/${_constants.INSTRUMENTATION_HOOK_FILENAME}`;
}
function getPossibleInstrumentationHookFilenames(folder, extensions) {
    const files = [];
    for (const extension of extensions){
        files.push(_path.default.join(folder, `${_constants.INSTRUMENTATION_HOOK_FILENAME}.${extension}`), _path.default.join(folder, `src`, `${_constants.INSTRUMENTATION_HOOK_FILENAME}.${extension}`));
    }
    return files;
}
function getPossibleMiddlewareFilenames(folder, extensions) {
    return extensions.flatMap((extension)=>[
            _path.default.join(folder, `${_constants.MIDDLEWARE_FILENAME}.${extension}`),
            _path.default.join(folder, `${_constants.PROXY_FILENAME}.${extension}`)
        ]);
}
class NestedMiddlewareError extends Error {
    constructor(nestedFileNames, mainDir, pagesOrAppDir){
        super(`Nested Middleware is not allowed, found:\n` + `${nestedFileNames.map((file)=>`pages${file}`).join('\n')}\n` + `Please move your code to a single file at ${_path.default.join(_path.default.posix.sep, _path.default.relative(mainDir, _path.default.resolve(pagesOrAppDir, '..')), 'middleware')} instead.\n` + `Read More - https://nextjs.org/docs/messages/nested-middleware`);
    }
}
function shouldUseReactServerCondition(layer) {
    return Boolean(layer && _constants.WEBPACK_LAYERS.GROUP.serverOnly.includes(layer));
}
function isWebpackClientOnlyLayer(layer) {
    return Boolean(layer && _constants.WEBPACK_LAYERS.GROUP.clientOnly.includes(layer));
}
function isWebpackDefaultLayer(layer) {
    return layer === null || layer === undefined || layer === _constants.WEBPACK_LAYERS.pagesDirBrowser || layer === _constants.WEBPACK_LAYERS.pagesDirEdge || layer === _constants.WEBPACK_LAYERS.pagesDirNode;
}
function isWebpackBundledLayer(layer) {
    return Boolean(layer && _constants.WEBPACK_LAYERS.GROUP.bundled.includes(layer));
}
function isWebpackAppPagesLayer(layer) {
    return Boolean(layer && _constants.WEBPACK_LAYERS.GROUP.appPages.includes(layer));
}
function collectMeta({ status, headers }) {
    const meta = {};
    if (status !== 200) {
        meta.status = status;
    }
    if (headers && Object.keys(headers).length) {
        meta.headers = {};
        // normalize header values as initialHeaders
        // must be Record<string, string>
        for(const key in headers){
            // set-cookie is already handled - the middleware cookie setting case
            // isn't needed for the prerender manifest since it can't read cookies
            if (key === 'x-middleware-set-cookie') continue;
            let value = headers[key];
            if (Array.isArray(value)) {
                if (key === 'set-cookie') {
                    value = value.join(',');
                } else {
                    value = value[value.length - 1];
                }
            }
            if (typeof value === 'string') {
                meta.headers[key] = value;
            }
        }
    }
    return meta;
}
const RSPACK_DEFAULT_LAYERS_REGEX = new RegExp(`^(|${[
    _constants.WEBPACK_LAYERS.pagesDirBrowser,
    _constants.WEBPACK_LAYERS.pagesDirEdge,
    _constants.WEBPACK_LAYERS.pagesDirNode
].join('|')})$`);
function pageToRoute(page, sourcePage) {
    const routeRegex = (0, _routeregex.getNamedRouteRegex)(page, {
        prefixRouteKeys: true
    });
    return {
        sourcePage,
        page,
        regex: (0, _loadcustomroutes.normalizeRouteRegex)(routeRegex.re.source),
        routeKeys: routeRegex.routeKeys,
        namedRegex: routeRegex.namedRegex
    };
}

//# sourceMappingURL=utils.js.map