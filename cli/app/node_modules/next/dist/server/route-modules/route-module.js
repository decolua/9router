"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RouteModule", {
    enumerable: true,
    get: function() {
        return RouteModule;
    }
});
require("../../build/adapter/setup-node-env.external");
const _constants = require("../../shared/lib/constants");
const _url = require("../../lib/url");
const _normalizelocalepath = require("../../shared/lib/i18n/normalize-locale-path");
const _utils = require("../../shared/lib/router/utils");
const _removepathprefix = require("../../shared/lib/router/utils/remove-path-prefix");
const _serverutils = require("../server-utils");
const _detectdomainlocale = require("../../shared/lib/i18n/detect-domain-locale");
const _gethostname = require("../../shared/lib/get-hostname");
const _apiutils = require("../api-utils");
const _normalizedatapath = require("../../shared/lib/page-path/normalize-data-path");
const _pathhasprefix = require("../../shared/lib/router/utils/path-has-prefix");
const _requestmeta = require("../request-meta");
const _normalizepagepath = require("../../shared/lib/page-path/normalize-page-path");
const _ismetadataroute = require("../../lib/metadata/is-metadata-route");
const _incrementalcache = require("../lib/incremental-cache");
const _handlers = require("../use-cache/handlers");
const _interopdefault = require("../app-render/interop-default");
const _routekind = require("../route-kind");
const _responsecache = /*#__PURE__*/ _interop_require_default(require("../response-cache"));
const _apppaths = require("../../shared/lib/router/utils/app-paths");
const _routerservercontext = require("../lib/router-utils/router-server-context");
const _decodepathparams = require("../lib/router-utils/decode-path-params");
const _removetrailingslash = require("../../shared/lib/router/utils/remove-trailing-slash");
const _isinterceptionrouterewrite = require("../../lib/is-interception-route-rewrite");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const dynamicImportEsmDefault = (id)=>import(/* webpackIgnore: true */ /* turbopackIgnore: true */ id).then((mod)=>mod.default || mod);
class RouteModule {
    constructor({ userland, definition, distDir, relativeProjectDir }){
        this.userland = userland;
        this.definition = definition;
        this.isDev = !!process.env.__NEXT_DEV_SERVER;
        this.distDir = distDir;
        this.relativeProjectDir = relativeProjectDir;
    }
    getRouterServerContext(req) {
        var _routerServerGlobal_RouterServerContextSymbol;
        const hostname = (0, _requestmeta.getRequestMeta)(req, 'hostname');
        const revalidate = (0, _requestmeta.getRequestMeta)(req, 'revalidate');
        const render404 = (0, _requestmeta.getRequestMeta)(req, 'render404');
        const relativeProjectDir = (0, _requestmeta.getRequestMeta)(req, 'relativeProjectDir') || this.relativeProjectDir;
        const routerServerContext = (_routerServerGlobal_RouterServerContextSymbol = _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol]) == null ? void 0 : _routerServerGlobal_RouterServerContextSymbol[relativeProjectDir];
        return {
            ...routerServerContext,
            ...hostname !== undefined ? {
                hostname
            } : {},
            ...revalidate !== undefined ? {
                revalidate
            } : {},
            ...render404 !== undefined ? {
                render404
            } : {}
        };
    }
    normalizeUrl(_req, _parsedUrl) {}
    async instrumentationOnRequestError(req, ...args) {
        if (process.env.NEXT_RUNTIME === 'edge') {
            const { getEdgeInstrumentationModule } = await import('../web/globals');
            const instrumentation = await getEdgeInstrumentationModule();
            if (instrumentation) {
                await (instrumentation.onRequestError == null ? void 0 : instrumentation.onRequestError.call(instrumentation, ...args));
            }
        } else {
            const { join } = require('node:path');
            const absoluteProjectDir = join(/* turbopackIgnore: true */ process.cwd(), (0, _requestmeta.getRequestMeta)(req, 'relativeProjectDir') || this.relativeProjectDir);
            const { instrumentationOnRequestError } = await import('../lib/router-utils/instrumentation-globals.external.js');
            return instrumentationOnRequestError(absoluteProjectDir, this.distDir, ...args);
        }
    }
    loadManifests(srcPage, projectDir) {
        let result;
        if (process.env.NEXT_RUNTIME === 'edge') {
            var _self___RSC_MANIFEST;
            const { getEdgePreviewProps } = require('../web/get-edge-preview-props');
            const maybeJSONParse = (str)=>str ? JSON.parse(str) : undefined;
            result = {
                buildId: process.env.__NEXT_BUILD_ID || '',
                buildManifest: self.__BUILD_MANIFEST,
                fallbackBuildManifest: {},
                reactLoadableManifest: maybeJSONParse(self.__REACT_LOADABLE_MANIFEST),
                nextFontManifest: maybeJSONParse(self.__NEXT_FONT_MANIFEST),
                prerenderManifest: {
                    routes: {},
                    dynamicRoutes: {},
                    notFoundRoutes: [],
                    version: 4,
                    preview: getEdgePreviewProps()
                },
                routesManifest: {
                    version: 4,
                    caseSensitive: Boolean(process.env.__NEXT_CASE_SENSITIVE_ROUTES),
                    basePath: process.env.__NEXT_BASE_PATH || '',
                    rewrites: process.env.__NEXT_REWRITES || {
                        beforeFiles: [],
                        afterFiles: [],
                        fallback: []
                    },
                    redirects: [],
                    headers: [],
                    onMatchHeaders: [],
                    i18n: process.env.__NEXT_I18N_CONFIG || undefined,
                    skipProxyUrlNormalize: Boolean(process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE)
                },
                serverFilesManifest: self.__SERVER_FILES_MANIFEST,
                clientReferenceManifest: (_self___RSC_MANIFEST = self.__RSC_MANIFEST) == null ? void 0 : _self___RSC_MANIFEST[srcPage],
                serverActionsManifest: maybeJSONParse(self.__RSC_SERVER_MANIFEST),
                subresourceIntegrityManifest: maybeJSONParse(self.__SUBRESOURCE_INTEGRITY_MANIFEST),
                dynamicCssManifest: maybeJSONParse(self.__DYNAMIC_CSS_MANIFEST),
                interceptionRoutePatterns: (maybeJSONParse(self.__INTERCEPTION_ROUTE_REWRITE_MANIFEST) ?? []).map((rewrite)=>new RegExp(rewrite.regex))
            };
        } else {
            var _clientReferenceManifest___RSC_MANIFEST;
            if (!projectDir) {
                throw Object.defineProperty(new Error('Invariant: projectDir is required for node runtime'), "__NEXT_ERROR_CODE", {
                    value: "E718",
                    enumerable: false,
                    configurable: true
                });
            }
            const { loadManifestFromRelativePath } = require('../load-manifest.external');
            const normalizedPagePath = (0, _normalizepagepath.normalizePagePath)(srcPage);
            const router = this.definition.kind === _routekind.RouteKind.PAGES || this.definition.kind === _routekind.RouteKind.PAGES_API ? 'pages' : 'app';
            const [routesManifest, prerenderManifest, buildManifest, fallbackBuildManifest, reactLoadableManifest, nextFontManifest, clientReferenceManifest, serverActionsManifest, subresourceIntegrityManifest, serverFilesManifest, buildId, dynamicCssManifest] = [
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: _constants.ROUTES_MANIFEST,
                    shouldCache: !this.isDev
                }),
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: _constants.PRERENDER_MANIFEST,
                    shouldCache: !this.isDev
                }),
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: _constants.BUILD_MANIFEST,
                    shouldCache: !this.isDev
                }),
                srcPage === '/_error' ? loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: `fallback-${_constants.BUILD_MANIFEST}`,
                    shouldCache: !this.isDev,
                    handleMissing: true
                }) : {},
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: process.env.TURBOPACK ? `server/${router === 'app' ? 'app' : 'pages'}${normalizedPagePath}/${_constants.REACT_LOADABLE_MANIFEST}` : _constants.REACT_LOADABLE_MANIFEST,
                    handleMissing: true,
                    shouldCache: !this.isDev
                }),
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: `server/${_constants.NEXT_FONT_MANIFEST}.json`,
                    shouldCache: !this.isDev
                }),
                router === 'app' && !(0, _ismetadataroute.isStaticMetadataRoute)(srcPage) ? loadManifestFromRelativePath({
                    distDir: this.distDir,
                    projectDir,
                    useEval: true,
                    handleMissing: true,
                    manifest: `server/app${srcPage.replace(/%5F/g, '_') + '_' + _constants.CLIENT_REFERENCE_MANIFEST}.js`,
                    shouldCache: !this.isDev
                }) : undefined,
                router === 'app' ? loadManifestFromRelativePath({
                    distDir: this.distDir,
                    projectDir,
                    manifest: `server/${_constants.SERVER_REFERENCE_MANIFEST}.json`,
                    handleMissing: true,
                    shouldCache: !this.isDev
                }) : {},
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: `server/${_constants.SUBRESOURCE_INTEGRITY_MANIFEST}.json`,
                    handleMissing: true,
                    shouldCache: !this.isDev
                }),
                this.isDev ? undefined : loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    shouldCache: true,
                    manifest: `${_constants.SERVER_FILES_MANIFEST}.json`
                }),
                this.isDev ? 'development' : loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: _constants.BUILD_ID_FILE,
                    skipParse: true,
                    shouldCache: true
                }),
                loadManifestFromRelativePath({
                    projectDir,
                    distDir: this.distDir,
                    manifest: _constants.DYNAMIC_CSS_MANIFEST,
                    shouldCache: !this.isDev,
                    handleMissing: true
                })
            ];
            result = {
                buildId,
                buildManifest,
                fallbackBuildManifest,
                routesManifest,
                nextFontManifest,
                prerenderManifest,
                serverFilesManifest,
                reactLoadableManifest,
                clientReferenceManifest: clientReferenceManifest == null ? void 0 : (_clientReferenceManifest___RSC_MANIFEST = clientReferenceManifest.__RSC_MANIFEST) == null ? void 0 : _clientReferenceManifest___RSC_MANIFEST[srcPage.replace(/%5F/g, '_')],
                serverActionsManifest,
                subresourceIntegrityManifest,
                dynamicCssManifest,
                interceptionRoutePatterns: routesManifest.rewrites.beforeFiles.filter(_isinterceptionrouterewrite.isInterceptionRouteRewrite).map((rewrite)=>new RegExp(rewrite.regex))
            };
        }
        return result;
    }
    async loadCustomCacheHandlers(req, nextConfig) {
        if (process.env.NEXT_RUNTIME !== 'edge') {
            const { cacheMaxMemorySize, cacheHandlers } = nextConfig;
            if (!cacheHandlers) return;
            // If we've already initialized the cache handlers interface, don't do it
            // again.
            if (!(0, _handlers.initializeCacheHandlers)(cacheMaxMemorySize)) return;
            for (const [kind, handler] of Object.entries(cacheHandlers)){
                if (!handler) continue;
                const { formatDynamicImportPath } = require('../../lib/format-dynamic-import-path');
                const { join } = require('node:path');
                const absoluteProjectDir = join(/* turbopackIgnore: true */ process.cwd(), (0, _requestmeta.getRequestMeta)(req, 'relativeProjectDir') || this.relativeProjectDir);
                (0, _handlers.setCacheHandler)(kind, (0, _interopdefault.interopDefault)(await dynamicImportEsmDefault(formatDynamicImportPath(`${absoluteProjectDir}/${this.distDir}`, handler))));
            }
        }
    }
    async getIncrementalCache(req, nextConfig, prerenderManifest, isMinimalMode) {
        if (process.env.NEXT_RUNTIME === 'edge') {
            return globalThis.__incrementalCache;
        } else {
            let CacheHandler;
            const { cacheHandler } = nextConfig;
            if (cacheHandler) {
                const { formatDynamicImportPath } = require('../../lib/format-dynamic-import-path');
                CacheHandler = (0, _interopdefault.interopDefault)(await dynamicImportEsmDefault(formatDynamicImportPath(this.distDir, cacheHandler)));
            }
            const { join } = require('node:path');
            const projectDir = join(/* turbopackIgnore: true */ process.cwd(), (0, _requestmeta.getRequestMeta)(req, 'relativeProjectDir') || this.relativeProjectDir);
            await this.loadCustomCacheHandlers(req, nextConfig);
            // incremental-cache is request specific
            // although can have shared caches in module scope
            // per-cache handler
            const incrementalCache = new _incrementalcache.IncrementalCache({
                fs: require('../lib/node-fs-methods').nodeFs,
                dev: this.isDev,
                requestHeaders: req.headers,
                allowedRevalidateHeaderKeys: nextConfig.experimental.allowedRevalidateHeaderKeys,
                minimalMode: isMinimalMode,
                serverDistDir: `${projectDir}/${this.distDir}/server`,
                fetchCacheKeyPrefix: nextConfig.experimental.fetchCacheKeyPrefix,
                maxMemoryCacheSize: nextConfig.cacheMaxMemorySize,
                flushToDisk: !isMinimalMode && nextConfig.experimental.isrFlushToDisk,
                getPrerenderManifest: ()=>prerenderManifest,
                CurCacheHandler: CacheHandler
            });
            globalThis.__incrementalCache = incrementalCache;
            return incrementalCache;
        }
    }
    async onRequestError(req, err, errorContext, silenceLog, routerServerContext) {
        if (!silenceLog) {
            if (routerServerContext == null ? void 0 : routerServerContext.logErrorWithOriginalStack) {
                routerServerContext.logErrorWithOriginalStack(err, 'app-dir');
            } else {
                console.error(err);
            }
        }
        await this.instrumentationOnRequestError(req, err, {
            path: req.url || '/',
            headers: req.headers,
            method: req.method || 'GET'
        }, errorContext);
    }
    /** A more lightweight version of `prepare()` for only retrieving the config on edge */ getNextConfigEdge(req) {
        var _nextConfig_experimental;
        if (process.env.NEXT_RUNTIME !== 'edge') {
            throw Object.defineProperty(new Error('Invariant: getNextConfigEdge must only be called in edge runtime'), "__NEXT_ERROR_CODE", {
                value: "E968",
                enumerable: false,
                configurable: true
            });
        }
        let serverFilesManifest = self.__SERVER_FILES_MANIFEST;
        const routerServerContext = this.getRouterServerContext(req);
        const nextConfig = (routerServerContext == null ? void 0 : routerServerContext.nextConfig) || (serverFilesManifest == null ? void 0 : serverFilesManifest.config);
        if (!nextConfig) {
            throw Object.defineProperty(new Error("Invariant: nextConfig couldn't be loaded"), "__NEXT_ERROR_CODE", {
                value: "E969",
                enumerable: false,
                configurable: true
            });
        }
        let deploymentId;
        if ((_nextConfig_experimental = nextConfig.experimental) == null ? void 0 : _nextConfig_experimental.runtimeServerDeploymentId) {
            if (!process.env.NEXT_DEPLOYMENT_ID) {
                throw Object.defineProperty(new Error('process.env.NEXT_DEPLOYMENT_ID is missing but runtimeServerDeploymentId is enabled'), "__NEXT_ERROR_CODE", {
                    value: "E970",
                    enumerable: false,
                    configurable: true
                });
            }
            deploymentId = process.env.NEXT_DEPLOYMENT_ID;
        } else {
            deploymentId = nextConfig.deploymentId || '';
        }
        return {
            nextConfig,
            deploymentId
        };
    }
    async prepare(req, res, { srcPage, multiZoneDraftMode }) {
        var _req_headers_xforwardedproto, _nextConfig_experimental;
        let absoluteProjectDir;
        // edge runtime handles loading instrumentation at the edge adapter level
        if (process.env.NEXT_RUNTIME !== 'edge') {
            const { join, relative } = require('node:path');
            absoluteProjectDir = join(/* turbopackIgnore: true */ process.cwd(), (0, _requestmeta.getRequestMeta)(req, 'relativeProjectDir') || this.relativeProjectDir);
            const absoluteDistDir = (0, _requestmeta.getRequestMeta)(req, 'distDir');
            if (absoluteDistDir) {
                this.distDir = relative(absoluteProjectDir, absoluteDistDir);
            }
            const { ensureInstrumentationRegistered } = await import('../lib/router-utils/instrumentation-globals.external.js');
            // ensure instrumentation is registered and pass
            // onRequestError below
            ensureInstrumentationRegistered(absoluteProjectDir, this.distDir);
        }
        const manifests = this.loadManifests(srcPage, absoluteProjectDir);
        const { routesManifest, prerenderManifest, serverFilesManifest } = manifests;
        const { basePath, i18n, rewrites } = routesManifest;
        const routerServerContext = this.getRouterServerContext(req);
        const nextConfig = (routerServerContext == null ? void 0 : routerServerContext.nextConfig) || (serverFilesManifest == null ? void 0 : serverFilesManifest.config);
        // Injected in base-server.ts
        const protocol = ((_req_headers_xforwardedproto = req.headers['x-forwarded-proto']) == null ? void 0 : _req_headers_xforwardedproto.includes('https')) ? 'https' : 'http';
        // When there are hostname and port we build an absolute URL
        if (!(0, _requestmeta.getRequestMeta)(req, 'initURL')) {
            const initUrl = (serverFilesManifest == null ? void 0 : serverFilesManifest.config.experimental.trustHostHeader) ? `${protocol}://${req.headers.host || 'localhost'}${req.url}` : `${protocol}://${(routerServerContext == null ? void 0 : routerServerContext.hostname) || 'localhost'}${req.url}`;
            (0, _requestmeta.addRequestMeta)(req, 'initURL', initUrl);
            (0, _requestmeta.addRequestMeta)(req, 'initProtocol', protocol);
        }
        if (basePath) {
            req.url = (0, _removepathprefix.removePathPrefix)(req.url || '/', basePath);
        }
        const parsedUrl = (0, _url.parseReqUrl)(req.url || '/');
        (0, _requestmeta.addRequestMeta)(req, 'initQuery', {
            ...parsedUrl == null ? void 0 : parsedUrl.query
        });
        // if we couldn't parse the URL we can't continue
        if (!parsedUrl) {
            return;
        }
        let isNextDataRequest = false;
        if ((0, _pathhasprefix.pathHasPrefix)(parsedUrl.pathname || '/', '/_next/data')) {
            isNextDataRequest = true;
            parsedUrl.pathname = (0, _normalizedatapath.normalizeDataPath)(parsedUrl.pathname || '/');
        }
        this.normalizeUrl(req, parsedUrl);
        let originalPathname = parsedUrl.pathname || '/';
        const originalQuery = {
            ...parsedUrl.query
        };
        const pageIsDynamic = (0, _utils.isDynamicRoute)(srcPage);
        let localeResult;
        let detectedLocale;
        if (i18n) {
            localeResult = (0, _normalizelocalepath.normalizeLocalePath)(parsedUrl.pathname || '/', i18n.locales);
            if (localeResult.detectedLocale) {
                req.url = `${localeResult.pathname}${parsedUrl.search}`;
                originalPathname = localeResult.pathname;
                if (!detectedLocale) {
                    detectedLocale = localeResult.detectedLocale;
                }
            }
        }
        // Normalize the page path for route matching. The srcPage contains the
        // internal page path (e.g., /app/[slug]/page), but route matchers expect
        // the pathname format (e.g., /app/[slug]).
        const normalizedSrcPage = (0, _apppaths.normalizeAppPath)(srcPage);
        const serverUtils = (0, _serverutils.getServerUtils)({
            page: normalizedSrcPage,
            i18n,
            basePath,
            rewrites,
            pageIsDynamic,
            trailingSlash: process.env.__NEXT_TRAILING_SLASH,
            caseSensitive: Boolean(routesManifest.caseSensitive)
        });
        const domainLocale = (0, _detectdomainlocale.detectDomainLocale)(i18n == null ? void 0 : i18n.domains, (0, _gethostname.getHostname)(parsedUrl, req.headers), detectedLocale);
        if (Boolean(domainLocale)) {
            (0, _requestmeta.addRequestMeta)(req, 'isLocaleDomain', Boolean(domainLocale));
        }
        const defaultLocale = (0, _requestmeta.getRequestMeta)(req, 'defaultLocale') || (domainLocale == null ? void 0 : domainLocale.defaultLocale) || (i18n == null ? void 0 : i18n.defaultLocale);
        // Ensure parsedUrl.pathname includes locale before processing
        // rewrites or they won't match correctly.
        if (defaultLocale && !detectedLocale) {
            parsedUrl.pathname = `/${defaultLocale}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`;
        }
        const locale = (0, _requestmeta.getRequestMeta)(req, 'locale') || detectedLocale || defaultLocale;
        // we apply rewrites against cloned URL so that we don't
        // modify the original with the rewrite destination
        const { rewriteParams, rewrittenParsedUrl } = serverUtils.handleRewrites(req, parsedUrl);
        const rewriteParamKeys = Object.keys(rewriteParams);
        Object.assign(parsedUrl.query, rewrittenParsedUrl.query);
        // after processing rewrites we want to remove locale
        // from parsedUrl pathname
        if (i18n) {
            parsedUrl.pathname = (0, _normalizelocalepath.normalizeLocalePath)(parsedUrl.pathname || '/', i18n.locales).pathname;
            rewrittenParsedUrl.pathname = (0, _normalizelocalepath.normalizeLocalePath)(rewrittenParsedUrl.pathname || '/', i18n.locales).pathname;
        }
        let params = (0, _requestmeta.getRequestMeta)(req, 'params');
        // attempt parsing from pathname
        if (!params && serverUtils.dynamicRouteMatcher) {
            const paramsMatch = serverUtils.dynamicRouteMatcher((0, _normalizedatapath.normalizeDataPath)((rewrittenParsedUrl == null ? void 0 : rewrittenParsedUrl.pathname) || parsedUrl.pathname || '/'));
            const paramsResult = serverUtils.normalizeDynamicRouteParams(paramsMatch || {}, true);
            if (paramsResult.hasValidParams) {
                params = paramsResult.params;
            }
        }
        // Local "next start" expects the routing parsed query values
        // to not be present in the URL although when deployed proxies
        // will add query values from resolving the routes to pass to function.
        // TODO: do we want to change expectations for "next start"
        // to include these query values in the URL which affects asPath
        // but would match deployed behavior, e.g. a rewrite from middleware
        // that adds a query param would be in asPath as query but locally
        // it won't be in the asPath but still available in the query object
        const query = (0, _requestmeta.getRequestMeta)(req, 'query') || {
            ...parsedUrl.query
        };
        const routeParamKeys = new Set();
        const combinedParamKeys = [];
        // We don't include rewriteParamKeys in the combinedParamKeys
        // for app router since the searchParams is populated from the
        // URL so we don't want to strip the rewrite params from the URL
        // so that searchParams can include them.
        if (this.definition.kind === _routekind.RouteKind.PAGES || this.definition.kind === _routekind.RouteKind.PAGES_API) {
            for (const key of [
                ...rewriteParamKeys,
                ...Object.keys(serverUtils.defaultRouteMatches || {})
            ]){
                // We only want to filter rewrite param keys from the URL
                // if they are matches from the URL e.g. the key/value matches
                // before and after applying the rewrites /:path for /hello and
                // { path: 'hello' } but not for { path: 'another' } and /hello
                // TODO: we should prefix rewrite param keys the same as we do
                // for dynamic routes so we can identify them properly
                const originalValue = Array.isArray(originalQuery[key]) ? originalQuery[key].join('') : originalQuery[key];
                const queryValue = Array.isArray(query[key]) ? query[key].join('') : query[key];
                if (!(key in originalQuery) || originalValue === queryValue) {
                    combinedParamKeys.push(key);
                }
            }
        }
        serverUtils.normalizeCdnUrl(req, combinedParamKeys);
        serverUtils.normalizeQueryParams(query, routeParamKeys);
        serverUtils.filterInternalQuery(originalQuery, combinedParamKeys);
        if (pageIsDynamic) {
            const queryResult = serverUtils.normalizeDynamicRouteParams(query, true);
            const paramsResult = serverUtils.normalizeDynamicRouteParams(params || {}, true);
            let paramsToInterpolate;
            if (// if both query and params are valid but one
            // provided more information and the query params
            // were nxtP prefixed rely on that one
            query && params && paramsResult.hasValidParams && queryResult.hasValidParams && routeParamKeys.size > 0 && Object.keys(paramsResult.params).length <= Object.keys(queryResult.params).length) {
                paramsToInterpolate = queryResult.params;
                params = Object.assign(queryResult.params);
            } else {
                paramsToInterpolate = paramsResult.hasValidParams && params ? params : queryResult.hasValidParams ? query : {};
            }
            req.url = serverUtils.interpolateDynamicPath(req.url || '/', paramsToInterpolate);
            parsedUrl.pathname = serverUtils.interpolateDynamicPath(parsedUrl.pathname || '/', paramsToInterpolate);
            originalPathname = serverUtils.interpolateDynamicPath(originalPathname, paramsToInterpolate);
            // try pulling from query if valid
            if (!params) {
                if (queryResult.hasValidParams) {
                    params = Object.assign({}, queryResult.params);
                    // If we pulled from query remove it so it's
                    // only in params
                    for(const key in serverUtils.defaultRouteMatches){
                        delete query[key];
                    }
                } else {
                    // use final params from URL matching
                    const paramsMatch = serverUtils.dynamicRouteMatcher == null ? void 0 : serverUtils.dynamicRouteMatcher.call(serverUtils, (0, _normalizedatapath.normalizeDataPath)((localeResult == null ? void 0 : localeResult.pathname) || parsedUrl.pathname || '/'));
                    // we don't normalize these as they are allowed to be
                    // the literal slug matches here e.g. /blog/[slug]
                    // actually being requested
                    if (paramsMatch) {
                        params = Object.assign({}, paramsMatch);
                    }
                }
            }
        }
        // Remove any normalized params from the query if they
        // weren't present as non-prefixed query key e.g.
        // ?search=1&nxtPsearch=hello we don't delete search
        for (const key of routeParamKeys){
            if (!(key in originalQuery)) {
                delete query[key];
            // handle the case where there's collision and we
            // normalized nxtPid=123 -> id=123 but user also
            // sends id=456 as separate key
            } else if (originalQuery[key] && query[key] && originalQuery[key] !== query[key]) {
                query[key] = originalQuery[key];
            }
        }
        const { isOnDemandRevalidate, revalidateOnlyGenerated } = (0, _apiutils.checkIsOnDemandRevalidate)(req, prerenderManifest.preview);
        let isDraftMode = false;
        let previewData;
        // preview data relies on non-edge utils
        if (process.env.NEXT_RUNTIME !== 'edge' && res) {
            const { tryGetPreviewData } = require('../api-utils/node/try-get-preview-data');
            previewData = tryGetPreviewData(req, res, prerenderManifest.preview, Boolean(multiZoneDraftMode));
            isDraftMode = previewData !== false;
        }
        if (!nextConfig) {
            throw Object.defineProperty(new Error("Invariant: nextConfig couldn't be loaded"), "__NEXT_ERROR_CODE", {
                value: "E969",
                enumerable: false,
                configurable: true
            });
        }
        if (process.env.NEXT_RUNTIME !== 'edge') {
            const { installProcessErrorHandlers } = require('../node-environment-extensions/process-error-handlers');
            installProcessErrorHandlers(Boolean(nextConfig.experimental.removeUncaughtErrorAndRejectionListeners));
        }
        let resolvedPathname = normalizedSrcPage;
        if ((0, _utils.isDynamicRoute)(resolvedPathname) && params) {
            resolvedPathname = serverUtils.interpolateDynamicPath(resolvedPathname, params);
        }
        if (resolvedPathname === '/index') {
            resolvedPathname = '/';
        }
        if (res && Boolean(req.headers['x-nextjs-data']) && (!res.statusCode || res.statusCode === 200)) {
            res.setHeader('x-nextjs-matched-path', (0, _removetrailingslash.removeTrailingSlash)(`${locale ? `/${locale}` : ''}${normalizedSrcPage}`));
        }
        const encodedResolvedPathname = resolvedPathname;
        // we decode for cache key/manifest usage encoded is
        // for URL building
        try {
            resolvedPathname = (0, _decodepathparams.decodePathParams)(resolvedPathname);
        } catch (_) {}
        resolvedPathname = (0, _removetrailingslash.removeTrailingSlash)(resolvedPathname);
        (0, _requestmeta.addRequestMeta)(req, 'resolvedPathname', resolvedPathname);
        let deploymentId;
        if ((_nextConfig_experimental = nextConfig.experimental) == null ? void 0 : _nextConfig_experimental.runtimeServerDeploymentId) {
            if (!process.env.NEXT_DEPLOYMENT_ID) {
                throw Object.defineProperty(new Error('process.env.NEXT_DEPLOYMENT_ID is missing but runtimeServerDeploymentId is enabled'), "__NEXT_ERROR_CODE", {
                    value: "E970",
                    enumerable: false,
                    configurable: true
                });
            }
            deploymentId = process.env.NEXT_DEPLOYMENT_ID;
        } else {
            deploymentId = nextConfig.deploymentId || '';
        }
        return {
            query,
            originalQuery,
            originalPathname,
            params,
            parsedUrl,
            locale,
            isNextDataRequest,
            locales: i18n == null ? void 0 : i18n.locales,
            defaultLocale,
            isDraftMode,
            previewData,
            pageIsDynamic,
            resolvedPathname,
            encodedResolvedPathname,
            isOnDemandRevalidate,
            revalidateOnlyGenerated,
            ...manifests,
            // loadManifest returns a readonly object, but we don't want to propagate that throughout the
            // whole codebase (for now)
            nextConfig: nextConfig,
            routerServerContext,
            deploymentId,
            clientAssetToken: nextConfig.experimental.immutableAssetToken || deploymentId
        };
    }
    getResponseCache(req) {
        if (!this.responseCache) {
            const minimalMode = (0, _requestmeta.getRequestMeta)(req, 'minimalMode') ?? false;
            this.responseCache = new _responsecache.default(minimalMode);
        }
        return this.responseCache;
    }
    async handleResponse({ req, nextConfig, cacheKey, routeKind, isFallback, prerenderManifest, isRoutePPREnabled, isOnDemandRevalidate, revalidateOnlyGenerated, responseGenerator, waitUntil, isMinimalMode }) {
        const responseCache = this.getResponseCache(req);
        const cacheEntry = await responseCache.get(cacheKey, responseGenerator, {
            routeKind,
            isFallback,
            isRoutePPREnabled,
            isOnDemandRevalidate,
            isPrefetch: req.headers.purpose === 'prefetch',
            // Use x-invocation-id header to scope the in-memory cache to a single
            // revalidation request in minimal mode.
            invocationID: req.headers['x-invocation-id'],
            incrementalCache: await this.getIncrementalCache(req, nextConfig, prerenderManifest, isMinimalMode),
            waitUntil
        });
        if (!cacheEntry) {
            if (cacheKey && // revalidate only generated can bail even if cacheKey is provided
            !(isOnDemandRevalidate && revalidateOnlyGenerated)) {
                // A cache entry might not be generated if a response is written
                // in `getInitialProps` or `getServerSideProps`, but those shouldn't
                // have a cache key. If we do have a cache key but we don't end up
                // with a cache entry, then either Next.js or the application has a
                // bug that needs fixing.
                throw Object.defineProperty(new Error('invariant: cache entry required but not generated'), "__NEXT_ERROR_CODE", {
                    value: "E62",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        return cacheEntry;
    }
}

//# sourceMappingURL=route-module.js.map