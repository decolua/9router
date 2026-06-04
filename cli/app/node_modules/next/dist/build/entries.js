"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createEntrypoints: null,
    finalizeEntrypoint: null,
    getAppEntry: null,
    getAppLoader: null,
    getClientEntry: null,
    getEdgeServerEntry: null,
    getInstrumentationEntry: null,
    getPageFilePath: null,
    isDeferredEntry: null,
    runDependingOnPageType: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createEntrypoints: function() {
        return createEntrypoints;
    },
    finalizeEntrypoint: function() {
        return finalizeEntrypoint;
    },
    getAppEntry: function() {
        return getAppEntry;
    },
    getAppLoader: function() {
        return getAppLoader;
    },
    getClientEntry: function() {
        return getClientEntry;
    },
    getEdgeServerEntry: function() {
        return getEdgeServerEntry;
    },
    getInstrumentationEntry: function() {
        return getInstrumentationEntry;
    },
    getPageFilePath: function() {
        return getPageFilePath;
    },
    isDeferredEntry: function() {
        return isDeferredEntry;
    },
    runDependingOnPageType: function() {
        return runDependingOnPageType;
    }
});
const _path = require("path");
const _querystring = require("querystring");
const _constants = require("../lib/constants");
const _isapiroute = require("../lib/is-api-route");
const _isedgeruntime = require("../lib/is-edge-runtime");
const _constants1 = require("../shared/lib/constants");
const _utils = require("./utils");
const _normalizepagepath = require("../shared/lib/page-path/normalize-page-path");
const _apppaths = require("../shared/lib/router/utils/app-paths");
const _nextmiddlewareloader = require("./webpack/loaders/next-middleware-loader");
const _isapprouteroute = require("../lib/is-app-route-route");
const _nextrouteloader = require("./webpack/loaders/next-route-loader");
const _isinternalcomponent = require("../lib/is-internal-component");
const _routekind = require("../server/route-kind");
const _utils1 = require("./webpack/loaders/utils");
const _normalizecatchallroutes = require("./normalize-catchall-routes");
const _pagetypes = require("../lib/page-types");
const _getstaticinfoincludinglayouts = require("./get-static-info-including-layouts");
const _routediscovery = require("./route-discovery");
function getPageFilePath({ absolutePagePath, pagesDir, appDir, rootDir }) {
    if (absolutePagePath.startsWith(_constants.PAGES_DIR_ALIAS) && pagesDir) {
        return absolutePagePath.replace(_constants.PAGES_DIR_ALIAS, pagesDir);
    }
    if (absolutePagePath.startsWith(_constants.APP_DIR_ALIAS) && appDir) {
        return absolutePagePath.replace(_constants.APP_DIR_ALIAS, appDir);
    }
    if (absolutePagePath.startsWith(_constants.ROOT_DIR_ALIAS)) {
        return absolutePagePath.replace(_constants.ROOT_DIR_ALIAS, rootDir);
    }
    return require.resolve(absolutePagePath);
}
function isDeferredEntry(page, deferredEntries) {
    if (!deferredEntries || deferredEntries.length === 0) {
        return false;
    }
    // Normalize the page path
    const normalizedPage = page.startsWith('/') ? page : `/${page}`;
    for (const pattern of deferredEntries){
        // Normalize the pattern
        const normalizedPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;
        // Check for exact match or prefix match for directories
        if (normalizedPage === normalizedPattern) {
            return true;
        }
        // Check if the page is under the deferred directory
        if (normalizedPage.startsWith(normalizedPattern + '/')) {
            return true;
        }
    }
    return false;
}
function getEdgeServerEntry(opts) {
    var _opts_config_experimental_sri;
    const cacheHandler = opts.config.cacheHandler || undefined;
    if (opts.pagesType === 'app' && (0, _isapprouteroute.isAppRouteRoute)(opts.page) && opts.appDirLoader) {
        const loaderParams = {
            absolutePagePath: opts.absolutePagePath,
            page: opts.page,
            appDirLoader: Buffer.from(opts.appDirLoader || '').toString('base64'),
            preferredRegion: opts.preferredRegion,
            middlewareConfig: Buffer.from(JSON.stringify(opts.middlewareConfig || {})).toString('base64'),
            cacheHandlers: JSON.stringify(opts.config.cacheHandlers || {}),
            ...cacheHandler ? {
                cacheHandler
            } : {}
        };
        return {
            import: `next-edge-app-route-loader?${(0, _querystring.stringify)(loaderParams)}!`,
            layer: _constants.WEBPACK_LAYERS.reactServerComponents
        };
    }
    if ((0, _utils.isMiddlewareFile)(opts.page)) {
        var _opts_middleware;
        const loaderParams = {
            absolutePagePath: opts.absolutePagePath,
            page: opts.page,
            rootDir: opts.rootDir,
            matchers: ((_opts_middleware = opts.middleware) == null ? void 0 : _opts_middleware.matchers) ? (0, _nextmiddlewareloader.encodeMatchers)(opts.middleware.matchers) : '',
            preferredRegion: opts.preferredRegion,
            middlewareConfig: Buffer.from(JSON.stringify(opts.middlewareConfig || {})).toString('base64'),
            ...cacheHandler ? {
                cacheHandler
            } : {}
        };
        return {
            import: `next-middleware-loader?${(0, _querystring.stringify)(loaderParams)}!`,
            layer: _constants.WEBPACK_LAYERS.middleware,
            filename: opts.isDev ? 'middleware.js' : undefined
        };
    }
    if ((0, _isapiroute.isAPIRoute)(opts.page)) {
        const loaderParams = {
            absolutePagePath: opts.absolutePagePath,
            page: opts.page,
            rootDir: opts.rootDir,
            preferredRegion: opts.preferredRegion,
            middlewareConfig: Buffer.from(JSON.stringify(opts.middlewareConfig || {})).toString('base64'),
            ...cacheHandler ? {
                cacheHandler
            } : {}
        };
        return {
            import: `next-edge-function-loader?${(0, _querystring.stringify)(loaderParams)}!`,
            layer: _constants.WEBPACK_LAYERS.apiEdge
        };
    }
    const loaderParams = {
        absolute500Path: opts.pages['/500'] || '',
        absoluteAppPath: opts.pages['/_app'],
        absoluteDocumentPath: opts.pages['/_document'],
        absoluteErrorPath: opts.pages['/_error'],
        absolutePagePath: opts.absolutePagePath,
        dev: opts.isDev,
        isServerComponent: opts.isServerComponent,
        page: opts.page,
        pagesType: opts.pagesType,
        appDirLoader: Buffer.from(opts.appDirLoader || '').toString('base64'),
        sriEnabled: !opts.isDev && !!((_opts_config_experimental_sri = opts.config.experimental.sri) == null ? void 0 : _opts_config_experimental_sri.algorithm),
        preferredRegion: opts.preferredRegion,
        middlewareConfig: Buffer.from(JSON.stringify(opts.middlewareConfig || {})).toString('base64'),
        serverActions: opts.config.experimental.serverActions,
        cacheHandlers: JSON.stringify(opts.config.cacheHandlers || {}),
        ...cacheHandler ? {
            cacheHandler
        } : {}
    };
    return {
        import: `next-edge-ssr-loader?${JSON.stringify(loaderParams)}!`,
        // The Edge bundle includes the server in its entrypoint, so it has to
        // be in the SSR layer — we later convert the page request to the RSC layer
        // via a webpack rule.
        layer: opts.appDirLoader ? _constants.WEBPACK_LAYERS.serverSideRendering : undefined
    };
}
function getInstrumentationEntry(opts) {
    // the '../' is needed to make sure the file is not chunked
    const filename = `${opts.isEdgeServer ? 'edge-' : opts.isDev ? '' : '../'}${_constants.INSTRUMENTATION_HOOK_FILENAME}.js`;
    return {
        import: opts.absolutePagePath,
        filename,
        layer: _constants.WEBPACK_LAYERS.instrument
    };
}
function getAppLoader() {
    return process.env.BUILTIN_APP_LOADER ? `builtin:next-app-loader` : 'next-app-loader';
}
function getAppEntry(opts) {
    if (process.env.NEXT_RSPACK && process.env.BUILTIN_APP_LOADER) {
        ;
        opts.projectRoot = (0, _path.normalize)((0, _path.join)(__dirname, '../../..'));
    }
    return {
        import: `${getAppLoader()}?${(0, _querystring.stringify)(opts)}!`,
        layer: _constants.WEBPACK_LAYERS.reactServerComponents
    };
}
function getClientEntry(opts) {
    const loaderOptions = {
        absolutePagePath: opts.absolutePagePath,
        page: opts.page
    };
    const pageLoader = `next-client-pages-loader?${(0, _querystring.stringify)(loaderOptions)}!`;
    // Make sure next/router is a dependency of _app or else chunk splitting
    // might cause the router to not be able to load causing hydration
    // to fail
    return opts.page === '/_app' ? [
        pageLoader,
        require.resolve('../client/router')
    ] : pageLoader;
}
function runDependingOnPageType(params) {
    if (params.pageType === _pagetypes.PAGE_TYPES.ROOT && (0, _utils.isInstrumentationHookFile)(params.page)) {
        params.onServer();
        params.onEdgeServer();
        return;
    }
    if ((0, _utils.isProxyFile)(params.page)) {
        params.onServer();
        return;
    }
    if ((0, _utils.isMiddlewareFile)(params.page)) {
        if (params.pageRuntime === 'nodejs') {
            params.onServer();
            return;
        } else {
            params.onEdgeServer();
            return;
        }
    }
    if ((0, _isapiroute.isAPIRoute)(params.page)) {
        if ((0, _isedgeruntime.isEdgeRuntime)(params.pageRuntime)) {
            params.onEdgeServer();
            return;
        }
        params.onServer();
        return;
    }
    if (params.page === '/_document') {
        params.onServer();
        return;
    }
    if (params.page === '/_app' || params.page === '/_error' || params.page === '/404' || params.page === '/500') {
        params.onClient();
        params.onServer();
        return;
    }
    if ((0, _isedgeruntime.isEdgeRuntime)(params.pageRuntime)) {
        params.onClient();
        params.onEdgeServer();
        return;
    }
    params.onClient();
    params.onServer();
    return;
}
async function createEntrypoints(params) {
    const { config, pages, pagesDir, isDev, rootDir, rootPaths, appDir, appPaths, pageExtensions, deferredEntriesFilter } = params;
    const deferredEntries = config.experimental.deferredEntries;
    const edgeServer = {};
    const server = {};
    const client = {};
    let middlewareMatchers = undefined;
    let appPathsPerRoute = {};
    if (appDir && appPaths) {
        for(const pathname in appPaths){
            const normalizedPath = (0, _apppaths.normalizeAppPath)(pathname);
            const actualPath = appPaths[pathname];
            if (!appPathsPerRoute[normalizedPath]) {
                appPathsPerRoute[normalizedPath] = [];
            }
            appPathsPerRoute[normalizedPath].push(// TODO-APP: refactor to pass the page path from createPagesMapping instead.
            (0, _routediscovery.getPageFromPath)(actualPath, pageExtensions).replace(_constants.APP_DIR_ALIAS, ''));
        }
        // TODO: find a better place to do this
        (0, _normalizecatchallroutes.normalizeCatchAllRoutes)(appPathsPerRoute);
        // Make sure to sort parallel routes to make the result deterministic.
        appPathsPerRoute = Object.fromEntries(Object.entries(appPathsPerRoute).map(([k, v])=>[
                k,
                v.sort(_apppaths.compareAppPaths)
            ]));
    }
    const getEntryHandler = (mappings, pagesType)=>async (page)=>{
            // Apply deferred entries filter if specified
            if (deferredEntriesFilter) {
                const isDeferred = isDeferredEntry(page, deferredEntries);
                if (deferredEntriesFilter === 'exclude' && isDeferred) {
                    // Skip deferred entries when excluding them
                    return;
                }
                if (deferredEntriesFilter === 'only' && !isDeferred) {
                    // Skip non-deferred entries when only including deferred ones
                    return;
                }
            }
            const bundleFile = (0, _normalizepagepath.normalizePagePath)(page);
            const clientBundlePath = _path.posix.join(pagesType, bundleFile);
            const serverBundlePath = pagesType === _pagetypes.PAGE_TYPES.PAGES ? _path.posix.join('pages', bundleFile) : pagesType === _pagetypes.PAGE_TYPES.APP ? _path.posix.join('app', bundleFile) : bundleFile.slice(1);
            const absolutePagePath = mappings[page];
            // Handle paths that have aliases
            const pageFilePath = getPageFilePath({
                absolutePagePath,
                pagesDir,
                appDir,
                rootDir
            });
            const isInsideAppDir = !!appDir && (absolutePagePath.startsWith(_constants.APP_DIR_ALIAS) || absolutePagePath.startsWith(appDir));
            const staticInfo = await (0, _getstaticinfoincludinglayouts.getStaticInfoIncludingLayouts)({
                isInsideAppDir,
                pageExtensions,
                pageFilePath,
                appDir,
                config,
                isDev,
                page
            });
            // TODO(timneutkens): remove this
            const isServerComponent = isInsideAppDir && staticInfo.rsc !== _constants1.RSC_MODULE_TYPES.client;
            if ((0, _utils.isMiddlewareFile)(page)) {
                var _staticInfo_middleware;
                middlewareMatchers = ((_staticInfo_middleware = staticInfo.middleware) == null ? void 0 : _staticInfo_middleware.matchers) ?? [
                    {
                        regexp: '.*',
                        originalSource: '/:path*'
                    }
                ];
            }
            const isInstrumentation = (0, _utils.isInstrumentationHookFile)(page) && pagesType === _pagetypes.PAGE_TYPES.ROOT;
            runDependingOnPageType({
                page,
                pageRuntime: staticInfo.runtime,
                pageType: pagesType,
                onClient: ()=>{
                    if (isServerComponent || isInsideAppDir) {
                    // We skip the initial entries for server component pages and let the
                    // server compiler inject them instead.
                    } else {
                        client[clientBundlePath] = getClientEntry({
                            absolutePagePath,
                            page
                        });
                    }
                },
                onServer: ()=>{
                    if (pagesType === 'app' && appDir) {
                        const matchedAppPaths = appPathsPerRoute[(0, _apppaths.normalizeAppPath)(page)];
                        server[serverBundlePath] = getAppEntry({
                            page,
                            name: serverBundlePath,
                            pagePath: absolutePagePath,
                            appDir,
                            appPaths: matchedAppPaths,
                            allNormalizedAppPaths: Object.keys(appPathsPerRoute),
                            pageExtensions,
                            basePath: config.basePath,
                            assetPrefix: config.assetPrefix,
                            nextConfigOutput: config.output,
                            preferredRegion: staticInfo.preferredRegion,
                            middlewareConfig: (0, _utils1.encodeToBase64)(staticInfo.middleware || {}),
                            isGlobalNotFoundEnabled: config.experimental.globalNotFound ? true : undefined
                        });
                    } else if (isInstrumentation) {
                        server[serverBundlePath.replace('src/', '')] = getInstrumentationEntry({
                            absolutePagePath,
                            isEdgeServer: false,
                            isDev: false
                        });
                    } else if ((0, _utils.isMiddlewareFile)(page)) {
                        server[serverBundlePath.replace('src/', '')] = getEdgeServerEntry({
                            ...params,
                            rootDir,
                            absolutePagePath: absolutePagePath,
                            bundlePath: clientBundlePath,
                            isDev: false,
                            isServerComponent,
                            page,
                            middleware: staticInfo == null ? void 0 : staticInfo.middleware,
                            pagesType,
                            preferredRegion: staticInfo.preferredRegion,
                            middlewareConfig: staticInfo.middleware
                        });
                    } else if ((0, _isapiroute.isAPIRoute)(page)) {
                        server[serverBundlePath] = [
                            (0, _nextrouteloader.getRouteLoaderEntry)({
                                kind: _routekind.RouteKind.PAGES_API,
                                page,
                                absolutePagePath,
                                preferredRegion: staticInfo.preferredRegion,
                                middlewareConfig: staticInfo.middleware || {}
                            })
                        ];
                    } else if (!(0, _utils.isMiddlewareFile)(page) && !(0, _isinternalcomponent.isInternalComponent)(absolutePagePath) && !(0, _isinternalcomponent.isNonRoutePagesPage)(page)) {
                        server[serverBundlePath] = [
                            (0, _nextrouteloader.getRouteLoaderEntry)({
                                kind: _routekind.RouteKind.PAGES,
                                page,
                                pages,
                                absolutePagePath,
                                preferredRegion: staticInfo.preferredRegion,
                                middlewareConfig: staticInfo.middleware ?? {}
                            })
                        ];
                    } else {
                        server[serverBundlePath] = [
                            absolutePagePath
                        ];
                    }
                },
                onEdgeServer: ()=>{
                    let appDirLoader = '';
                    if (isInstrumentation) {
                        edgeServer[serverBundlePath.replace('src/', '')] = getInstrumentationEntry({
                            absolutePagePath,
                            isEdgeServer: true,
                            isDev: false
                        });
                    } else {
                        if (pagesType === 'app') {
                            const matchedAppPaths = appPathsPerRoute[(0, _apppaths.normalizeAppPath)(page)];
                            appDirLoader = getAppEntry({
                                name: serverBundlePath,
                                page,
                                pagePath: absolutePagePath,
                                appDir: appDir,
                                appPaths: matchedAppPaths,
                                allNormalizedAppPaths: Object.keys(appPathsPerRoute),
                                pageExtensions,
                                basePath: config.basePath,
                                assetPrefix: config.assetPrefix,
                                nextConfigOutput: config.output,
                                // This isn't used with edge as it needs to be set on the entry module, which will be the `edgeServerEntry` instead.
                                // Still passing it here for consistency.
                                preferredRegion: staticInfo.preferredRegion,
                                middlewareConfig: Buffer.from(JSON.stringify(staticInfo.middleware || {})).toString('base64'),
                                isGlobalNotFoundEnabled: config.experimental.globalNotFound ? true : undefined
                            }).import;
                        }
                        edgeServer[serverBundlePath] = getEdgeServerEntry({
                            ...params,
                            rootDir,
                            absolutePagePath: absolutePagePath,
                            bundlePath: clientBundlePath,
                            isDev: false,
                            isServerComponent,
                            page,
                            middleware: staticInfo == null ? void 0 : staticInfo.middleware,
                            pagesType,
                            appDirLoader,
                            preferredRegion: staticInfo.preferredRegion,
                            middlewareConfig: staticInfo.middleware
                        });
                    }
                }
            });
        };
    const promises = [];
    if (appPaths) {
        const entryHandler = getEntryHandler(appPaths, _pagetypes.PAGE_TYPES.APP);
        promises.push(Promise.all(Object.keys(appPaths).map(entryHandler)));
    }
    if (rootPaths) {
        promises.push(Promise.all(Object.keys(rootPaths).map(getEntryHandler(rootPaths, _pagetypes.PAGE_TYPES.ROOT))));
    }
    promises.push(Promise.all(Object.keys(pages).map(getEntryHandler(pages, _pagetypes.PAGE_TYPES.PAGES))));
    await Promise.all(promises);
    // Optimization: If there's only one instrumentation hook in edge compiler, which means there's no edge server entry.
    // We remove the edge instrumentation entry from edge compiler as it can be pure server side.
    if (edgeServer.instrumentation && Object.keys(edgeServer).length === 1) {
        delete edgeServer.instrumentation;
    }
    return {
        client,
        server,
        edgeServer,
        middlewareMatchers
    };
}
function finalizeEntrypoint({ name, compilerType, value, isServerComponent, hasAppDir }) {
    const entry = typeof value !== 'object' || Array.isArray(value) ? {
        import: value
    } : value;
    const isApi = name.startsWith('pages/api/');
    const isInstrumentation = (0, _utils.isInstrumentationHookFilename)(name);
    switch(compilerType){
        case _constants1.COMPILER_NAMES.server:
            {
                const layer = isApi ? _constants.WEBPACK_LAYERS.apiNode : isInstrumentation ? _constants.WEBPACK_LAYERS.instrument : isServerComponent ? _constants.WEBPACK_LAYERS.reactServerComponents : name.startsWith('pages/') ? _constants.WEBPACK_LAYERS.pagesDirNode : undefined;
                return {
                    publicPath: isApi ? '' : undefined,
                    runtime: isApi ? 'webpack-api-runtime' : 'webpack-runtime',
                    layer,
                    ...entry
                };
            }
        case _constants1.COMPILER_NAMES.edgeServer:
            {
                return {
                    layer: isApi ? _constants.WEBPACK_LAYERS.apiEdge : (0, _utils.isMiddlewareFilename)(name) || isInstrumentation ? _constants.WEBPACK_LAYERS.middleware : name.startsWith('pages/') ? _constants.WEBPACK_LAYERS.pagesDirEdge : undefined,
                    library: {
                        name: [
                            '_ENTRIES',
                            `middleware_[name]`
                        ],
                        type: 'assign'
                    },
                    runtime: _constants1.EDGE_RUNTIME_WEBPACK,
                    asyncChunks: false,
                    ...entry
                };
            }
        case _constants1.COMPILER_NAMES.client:
            {
                const isAppLayer = hasAppDir && (name === _constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN_APP || name === _constants1.APP_CLIENT_INTERNALS || name.startsWith('app/'));
                if (// Client special cases
                name !== _constants1.CLIENT_STATIC_FILES_RUNTIME_POLYFILLS && name !== _constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN && name !== _constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN_APP && name !== _constants1.CLIENT_STATIC_FILES_RUNTIME_REACT_REFRESH) {
                    if (isAppLayer) {
                        return {
                            dependOn: _constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN_APP,
                            layer: _constants.WEBPACK_LAYERS.appPagesBrowser,
                            ...entry
                        };
                    }
                    return {
                        dependOn: name.startsWith('pages/') && name !== 'pages/_app' ? 'pages/_app' : _constants1.CLIENT_STATIC_FILES_RUNTIME_MAIN,
                        layer: _constants.WEBPACK_LAYERS.pagesDirBrowser,
                        ...entry
                    };
                }
                if (isAppLayer) {
                    return {
                        layer: _constants.WEBPACK_LAYERS.appPagesBrowser,
                        ...entry
                    };
                }
                return {
                    layer: _constants.WEBPACK_LAYERS.pagesDirBrowser,
                    ...entry
                };
            }
        default:
            return compilerType;
    }
}

//# sourceMappingURL=entries.js.map