"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return NextNodeServer;
    }
});
0 && __export(require("./base-server"));
require("./node-environment");
require("./require-hook");
require("./node-polyfill-crypto");
const _utils = require("../shared/lib/utils");
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _path = require("path");
const _routematcher = require("../shared/lib/router/utils/route-matcher");
const _requestmeta = require("./request-meta");
const _constants = require("../shared/lib/constants");
const _findpagesdir = require("../lib/find-pages-dir");
const _node = require("./base-http/node");
const _sendpayload = require("./send-payload");
const _parseurl = require("../shared/lib/router/utils/parse-url");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
const _baseserver = /*#__PURE__*/ _interop_require_default(_export_star(require("./base-server"), exports));
const _require = require("./require");
const _denormalizepagepath = require("../shared/lib/page-path/denormalize-page-path");
const _normalizepagepath = require("../shared/lib/page-path/normalize-page-path");
const _loadcomponents = require("./load-components");
const _iserror = /*#__PURE__*/ _interop_require_wildcard(require("../lib/is-error"));
const _utils1 = require("./web/utils");
const _middlewareroutematcher = require("../shared/lib/router/utils/middleware-route-matcher");
const _env = require("@next/env");
const _querystring = require("../shared/lib/router/utils/querystring");
const _removetrailingslash = require("../shared/lib/router/utils/remove-trailing-slash");
const _getnextpathnameinfo = require("../shared/lib/router/utils/get-next-pathname-info");
const _bodystreams = require("./body-streams");
const _apiutils = require("./api-utils");
const _responsecache = /*#__PURE__*/ _interop_require_wildcard(require("./response-cache"));
const _incrementalcache = require("./lib/incremental-cache");
const _apppaths = require("../shared/lib/router/utils/app-paths");
const _setuphttpagentenv = require("./setup-http-agent-env");
const _pagesapiroutematch = require("./route-matches/pages-api-route-match");
const _tracer = require("./lib/trace/tracer");
const _constants1 = require("./lib/trace/constants");
const _nodefsmethods = require("./lib/node-fs-methods");
const _routeregex = require("../shared/lib/router/utils/route-regex");
const _pipereadable = require("./pipe-readable");
const _mockrequest = require("./lib/mock-request");
const _approuterheaders = require("../client/components/app-router-headers");
const _nextrequest = require("./web/spec-extension/adapters/next-request");
const _loadmanifestexternal = require("./load-manifest.external");
const _modulerender = require("./route-modules/app-page/module.render");
const _modulerender1 = require("./route-modules/pages/module.render");
const _interopdefault = require("../lib/interop-default");
const _formatdynamicimportpath = require("../lib/format-dynamic-import-path");
const _isinterceptionrouterewrite = require("../lib/is-interception-route-rewrite");
const _routekind = require("./route-kind");
const _invarianterror = require("../shared/lib/invariant-error");
const _awaiter = require("./after/awaiter");
const _asynccallbackset = require("./lib/async-callback-set");
const _handlers = require("./use-cache/handlers");
const _staticenv = require("../lib/static-env");
const _nodemoduleloader = require("./lib/module-loader/node-module-loader");
const _nofallbackerrorexternal = require("../shared/lib/no-fallback-error.external");
const _instrumentationglobalsexternal = require("./lib/router-utils/instrumentation-globals.external");
const _routerservercontext = require("./lib/router-utils/router-server-context");
const _globalbehaviors = require("./node-environment-extensions/global-behaviors");
const _processerrorhandlers = require("./node-environment-extensions/process-error-handlers");
function _export_star(from, to) {
    Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
            Object.defineProperty(to, k, {
                enumerable: true,
                get: function() {
                    return from[k];
                }
            });
        }
    });
    return from;
}
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
// For module that can be both CJS or ESM
const dynamicImportEsmDefault = process.env.NEXT_MINIMAL ? (id)=>import(/* webpackIgnore: true */ id).then((mod)=>mod.default || mod) : (id)=>import(id).then((mod)=>mod.default || mod);
const MiddlewareMatcherCache = new WeakMap();
function getMiddlewareMatcher(info) {
    const stored = MiddlewareMatcherCache.get(info);
    if (stored) {
        return stored;
    }
    if (!Array.isArray(info.matchers)) {
        throw Object.defineProperty(new Error(`Invariant: invalid matchers for middleware ${JSON.stringify(info)}`), "__NEXT_ERROR_CODE", {
            value: "E257",
            enumerable: false,
            configurable: true
        });
    }
    const matcher = (0, _middlewareroutematcher.getMiddlewareRouteMatcher)(info.matchers);
    MiddlewareMatcherCache.set(info, matcher);
    return matcher;
}
class NextNodeServer extends _baseserver.default {
    constructor(options){
        var _options_conf_experimental_sri, _options_conf_experimental, _options_conf_experimental1;
        // Initialize super class
        super(options), this.cleanupListeners = new _asynccallbackset.AsyncCallbackSet(), this.handleNextImageRequest = async (req, res, parsedUrl)=>{
            if (!parsedUrl.pathname || !parsedUrl.pathname.startsWith('/_next/image')) {
                return false;
            }
            // Ignore if its a middleware request
            if ((0, _requestmeta.getRequestMeta)(req, 'middlewareInvoke')) {
                return false;
            }
            if (this.minimalMode || this.nextConfig.output === 'export' || process.env.NEXT_MINIMAL) {
                res.statusCode = 400;
                res.body('Bad Request').send();
                return true;
            // the `else` branch is needed for tree-shaking
            } else {
                const { ImageOptimizerCache } = require('./image-optimizer');
                // Load custom cache handler if configured and opt-in via images.customCacheHandler
                // Cache the handler instance to preserve state across requests
                if (!this.imageCacheHandler && this.nextConfig.images.customCacheHandler) {
                    const { cacheHandler } = this.nextConfig;
                    if (cacheHandler) {
                        const CacheHandler = (0, _interopdefault.interopDefault)(await dynamicImportEsmDefault((0, _formatdynamicimportpath.formatDynamicImportPath)(this.distDir, cacheHandler)));
                        this.imageCacheHandler = new CacheHandler({
                            dev: !!this.dev,
                            flushToDisk: this.nextConfig.experimental.isrFlushToDisk,
                            serverDistDir: this.serverDistDir,
                            maxMemoryCacheSize: this.nextConfig.cacheMaxMemorySize,
                            revalidatedTags: [],
                            _requestHeaders: {}
                        });
                    }
                }
                const imageOptimizerCache = new ImageOptimizerCache({
                    distDir: this.distDir,
                    nextConfig: this.nextConfig,
                    cacheHandler: this.imageCacheHandler
                });
                const { sendResponse, ImageError } = require('./image-optimizer');
                if (!this.imageResponseCache) {
                    throw Object.defineProperty(new Error('invariant image optimizer cache was not initialized'), "__NEXT_ERROR_CODE", {
                        value: "E160",
                        enumerable: false,
                        configurable: true
                    });
                }
                const imagesConfig = this.nextConfig.images;
                if (imagesConfig.loader !== 'default' || imagesConfig.unoptimized) {
                    await this.render404(req, res);
                    return true;
                }
                const paramsResult = ImageOptimizerCache.validateParams(req.originalRequest, parsedUrl.query, this.nextConfig, !!this.dev);
                if ('errorMessage' in paramsResult) {
                    res.statusCode = 400;
                    res.body(paramsResult.errorMessage).send();
                    return true;
                }
                const cacheKey = ImageOptimizerCache.getCacheKey(paramsResult);
                try {
                    var _cacheEntry_value, _cacheEntry_cacheControl;
                    const { getExtension } = require('./serve-static');
                    const cacheEntry = await this.imageResponseCache.get(cacheKey, async ({ previousCacheEntry })=>{
                        const { buffer, contentType, maxAge, upstreamEtag, etag } = await this.imageOptimizer(req, res, paramsResult, previousCacheEntry);
                        return {
                            value: {
                                kind: _responsecache.CachedRouteKind.IMAGE,
                                buffer,
                                etag,
                                extension: getExtension(contentType),
                                upstreamEtag
                            },
                            cacheControl: {
                                revalidate: maxAge,
                                expire: undefined
                            }
                        };
                    }, {
                        routeKind: _routekind.RouteKind.IMAGE,
                        incrementalCache: imageOptimizerCache,
                        isFallback: false
                    });
                    if ((cacheEntry == null ? void 0 : (_cacheEntry_value = cacheEntry.value) == null ? void 0 : _cacheEntry_value.kind) !== _responsecache.CachedRouteKind.IMAGE) {
                        throw Object.defineProperty(new Error('invariant did not get entry from image response cache'), "__NEXT_ERROR_CODE", {
                            value: "E518",
                            enumerable: false,
                            configurable: true
                        });
                    }
                    sendResponse(req.originalRequest, res.originalResponse, paramsResult.href, cacheEntry.value.extension, cacheEntry.value.buffer, cacheEntry.value.etag, paramsResult.isStatic, cacheEntry.isMiss ? 'MISS' : cacheEntry.isStale ? 'STALE' : 'HIT', imagesConfig, ((_cacheEntry_cacheControl = cacheEntry.cacheControl) == null ? void 0 : _cacheEntry_cacheControl.revalidate) || 0, Boolean(this.dev));
                    return true;
                } catch (err) {
                    if (err instanceof ImageError) {
                        res.statusCode = err.statusCode;
                        res.body(err.message).send();
                        return true;
                    }
                    throw err;
                }
            }
        }, this.handleCatchallRenderRequest = async (req, res, parsedUrl)=>{
            let { pathname, query } = parsedUrl;
            if (!pathname) {
                throw Object.defineProperty(new Error('Invariant: pathname is undefined'), "__NEXT_ERROR_CODE", {
                    value: "E409",
                    enumerable: false,
                    configurable: true
                });
            }
            // When in minimal mode we do not bubble the fallback as the
            // router-server is not present to handle the error
            (0, _requestmeta.addRequestMeta)(req, 'bubbleNoFallback', this.minimalMode ? undefined : true);
            // This is needed to expose render404 and nextConfig
            // for environments without router-server
            if (!_routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol]) {
                _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol] = {};
            }
            const relativeProjectDir = (0, _path.relative)(process.cwd(), this.dir);
            const existingServerContext = _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol][relativeProjectDir];
            if (!existingServerContext) {
                _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol][relativeProjectDir] = {
                    render404: this.render404.bind(this)
                };
            }
            _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol][relativeProjectDir].nextConfig = this.nextConfig;
            _routerservercontext.routerServerGlobal[_routerservercontext.RouterServerContextSymbol][relativeProjectDir].isWrappedByNextServer = true;
            try {
                var _this_i18nProvider;
                // next.js core assumes page path without trailing slash
                pathname = (0, _removetrailingslash.removeTrailingSlash)(pathname);
                const options = {
                    i18n: (_this_i18nProvider = this.i18nProvider) == null ? void 0 : _this_i18nProvider.fromRequest(req, pathname)
                };
                const match = await this.matchers.match(pathname, options);
                // If we don't have a match, try to render it anyways.
                if (!match) {
                    await this.render(req, res, pathname, query, parsedUrl, true);
                    return true;
                }
                // Add the match to the request so we don't have to re-run the matcher
                // for the same request.
                (0, _requestmeta.addRequestMeta)(req, 'match', match);
                // TODO-APP: move this to a route handler
                const edgeFunctionsPages = this.getEdgeFunctionsPages();
                for (const edgeFunctionsPage of edgeFunctionsPages){
                    // If the page doesn't match the edge function page, skip it.
                    if (edgeFunctionsPage !== match.definition.page) continue;
                    if (this.nextConfig.output === 'export') {
                        await this.render404(req, res, parsedUrl);
                        return true;
                    }
                    delete query[_approuterheaders.NEXT_RSC_UNION_QUERY];
                    // If we handled the request, we can return early.
                    // For api routes edge runtime
                    try {
                        const handled = await this.runEdgeFunction({
                            req,
                            res,
                            query,
                            params: match.params,
                            page: match.definition.page,
                            match,
                            appPaths: null
                        });
                        if (handled) return true;
                    } catch (apiError) {
                        const silenceLog = false;
                        await this.instrumentationOnRequestError(apiError, req, {
                            routePath: match.definition.page,
                            routerKind: 'Pages Router',
                            routeType: 'route',
                            // Edge runtime does not support ISR
                            revalidateReason: undefined
                        }, silenceLog);
                        throw apiError;
                    }
                }
                // If the route was detected as being a Pages API route, then handle
                // it.
                // TODO: move this behavior into a route handler.
                if ((0, _pagesapiroutematch.isPagesAPIRouteMatch)(match)) {
                    if (this.nextConfig.output === 'export') {
                        await this.render404(req, res, parsedUrl);
                        return true;
                    }
                    const handled = await this.handleApiRequest(req, res, query, match);
                    if (handled) return true;
                }
                await this.render(req, res, pathname, query, parsedUrl, true);
                return true;
            } catch (err) {
                if (err instanceof _nofallbackerrorexternal.NoFallbackError) {
                    throw err;
                }
                try {
                    if (this.dev) {
                        const { formatServerError } = require('../lib/format-server-error');
                        formatServerError(err);
                        this.logErrorWithOriginalStack(err);
                    } else {
                        this.logError(err);
                    }
                    res.statusCode = 500;
                    await this.renderError(err, req, res, pathname, query);
                    return true;
                } catch  {}
                throw err;
            }
        }, this.handleCatchallMiddlewareRequest = async (req, res, parsed)=>{
            const isMiddlewareInvoke = (0, _requestmeta.getRequestMeta)(req, 'middlewareInvoke');
            if (!isMiddlewareInvoke) {
                return false;
            }
            const handleFinished = ()=>{
                (0, _requestmeta.addRequestMeta)(req, 'middlewareInvoke', true);
                res.body('').send();
                return true;
            };
            const middleware = await this.getMiddleware();
            if (!middleware) {
                return handleFinished();
            }
            const initUrl = (0, _requestmeta.getRequestMeta)(req, 'initURL');
            const parsedUrl = (0, _parseurl.parseUrl)(initUrl);
            const pathnameInfo = (0, _getnextpathnameinfo.getNextPathnameInfo)(parsedUrl.pathname, {
                nextConfig: this.nextConfig,
                i18nProvider: this.i18nProvider
            });
            parsedUrl.pathname = pathnameInfo.pathname;
            const normalizedPathname = (0, _removetrailingslash.removeTrailingSlash)(parsed.pathname || '');
            let maybeDecodedPathname = normalizedPathname;
            try {
                maybeDecodedPathname = decodeURIComponent(normalizedPathname);
            } catch  {
            /* non-fatal we can't decode so can't match it */ }
            if (!(middleware.match(normalizedPathname, req, parsedUrl.query) || middleware.match(maybeDecodedPathname, req, parsedUrl.query))) {
                return handleFinished();
            }
            let result;
            let bubblingResult = false;
            try {
                await this.ensureMiddleware(req.url);
                result = await this.runMiddleware({
                    request: req,
                    response: res,
                    parsedUrl: parsedUrl,
                    parsed: parsed
                });
                if ('response' in result) {
                    if (isMiddlewareInvoke) {
                        bubblingResult = true;
                        throw Object.defineProperty(new _tracer.BubbledError(true, result), "__NEXT_ERROR_CODE", {
                            value: "E394",
                            enumerable: false,
                            configurable: true
                        });
                    }
                    for (const [key, value] of Object.entries((0, _utils1.toNodeOutgoingHttpHeaders)(result.response.headers))){
                        if (key !== 'content-encoding' && value !== undefined) {
                            res.setHeader(key, value);
                        }
                    }
                    res.statusCode = result.response.status;
                    const { originalResponse } = res;
                    if (result.response.body) {
                        await (0, _pipereadable.pipeToNodeResponse)(result.response.body, originalResponse);
                    } else {
                        originalResponse.end();
                    }
                    return true;
                }
            } catch (err) {
                if (bubblingResult) {
                    throw err;
                }
                if ((0, _iserror.default)(err) && err.code === 'ENOENT') {
                    await this.render404(req, res, parsed);
                    return true;
                }
                if (err instanceof _utils.DecodeError) {
                    res.statusCode = 400;
                    await this.renderError(err, req, res, parsed.pathname || '');
                    return true;
                }
                const error = (0, _iserror.getProperError)(err);
                console.error(error);
                res.statusCode = 500;
                await this.renderError(error, req, res, parsed.pathname || '');
                return true;
            }
            return result.finished;
        };
        (0, _globalbehaviors.installGlobalBehaviors)(this.nextConfig);
        // Load prefetch hints from the build output. This must happen before
        // any render to ensure segment inlining decisions are available.
        this.renderOpts.prefetchHints = this.getPrefetchHints();
        const isDev = options.dev ?? false;
        this.isDev = isDev;
        this.sriEnabled = Boolean((_options_conf_experimental = options.conf.experimental) == null ? void 0 : (_options_conf_experimental_sri = _options_conf_experimental.sri) == null ? void 0 : _options_conf_experimental_sri.algorithm);
        /**
     * This sets environment variable to be used at the time of SSR by head.tsx.
     * Using this from process.env allows targeting SSR by calling
     * `process.env.__NEXT_OPTIMIZE_CSS`.
     */ if (this.renderOpts.optimizeCss) {
            process.env.__NEXT_OPTIMIZE_CSS = JSON.stringify(true);
        }
        if (this.renderOpts.nextScriptWorkers) {
            process.env.__NEXT_SCRIPT_WORKERS = JSON.stringify(true);
        }
        if (!this.minimalMode) {
            this.imageResponseCache = new _responsecache.default(this.minimalMode);
        }
        if (!options.dev && !this.minimalMode && this.nextConfig.experimental.preloadEntriesOnStart) {
            this.unstable_preloadEntries();
        }
        if (!options.dev) {
            const { dynamicRoutes = [] } = this.getRoutesManifest() ?? {};
            this.dynamicRoutes = dynamicRoutes.map((r)=>{
                // TODO: can we just re-use the regex from the manifest?
                const regex = (0, _routeregex.getRouteRegex)(r.page);
                const match = (0, _routematcher.getRouteMatcher)(regex);
                return {
                    match,
                    page: r.page,
                    re: regex.re
                };
            });
        }
        // ensure options are set when loadConfig isn't called
        (0, _setuphttpagentenv.setHttpClientAndAgentOptions)(this.nextConfig);
        // Intercept fetch and other testmode apis.
        if (this.serverOptions.experimentalTestProxy) {
            process.env.NEXT_PRIVATE_TEST_PROXY = 'true';
            const { interceptTestApis } = // eslint-disable-next-line @next/internal/typechecked-require -- experimental/testmode is not built ins next/dist/esm
            require('next/dist/experimental/testmode/server');
            interceptTestApis();
        }
        this.middlewareManifestPath = (0, _path.join)(/* turbopackIgnore: true */ this.serverDistDir, _constants.MIDDLEWARE_MANIFEST);
        // This is just optimization to fire prepare as soon as possible. It will be
        // properly awaited later. We add the catch here to ensure that it does not
        // cause a unhandled promise rejection. The promise rejection will be
        // handled later on via the `await` when the request handler is called.
        if (!options.dev) {
            this.prepare().catch((err)=>{
                console.error('Failed to prepare server', err);
            });
        }
        // when using compile mode static env isn't inlined so we
        // need to populate in normal runtime env
        if (this.renderOpts.isExperimentalCompile) {
            // immutableAssetToken only works with Turbopack, and `isExperimentalCompile` isn't supported
            // with that anyway, so we can assign immutableAssetToken to deploymentId here
            (0, _staticenv.populateStaticEnv)(this.nextConfig, this.deploymentId || '');
        }
        const shouldRemoveUncaughtErrorAndRejectionListeners = Boolean((_options_conf_experimental1 = options.conf.experimental) == null ? void 0 : _options_conf_experimental1.removeUncaughtErrorAndRejectionListeners);
        (0, _processerrorhandlers.installProcessErrorHandlers)(shouldRemoveUncaughtErrorAndRejectionListeners);
    }
    async unstable_preloadEntries() {
        // Ensure prepare process will be finished before preloading entries.
        await this.prepare();
        const appPathsManifest = this.getAppPathsManifest();
        const pagesManifest = this.getPagesManifest();
        await this.loadCustomCacheHandlers();
        for (const page of Object.keys(pagesManifest || {})){
            try {
                await (0, _loadcomponents.loadComponents)({
                    distDir: this.distDir,
                    page,
                    isAppPath: false,
                    isDev: this.isDev,
                    sriEnabled: this.sriEnabled,
                    needsManifestsForLegacyReasons: false
                });
            } catch (_err) {
            // Intentionally ignored because this is a preload step.
            }
        }
        for (const page of Object.keys(appPathsManifest || {})){
            try {
                const { ComponentMod } = await (0, _loadcomponents.loadComponents)({
                    distDir: this.distDir,
                    page,
                    isAppPath: true,
                    isDev: this.isDev,
                    sriEnabled: this.sriEnabled,
                    needsManifestsForLegacyReasons: false
                });
                // we need to ensure fetch is patched before we require the page,
                // otherwise if the fetch is patched by user code, we will be patching it
                // too late and there won't be any caching behaviors
                ComponentMod.patchFetch();
            } catch (_err) {
            // Intentionally ignored because this is a preload step.
            }
        }
    }
    async handleUpgrade() {
    // The web server does not support web sockets, it's only used for HMR in
    // development.
    }
    async loadInstrumentationModule() {
        if (!this.serverOptions.dev) {
            try {
                this.instrumentation = await (0, _instrumentationglobalsexternal.getInstrumentationModule)(this.dir, this.nextConfig.distDir);
            } catch (err) {
                if (err.code !== 'MODULE_NOT_FOUND') {
                    throw Object.defineProperty(new Error('An error occurred while loading the instrumentation hook', {
                        cause: err
                    }), "__NEXT_ERROR_CODE", {
                        value: "E92",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
        }
        return this.instrumentation;
    }
    async prepareImpl() {
        await super.prepareImpl();
        await this.runInstrumentationHookIfAvailable();
    }
    async runInstrumentationHookIfAvailable() {
        await (0, _instrumentationglobalsexternal.ensureInstrumentationRegistered)(this.dir, this.nextConfig.distDir);
    }
    loadEnvConfig({ dev, forceReload }) {
        (0, _env.loadEnvConfig)(this.dir, dev, _log, forceReload, forceReload ? (envFilePath)=>{
            _log.info(`Reload env: ${envFilePath}`);
        } : undefined);
    }
    async loadCustomCacheHandlers() {
        const { cacheMaxMemorySize, cacheHandlers } = this.nextConfig;
        if (!cacheHandlers) return;
        // If we've already initialized the cache handlers interface, don't do it
        // again.
        if (!(0, _handlers.initializeCacheHandlers)(cacheMaxMemorySize)) return;
        for (const [kind, handler] of Object.entries(cacheHandlers)){
            if (!handler) continue;
            (0, _handlers.setCacheHandler)(kind, (0, _interopdefault.interopDefault)(await dynamicImportEsmDefault((0, _formatdynamicimportpath.formatDynamicImportPath)(this.distDir, handler))));
        }
    }
    async getIncrementalCache({ requestHeaders }) {
        const dev = !!this.dev;
        let CacheHandler;
        const { cacheHandler } = this.nextConfig;
        if (cacheHandler) {
            CacheHandler = (0, _interopdefault.interopDefault)(await dynamicImportEsmDefault((0, _formatdynamicimportpath.formatDynamicImportPath)(this.distDir, cacheHandler)));
        }
        await this.loadCustomCacheHandlers();
        // incremental-cache is request specific
        // although can have shared caches in module scope
        // per-cache handler
        return new _incrementalcache.IncrementalCache({
            fs: this.getCacheFilesystem(),
            dev,
            requestHeaders,
            allowedRevalidateHeaderKeys: this.nextConfig.experimental.allowedRevalidateHeaderKeys,
            minimalMode: this.minimalMode,
            serverDistDir: this.serverDistDir,
            fetchCacheKeyPrefix: this.nextConfig.experimental.fetchCacheKeyPrefix,
            maxMemoryCacheSize: this.nextConfig.cacheMaxMemorySize,
            flushToDisk: !this.minimalMode && this.nextConfig.experimental.isrFlushToDisk,
            getPrerenderManifest: ()=>this.getPrerenderManifest(),
            CurCacheHandler: CacheHandler
        });
    }
    getPublicDir() {
        return (0, _path.join)(/* turbopackIgnore: true */ this.dir, _constants.CLIENT_PUBLIC_FILES_PATH);
    }
    getHasStaticDir() {
        return _fs.default.existsSync(/* turbopackIgnore: true */ (0, _path.join)(/* turbopackIgnore: true */ this.dir, 'static'));
    }
    getPagesManifest() {
        return (0, _loadmanifestexternal.loadManifest)((0, _path.join)(/* turbopackIgnore: true */ this.serverDistDir, _constants.PAGES_MANIFEST));
    }
    getAppPathsManifest() {
        if (!this.enabledDirectories.app) return undefined;
        return (0, _loadmanifestexternal.loadManifest)((0, _path.join)(/* turbopackIgnore: true */ this.serverDistDir, _constants.APP_PATHS_MANIFEST));
    }
    getinterceptionRoutePatterns() {
        if (!this.enabledDirectories.app) return [];
        const routesManifest = this.getRoutesManifest();
        return (routesManifest == null ? void 0 : routesManifest.rewrites.beforeFiles.filter(_isinterceptionrouterewrite.isInterceptionRouteRewrite).map((rewrite)=>new RegExp(rewrite.regex))) ?? [];
    }
    async hasPage(pathname) {
        var _this_nextConfig_i18n;
        return !!(0, _require.getMaybePagePath)(pathname, this.distDir, (_this_nextConfig_i18n = this.nextConfig.i18n) == null ? void 0 : _this_nextConfig_i18n.locales, this.enabledDirectories.app);
    }
    getBuildId() {
        const buildIdFile = (0, _path.join)(/* turbopackIgnore: true */ this.distDir, _constants.BUILD_ID_FILE);
        try {
            return _fs.default.readFileSync(/* turbopackIgnore: true */ buildIdFile, 'utf8').trim();
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw Object.defineProperty(new Error(`Could not find a production build in the '${this.distDir}' directory. Try building your app with 'next build' before starting the production server. https://nextjs.org/docs/messages/production-start-no-build-id`), "__NEXT_ERROR_CODE", {
                    value: "E427",
                    enumerable: false,
                    configurable: true
                });
            }
            throw err;
        }
    }
    getEnabledDirectories(dev) {
        const dir = dev ? this.dir : this.serverDistDir;
        return {
            app: (0, _findpagesdir.findDir)(dir, 'app') ? true : false,
            pages: (0, _findpagesdir.findDir)(dir, 'pages') ? true : false
        };
    }
    sendRenderResult(req, res, options) {
        return (0, _sendpayload.sendRenderResult)({
            req: req.originalRequest,
            res: res.originalResponse,
            result: options.result,
            generateEtags: options.generateEtags,
            poweredByHeader: options.poweredByHeader,
            cacheControl: options.cacheControl
        });
    }
    async runApi(req, res, query, match) {
        const edgeFunctionsPages = this.getEdgeFunctionsPages();
        for (const edgeFunctionsPage of edgeFunctionsPages){
            if (edgeFunctionsPage === match.definition.pathname) {
                const handledAsEdgeFunction = await this.runEdgeFunction({
                    req,
                    res,
                    query,
                    params: match.params,
                    page: match.definition.pathname,
                    appPaths: null
                });
                if (handledAsEdgeFunction) {
                    return true;
                }
            }
        }
        // The module supports minimal mode, load the minimal module.
        // Restore original URL as the handler handles it's own parsing
        const parsedInitUrl = (0, _parseurl.parseUrl)((0, _requestmeta.getRequestMeta)(req, 'initURL') || req.url);
        req.url = `${parsedInitUrl.pathname}${parsedInitUrl.search || ''}`;
        const loader = new _nodemoduleloader.NodeModuleLoader();
        const module = await loader.load(match.definition.filename);
        (0, _requestmeta.addRequestMeta)(req.originalRequest, 'relativeProjectDir', (0, _path.relative)(process.cwd(), this.dir));
        (0, _requestmeta.addRequestMeta)(req.originalRequest, 'distDir', this.distDir);
        await module.handler(req.originalRequest, res.originalResponse, {
            waitUntil: this.getWaitUntil()
        });
        return true;
    }
    async renderHTML(req, res, pathname, query, renderOpts) {
        return (0, _tracer.getTracer)().trace(_constants1.NextNodeServerSpan.renderHTML, async ()=>this.renderHTMLImpl(req, res, pathname, query, renderOpts));
    }
    async renderHTMLImpl(req, res, pathname, query, renderOpts) {
        if (process.env.NEXT_MINIMAL) {
            throw Object.defineProperty(new Error('Invariant: renderHTML should not be called in minimal mode'), "__NEXT_ERROR_CODE", {
                value: "E472",
                enumerable: false,
                configurable: true
            });
        // the `else` branch is needed for tree-shaking
        } else {
            // Due to the way we pass data by mutating `renderOpts`, we can't extend the
            // object here but only updating its `nextFontManifest` field.
            // https://github.com/vercel/next.js/blob/df7cbd904c3bd85f399d1ce90680c0ecf92d2752/packages/next/server/render.tsx#L947-L952
            renderOpts.nextFontManifest = this.nextFontManifest;
            if (this.enabledDirectories.app && renderOpts.isAppPath) {
                return (0, _modulerender.lazyRenderAppPage)(req, res, pathname, query, // This code path does not service revalidations for unknown param
                // shells. As a result, we don't need to pass in the unknown params.
                null, renderOpts, this.getServerComponentsHmrCache(), {
                    buildId: this.buildId,
                    deploymentId: this.deploymentId,
                    clientAssetToken: this.nextConfig.experimental.immutableAssetToken ?? this.deploymentId
                });
            } else {
                // TODO: re-enable this once we've refactored to use implicit matches
                // throw new Error('Invariant: render should have used routeModule')
                return (0, _modulerender1.lazyRenderPagesPage)(req.originalRequest, res.originalResponse, pathname, query, renderOpts, {
                    buildId: this.buildId,
                    deploymentId: this.deploymentId,
                    clientAssetToken: this.nextConfig.experimental.immutableAssetToken ?? this.deploymentId,
                    customServer: this.serverOptions.customServer || undefined
                }, {
                    isFallback: false,
                    isDraftMode: renderOpts.isDraftMode,
                    developmentNotFoundSourcePage: (0, _requestmeta.getRequestMeta)(req, 'developmentNotFoundSourcePage')
                });
            }
        }
    }
    async imageOptimizer(req, res, paramsResult, previousCacheEntry) {
        if (process.env.NEXT_MINIMAL) {
            throw Object.defineProperty(new Error('invariant: imageOptimizer should not be called in minimal mode'), "__NEXT_ERROR_CODE", {
                value: "E506",
                enumerable: false,
                configurable: true
            });
        } else {
            const { imageOptimizer, fetchExternalImage, fetchInternalImage } = require('./image-optimizer');
            const handleInternalReq = async (newReq, newRes)=>{
                if (newReq.url === req.url) {
                    throw Object.defineProperty(new Error(`Invariant attempted to optimize _next/image itself`), "__NEXT_ERROR_CODE", {
                        value: "E496",
                        enumerable: false,
                        configurable: true
                    });
                }
                if (!this.routerServerHandler) {
                    throw Object.defineProperty(new Error(`Invariant missing routerServerHandler`), "__NEXT_ERROR_CODE", {
                        value: "E317",
                        enumerable: false,
                        configurable: true
                    });
                }
                await this.routerServerHandler(newReq, newRes);
                return;
            };
            let { href } = paramsResult;
            if (process.env.__NEXT_TEST_MODE && process.env.IS_TURBOPACK_TEST && !paramsResult.isAbsolute) {
                // Forward the dpl query param from the original /_next/image request to the
                // internal static file request so that the static file validation in
                // resolve-routes.ts can verify it.
                const dpl = typeof req.url === 'string' ? new URL(req.url, 'http://n').searchParams.get('dpl') : undefined;
                if (dpl) {
                    href += `${href.includes('?') ? '&' : '?'}dpl=${dpl}`;
                }
            }
            const imageUpstream = paramsResult.isAbsolute ? await fetchExternalImage(href, this.nextConfig.images.dangerouslyAllowLocalIP, this.nextConfig.images.maximumResponseBody, this.nextConfig.images.maximumRedirects) : await fetchInternalImage(href, req.originalRequest, res.originalResponse, handleInternalReq);
            return imageOptimizer(imageUpstream, paramsResult, this.nextConfig, {
                isDev: this.dev,
                previousCacheEntry
            });
        }
    }
    getPagePath(pathname, locales) {
        return (0, _require.getPagePath)(pathname, this.distDir, locales, this.enabledDirectories.app);
    }
    async renderPageComponent(ctx, bubbleNoFallback) {
        const edgeFunctionsPages = this.getEdgeFunctionsPages() || [];
        if (edgeFunctionsPages.length) {
            const appPaths = this.getOriginalAppPaths(ctx.pathname);
            const isAppPath = Array.isArray(appPaths);
            let page = ctx.pathname;
            if (isAppPath) {
                // When it's an array, we need to pass all parallel routes to the loader.
                page = appPaths[0];
            }
            for (const edgeFunctionsPage of edgeFunctionsPages){
                if (edgeFunctionsPage === page) {
                    await this.runEdgeFunction({
                        req: ctx.req,
                        res: ctx.res,
                        query: ctx.query,
                        params: ctx.renderOpts.params,
                        page,
                        appPaths
                    });
                    return null;
                }
            }
        }
        return super.renderPageComponent(ctx, bubbleNoFallback);
    }
    async findPageComponents({ locale, page, query, params, isAppPath, url }) {
        return (0, _tracer.getTracer)().trace(_constants1.NextNodeServerSpan.findPageComponents, {
            spanName: 'resolve page components',
            attributes: {
                'next.route': isAppPath ? (0, _apppaths.normalizeAppPath)(page) : page
            }
        }, ()=>this.findPageComponentsImpl({
                locale,
                page,
                query,
                params,
                isAppPath,
                url
            }));
    }
    async findPageComponentsImpl({ locale, page, query, params, isAppPath, url: _url }) {
        const pagePaths = [
            page
        ];
        if (locale) {
            pagePaths.unshift(...pagePaths.map((path)=>`/${locale}${path === '/' ? '' : path}`));
        }
        for (const pagePath of pagePaths){
            try {
                const components = await (0, _loadcomponents.loadComponents)({
                    distDir: this.distDir,
                    page: pagePath,
                    isAppPath,
                    isDev: this.isDev,
                    sriEnabled: this.sriEnabled,
                    needsManifestsForLegacyReasons: false
                });
                if (locale && typeof components.Component === 'string' && !pagePath.startsWith(`/${locale}/`) && pagePath !== `/${locale}`) {
                    continue;
                }
                return {
                    components,
                    query: {
                        ...!this.renderOpts.isExperimentalCompile && components.getStaticProps ? {} : query,
                        // For appDir params is excluded.
                        ...(isAppPath ? {} : params) || {}
                    }
                };
            } catch (err) {
                // we should only not throw if we failed to find the page
                // in the pages-manifest
                if (!(err instanceof _utils.PageNotFoundError)) {
                    throw err;
                }
            }
        }
        return null;
    }
    getNextFontManifest() {
        return (0, _loadmanifestexternal.loadManifest)((0, _path.join)(/* turbopackIgnore: true */ this.distDir, 'server', _constants.NEXT_FONT_MANIFEST + '.json'));
    }
    // Used in development only, overloaded in next-dev-server
    logErrorWithOriginalStack(_err, _type) {
        throw Object.defineProperty(new Error('Invariant: logErrorWithOriginalStack can only be called on the development server'), "__NEXT_ERROR_CODE", {
            value: "E6",
            enumerable: false,
            configurable: true
        });
    }
    // Used in development only, overloaded in next-dev-server
    async ensurePage(_opts) {
        throw Object.defineProperty(new Error('Invariant: ensurePage can only be called on the development server'), "__NEXT_ERROR_CODE", {
            value: "E291",
            enumerable: false,
            configurable: true
        });
    }
    /**
   * Resolves `API` request, in development builds on demand
   * @param req http request
   * @param res http response
   * @param pathname path of request
   */ async handleApiRequest(req, res, query, match) {
        return this.runApi(req, res, query, match);
    }
    getCacheFilesystem() {
        return _nodefsmethods.nodeFs;
    }
    normalizeReq(req) {
        return !(req instanceof _node.NodeNextRequest) ? new _node.NodeNextRequest(req) : req;
    }
    normalizeRes(res) {
        return !(res instanceof _node.NodeNextResponse) ? new _node.NodeNextResponse(res) : res;
    }
    getRequestHandler() {
        const handler = this.makeRequestHandler();
        if (this.serverOptions.experimentalTestProxy) {
            const { wrapRequestHandlerNode } = // eslint-disable-next-line @next/internal/typechecked-require -- experimental/testmode is not built ins next/dist/esm
            require('next/dist/experimental/testmode/server');
            return wrapRequestHandlerNode(handler);
        }
        return handler;
    }
    /**
   * @internal - this method is internal to Next.js and should not be used directly by end-users
   */ getRequestHandlerWithMetadata(meta) {
        const handler = this.makeRequestHandler();
        return (req, res, parsedUrl)=>{
            (0, _requestmeta.setRequestMeta)(req, meta);
            return handler(req, res, parsedUrl);
        };
    }
    makeRequestHandler() {
        // This is just optimization to fire prepare as soon as possible. It will be
        // properly awaited later. We add the catch here to ensure that it does not
        // cause an unhandled promise rejection. The promise rejection will be
        // handled later on via the `await` when the request handler is called.
        this.prepare().catch((err)=>{
            console.error('Failed to prepare server', err);
        });
        const handler = super.getRequestHandler();
        return (req, res, parsedUrl)=>handler(this.normalizeReq(req), this.normalizeRes(res), parsedUrl);
    }
    async revalidate({ urlPath, headers, opts }) {
        const mocked = (0, _mockrequest.createRequestResponseMocks)({
            url: urlPath,
            headers
        });
        const handler = this.getRequestHandler();
        await handler(new _node.NodeNextRequest(mocked.req), new _node.NodeNextResponse(mocked.res));
        await mocked.res.hasStreamed;
        if (mocked.res.getHeader('x-nextjs-cache') !== 'REVALIDATED' && mocked.res.statusCode !== 200 && !(mocked.res.statusCode === 404 && opts.unstable_onlyGenerated)) {
            throw Object.defineProperty(new Error(`Invalid response ${mocked.res.statusCode}`), "__NEXT_ERROR_CODE", {
                value: "E175",
                enumerable: false,
                configurable: true
            });
        }
    }
    async render(req, res, pathname, query, parsedUrl, internal = false) {
        return super.render(this.normalizeReq(req), this.normalizeRes(res), pathname, query, parsedUrl, internal);
    }
    async renderToHTML(req, res, pathname, query) {
        return super.renderToHTML(this.normalizeReq(req), this.normalizeRes(res), pathname, query);
    }
    async renderErrorToResponseImpl(ctx, err) {
        const { req, res, query } = ctx;
        const is404 = res.statusCode === 404;
        if (is404 && this.enabledDirectories.app) {
            if (this.dev) {
                await this.ensurePage({
                    page: _constants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY,
                    clientOnly: false,
                    url: req.url
                }).catch(()=>{});
            }
            if (this.getEdgeFunctionsPages().includes(_constants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY)) {
                await this.runEdgeFunction({
                    req,
                    res,
                    query: query || {},
                    params: {},
                    page: _constants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY,
                    appPaths: null
                });
                return null;
            }
        }
        return super.renderErrorToResponseImpl(ctx, err);
    }
    async renderError(err, req, res, pathname, query, setHeaders) {
        return super.renderError(err, this.normalizeReq(req), this.normalizeRes(res), pathname, query, setHeaders);
    }
    async renderErrorToHTML(err, req, res, pathname, query) {
        return super.renderErrorToHTML(err, this.normalizeReq(req), this.normalizeRes(res), pathname, query);
    }
    async render404(req, res, parsedUrl, setHeaders) {
        return super.render404(this.normalizeReq(req), this.normalizeRes(res), parsedUrl, setHeaders);
    }
    getMiddlewareManifest() {
        if (this.minimalMode) {
            return null;
        } else {
            const manifest = require(this.middlewareManifestPath);
            return manifest;
        }
    }
    /** Returns the middleware routing item if there is one. */ async getMiddleware() {
        var _manifest_middleware;
        const manifest = this.getMiddlewareManifest();
        const middleware = manifest == null ? void 0 : (_manifest_middleware = manifest.middleware) == null ? void 0 : _manifest_middleware['/'];
        if (!middleware) {
            const middlewareModule = await this.loadNodeMiddleware();
            if (middlewareModule) {
                var _middlewareModule_config;
                return {
                    match: (0, _middlewareroutematcher.getMiddlewareRouteMatcher)(((_middlewareModule_config = middlewareModule.config) == null ? void 0 : _middlewareModule_config.matchers) || [
                        {
                            regexp: '.*',
                            originalSource: '/:path*'
                        }
                    ]),
                    page: '/'
                };
            }
            return;
        }
        return {
            match: getMiddlewareMatcher(middleware),
            page: '/'
        };
    }
    getEdgeFunctionsPages() {
        const manifest = this.getMiddlewareManifest();
        if (!manifest) {
            return [];
        }
        return Object.keys(manifest.functions);
    }
    /**
   * Get information for the edge function located in the provided page
   * folder. If the edge function info can't be found it will throw
   * an error.
   */ getEdgeFunctionInfo(params) {
        const manifest = this.getMiddlewareManifest();
        if (!manifest) {
            return null;
        }
        let foundPage;
        try {
            foundPage = (0, _denormalizepagepath.denormalizePagePath)((0, _normalizepagepath.normalizePagePath)(params.page));
        } catch (err) {
            return null;
        }
        let pageInfo = params.middleware ? manifest.middleware[foundPage] : manifest.functions[foundPage];
        if (!pageInfo) {
            if (!params.middleware) {
                throw new _utils.PageNotFoundError(foundPage);
            }
            return null;
        }
        return {
            name: pageInfo.name,
            paths: pageInfo.files.map((file)=>(0, _path.join)(/* turbopackIgnore: true */ this.distDir, file)),
            wasm: (pageInfo.wasm ?? []).map((binding)=>({
                    ...binding,
                    filePath: (0, _path.join)(/* turbopackIgnore: true */ this.distDir, binding.filePath)
                })),
            assets: pageInfo.assets && pageInfo.assets.map((binding)=>{
                return {
                    ...binding,
                    filePath: (0, _path.join)(/* turbopackIgnore: true */ this.distDir, binding.filePath)
                };
            }),
            env: pageInfo.env
        };
    }
    async loadNodeMiddleware() {
        if (!process.env.NEXT_MINIMAL) {
            try {
                var _functionsConfig_functions;
                const functionsConfig = this.dev ? {} : require((0, _path.join)(/* turbopackIgnore: true */ this.distDir, 'server', _constants.FUNCTIONS_CONFIG_MANIFEST));
                if (this.dev || (functionsConfig == null ? void 0 : (_functionsConfig_functions = functionsConfig.functions) == null ? void 0 : _functionsConfig_functions['/_middleware'])) {
                    // if used with top level await, this will be a promise
                    return require((0, _path.join)(/* turbopackIgnore: true */ this.distDir, 'server', 'middleware.js'));
                }
            } catch (err) {
                if ((0, _iserror.default)(err) && err.code !== 'ENOENT' && err.code !== 'MODULE_NOT_FOUND') {
                    throw err;
                }
            }
        }
    }
    /**
   * Checks if a middleware exists. This method is useful for the development
   * server where we need to check the filesystem. Here we just check the
   * middleware manifest.
   */ async hasMiddleware(pathname) {
        const info = this.getEdgeFunctionInfo({
            page: pathname,
            middleware: true
        });
        const nodeMiddleware = await this.loadNodeMiddleware();
        if (!info && nodeMiddleware) {
            return true;
        }
        return Boolean(info && info.paths.length > 0);
    }
    /**
   * A placeholder for a function to be defined in the development server.
   * It will make sure that the root middleware or an edge function has been compiled
   * so that we can run it.
   */ async ensureMiddleware(_url) {}
    async ensureEdgeFunction(_params) {}
    /**
   * This method gets all middleware matchers and execute them when the request
   * matches. It will make sure that each middleware exists and is compiled and
   * ready to be invoked. The development server will decorate it to add warns
   * and errors with rich traces.
   */ async runMiddleware(params) {
        if (process.env.NEXT_MINIMAL) {
            throw Object.defineProperty(new Error('invariant: runMiddleware should not be called in minimal mode'), "__NEXT_ERROR_CODE", {
                value: "E276",
                enumerable: false,
                configurable: true
            });
        }
        // Middleware is skipped for on-demand revalidate requests
        if ((0, _apiutils.checkIsOnDemandRevalidate)(params.request, this.renderOpts.previewProps).isOnDemandRevalidate) {
            return {
                response: new Response(null, {
                    headers: {
                        'x-middleware-next': '1'
                    }
                })
            };
        }
        let url;
        if (this.nextConfig.skipProxyUrlNormalize) {
            url = (0, _requestmeta.getRequestMeta)(params.request, 'initURL');
        } else {
            // For middleware to "fetch" we must always provide an absolute URL
            const query = (0, _querystring.urlQueryToSearchParams)(params.parsed.query).toString();
            const locale = (0, _requestmeta.getRequestMeta)(params.request, 'locale');
            url = `${(0, _requestmeta.getRequestMeta)(params.request, 'initProtocol')}://${this.fetchHostname || 'localhost'}:${this.port}${locale ? `/${locale}` : ''}${params.parsed.pathname}${query ? `?${query}` : ''}`;
        }
        if (!url.startsWith('http')) {
            throw Object.defineProperty(new Error('To use middleware you must provide a `hostname` and `port` to the Next.js Server'), "__NEXT_ERROR_CODE", {
                value: "E35",
                enumerable: false,
                configurable: true
            });
        }
        const page = {};
        const middleware = await this.getMiddleware();
        if (!middleware) {
            return {
                finished: false
            };
        }
        if (!await this.hasMiddleware(middleware.page)) {
            return {
                finished: false
            };
        }
        await this.ensureMiddleware(params.request.url);
        const middlewareInfo = this.getEdgeFunctionInfo({
            page: middleware.page,
            middleware: true
        });
        const method = (params.request.method || 'GET').toUpperCase();
        const requestData = {
            headers: params.request.headers,
            method,
            nextConfig: {
                basePath: this.nextConfig.basePath,
                i18n: this.nextConfig.i18n,
                trailingSlash: this.nextConfig.trailingSlash,
                experimental: this.nextConfig.experimental
            },
            url: url,
            page,
            body: method !== 'GET' && method !== 'HEAD' ? (0, _requestmeta.getRequestMeta)(params.request, 'clonableBody') : undefined,
            signal: (0, _nextrequest.signalFromNodeResponse)(params.response.originalResponse),
            waitUntil: this.getWaitUntil()
        };
        let result;
        // if no middleware info check for Node.js middleware
        // this is not in the middleware-manifest as that historically
        // has only included edge-functions, we need to do a breaking
        // version bump for that manifest to write this info there if
        // we decide we want to
        if (!middlewareInfo) {
            let middlewareModule;
            middlewareModule = await this.loadNodeMiddleware();
            if (!middlewareModule) {
                throw new _utils.MiddlewareNotFoundError();
            }
            const adapterFn = middlewareModule.default || middlewareModule;
            const hasRequestBody = ![
                'HEAD',
                'GET'
            ].includes(params.request.method) && Boolean(requestData.body);
            try {
                result = await adapterFn({
                    handler: middlewareModule.proxy || middlewareModule.middleware || middlewareModule,
                    request: {
                        ...requestData,
                        body: hasRequestBody ? requestData.body.cloneBodyStream() : undefined
                    },
                    page: 'middleware'
                });
            } finally{
                if (hasRequestBody) {
                    await requestData.body.finalize();
                }
            }
        } else {
            const { run } = require('./web/sandbox');
            result = await run({
                distDir: this.distDir,
                name: middlewareInfo.name,
                paths: middlewareInfo.paths,
                edgeFunctionEntry: middlewareInfo,
                request: requestData,
                useCache: true,
                onWarning: params.onWarning,
                clientAssetToken: this.nextConfig.experimental.immutableAssetToken || this.deploymentId
            });
        }
        if (!this.dev) {
            result.waitUntil.catch((error)=>{
                console.error(`Uncaught: middleware waitUntil errored`, error);
            });
        }
        if (!result) {
            this.render404(params.request, params.response, params.parsed);
            return {
                finished: true
            };
        }
        // Split compound (comma-separated) set-cookie headers
        if (result.response.headers.has('set-cookie')) {
            const cookies = result.response.headers.getSetCookie().flatMap((maybeCompoundCookie)=>(0, _utils1.splitCookiesString)(maybeCompoundCookie));
            // Clear existing header(s)
            result.response.headers.delete('set-cookie');
            // Append each cookie individually.
            for (const cookie of cookies){
                result.response.headers.append('set-cookie', cookie);
            }
            // Add cookies to request meta.
            (0, _requestmeta.addRequestMeta)(params.request, 'middlewareCookie', cookies);
        }
        return result;
    }
    getPrerenderManifest() {
        if (this._cachedPreviewManifest) {
            return this._cachedPreviewManifest;
        }
        this._cachedPreviewManifest = (0, _loadmanifestexternal.loadManifest)((0, _path.join)(/* turbopackIgnore: true */ this.distDir, _constants.PRERENDER_MANIFEST));
        return this._cachedPreviewManifest;
    }
    getPrefetchHints() {
        if (this._cachedPrefetchHints) {
            return this._cachedPrefetchHints;
        }
        this._cachedPrefetchHints = (0, _loadmanifestexternal.loadManifest)((0, _path.join)(/* turbopackIgnore: true */ this.distDir, _constants.SERVER_DIRECTORY, _constants.PREFETCH_HINTS), true, undefined, false, true // handleMissing: don't crash if the file doesn't exist
        ) ?? {};
        return this._cachedPrefetchHints;
    }
    getRoutesManifest() {
        return (0, _tracer.getTracer)().trace(_constants1.NextNodeServerSpan.getRoutesManifest, ()=>(0, _loadmanifestexternal.loadManifest)((0, _path.join)(/* turbopackIgnore: true */ this.distDir, _constants.ROUTES_MANIFEST)));
    }
    attachRequestMeta(req, parsedUrl, isUpgradeReq) {
        var _req_headers_xforwardedproto;
        // Injected in base-server.ts
        const protocol = ((_req_headers_xforwardedproto = req.headers['x-forwarded-proto']) == null ? void 0 : _req_headers_xforwardedproto.includes('https')) ? 'https' : 'http';
        // When there are hostname and port we build an absolute URL
        const initUrl = this.fetchHostname && this.port ? `${protocol}://${this.fetchHostname}:${this.port}${req.url}` : this.nextConfig.experimental.trustHostHeader ? `https://${req.headers.host || 'localhost'}${req.url}` : req.url;
        (0, _requestmeta.addRequestMeta)(req, 'initURL', initUrl);
        (0, _requestmeta.addRequestMeta)(req, 'initQuery', {
            ...parsedUrl.query
        });
        (0, _requestmeta.addRequestMeta)(req, 'initProtocol', protocol);
        if (!isUpgradeReq) {
            var _this_nextConfig_experimental;
            const bodySizeLimit = (_this_nextConfig_experimental = this.nextConfig.experimental) == null ? void 0 : _this_nextConfig_experimental.proxyClientMaxBodySize;
            (0, _requestmeta.addRequestMeta)(req, 'clonableBody', (0, _bodystreams.getCloneableBody)(req.originalRequest, bodySizeLimit));
        }
    }
    async runEdgeFunction(params) {
        if (process.env.NEXT_MINIMAL) {
            throw Object.defineProperty(new Error('Middleware is not supported in minimal mode. Please remove the `NEXT_MINIMAL` environment variable.'), "__NEXT_ERROR_CODE", {
                value: "E58",
                enumerable: false,
                configurable: true
            });
        }
        let edgeInfo;
        const { query, page, match } = params;
        if (!match) await this.ensureEdgeFunction({
            page,
            appPaths: params.appPaths,
            url: params.req.url
        });
        edgeInfo = this.getEdgeFunctionInfo({
            page,
            middleware: false
        });
        if (!edgeInfo) {
            return null;
        }
        // For edge to "fetch" we must always provide an absolute URL
        const isNextDataRequest = (0, _requestmeta.getRequestMeta)(params.req, 'isNextDataReq');
        const initialUrl = new URL((0, _requestmeta.getRequestMeta)(params.req, 'initURL') || '/', 'http://n');
        const queryString = (0, _querystring.urlQueryToSearchParams)({
            ...Object.fromEntries(initialUrl.searchParams),
            ...query,
            ...params.params
        }).toString();
        if (isNextDataRequest) {
            params.req.headers['x-nextjs-data'] = '1';
        }
        initialUrl.search = queryString;
        const url = initialUrl.toString();
        if (!url.startsWith('http')) {
            throw Object.defineProperty(new Error('To use middleware you must provide a `hostname` and `port` to the Next.js Server'), "__NEXT_ERROR_CODE", {
                value: "E35",
                enumerable: false,
                configurable: true
            });
        }
        const { run } = require('./web/sandbox');
        const result = await run({
            distDir: this.distDir,
            name: edgeInfo.name,
            paths: edgeInfo.paths,
            edgeFunctionEntry: edgeInfo,
            request: {
                headers: params.req.headers,
                method: params.req.method,
                nextConfig: {
                    basePath: this.nextConfig.basePath,
                    i18n: this.nextConfig.i18n,
                    trailingSlash: this.nextConfig.trailingSlash
                },
                url,
                page: {
                    name: params.page,
                    ...params.params && {
                        params: params.params
                    }
                },
                body: (0, _requestmeta.getRequestMeta)(params.req, 'clonableBody'),
                signal: (0, _nextrequest.signalFromNodeResponse)(params.res.originalResponse),
                waitUntil: this.getWaitUntil()
            },
            useCache: true,
            onError: params.onError,
            onWarning: params.onWarning,
            incrementalCache: globalThis.__incrementalCache || (0, _requestmeta.getRequestMeta)(params.req, 'incrementalCache'),
            serverComponentsHmrCache: (0, _requestmeta.getRequestMeta)(params.req, 'serverComponentsHmrCache'),
            clientAssetToken: this.nextConfig.experimental.immutableAssetToken || this.deploymentId
        });
        if (result.fetchMetrics) {
            params.req.fetchMetrics = result.fetchMetrics;
        }
        if (!params.res.statusCode || params.res.statusCode < 400) {
            params.res.statusCode = result.response.status;
            params.res.statusMessage = result.response.statusText;
        }
        // TODO: (wyattjoh) investigate improving this
        result.response.headers.forEach((value, key)=>{
            // The append handling is special cased for `set-cookie`.
            if (key.toLowerCase() === 'set-cookie') {
                // TODO: (wyattjoh) replace with native response iteration when we can upgrade undici
                for (const cookie of (0, _utils1.splitCookiesString)(value)){
                    params.res.appendHeader(key, cookie);
                }
            } else {
                params.res.appendHeader(key, value);
            }
        });
        const { originalResponse } = params.res;
        if (result.response.body) {
            await (0, _pipereadable.pipeToNodeResponse)(result.response.body, originalResponse);
        } else {
            originalResponse.end();
        }
        return result;
    }
    get serverDistDir() {
        if (this._serverDistDir) {
            return this._serverDistDir;
        }
        const serverDistDir = (0, _path.join)(/* turbopackIgnore: true */ this.distDir, _constants.SERVER_DIRECTORY);
        this._serverDistDir = serverDistDir;
        return serverDistDir;
    }
    async getFallbackErrorComponents(_url) {
        // Not implemented for production use cases, this is implemented on the
        // development server.
        return null;
    }
    async instrumentationOnRequestError(...args) {
        await super.instrumentationOnRequestError(...args);
        // For Node.js runtime production logs, in dev it will be overridden by next-dev-server
        if (!this.dev) {
            const [err, , , silenceLog] = args;
            if (!silenceLog) {
                this.logError(err);
            }
        }
    }
    onServerClose(listener) {
        this.cleanupListeners.add(listener);
    }
    async close() {
        await this.cleanupListeners.runAll();
    }
    getInternalWaitUntil() {
        this.internalWaitUntil ??= this.createInternalWaitUntil();
        return this.internalWaitUntil;
    }
    createInternalWaitUntil() {
        if (this.minimalMode) {
            throw Object.defineProperty(new _invarianterror.InvariantError('createInternalWaitUntil should never be called in minimal mode'), "__NEXT_ERROR_CODE", {
                value: "E540",
                enumerable: false,
                configurable: true
            });
        }
        const awaiter = new _awaiter.AwaiterOnce({
            onError: console.error
        });
        // TODO(after): warn if the process exits before these are awaited
        this.onServerClose(()=>awaiter.awaiting());
        return awaiter.waitUntil;
    }
}

//# sourceMappingURL=next-server.js.map