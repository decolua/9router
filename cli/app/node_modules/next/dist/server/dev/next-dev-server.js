"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return DevServer;
    }
});
const _requestmeta = require("../request-meta");
const _react = /*#__PURE__*/ _interop_require_wildcard(require("react"));
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _jestworker = require("next/dist/compiled/jest-worker");
const _path = require("path");
const _constants = require("../../lib/constants");
const _findpagesdir = require("../../lib/find-pages-dir");
const _constants1 = require("../../shared/lib/constants");
const _nextserver = /*#__PURE__*/ _interop_require_wildcard(require("../next-server"));
const _normalizepagepath = require("../../shared/lib/page-path/normalize-page-path");
const _pathhasprefix = require("../../shared/lib/router/utils/path-has-prefix");
const _removepathprefix = require("../../shared/lib/router/utils/remove-path-prefix");
const _storage = require("../../telemetry/storage");
const _trace = require("../../trace");
const _shared = require("../../trace/shared");
const _findpagefile = require("../lib/find-page-file");
const _utils = require("../lib/utils");
const _coalescedfunction = require("../../lib/coalesced-function");
const _loaddefaulterrorcomponents = require("../load-default-error-components");
const _utils1 = require("../../shared/lib/utils");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../../build/output/log"));
const _iserror = /*#__PURE__*/ _interop_require_wildcard(require("../../lib/is-error"));
const _configshared = require("../config-shared");
const _utils2 = require("../../build/utils");
const _formatservererror = require("../../lib/format-server-error");
const _devroutematchermanager = require("../route-matcher-managers/dev-route-matcher-manager");
const _devpagesroutematcherprovider = require("../route-matcher-providers/dev/dev-pages-route-matcher-provider");
const _devpagesapiroutematcherprovider = require("../route-matcher-providers/dev/dev-pages-api-route-matcher-provider");
const _devapppageroutematcherprovider = require("../route-matcher-providers/dev/dev-app-page-route-matcher-provider");
const _devapprouteroutematcherprovider = require("../route-matcher-providers/dev/dev-app-route-route-matcher-provider");
const _nodemanifestloader = require("../route-matcher-providers/helpers/manifest-loaders/node-manifest-loader");
const _batchedfilereader = require("../route-matcher-providers/dev/helpers/file-reader/batched-file-reader");
const _defaultfilereader = require("../route-matcher-providers/dev/helpers/file-reader/default-file-reader");
const _lrucache = require("../lib/lru-cache");
const _middlewareroutematcher = require("../../shared/lib/router/utils/middleware-route-matcher");
const _detachedpromise = require("../../lib/detached-promise");
const _ispostpone = require("../lib/router-utils/is-postpone");
const _generateinterceptionroutesrewrites = require("../../lib/generate-interception-routes-rewrites");
const _buildcustomroute = require("../../lib/build-custom-route");
const _errorsource = require("../../shared/lib/error-source");
const _logrequests = require("./log-requests");
const _fallback = require("../../lib/fallback");
const _instrumentationglobalsexternal = require("../lib/router-utils/instrumentation-globals.external");
const _routeregex = require("../../shared/lib/router/utils/route-regex");
const _hotreloadertypes = require("./hot-reloader-types");
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
// Load ReactDevOverlay only when needed
let PagesDevOverlayBridgeImpl;
const ReactDevOverlay = (props)=>{
    if (PagesDevOverlayBridgeImpl === undefined) {
        PagesDevOverlayBridgeImpl = require('../../next-devtools/userspace/pages/pages-dev-overlay-setup').PagesDevOverlayBridge;
    }
    return _react.createElement(PagesDevOverlayBridgeImpl, props);
};
class DevServer extends _nextserver.default {
    getStaticPathsWorker() {
        const worker = new _jestworker.Worker(require.resolve('./static-paths-worker'), {
            maxRetries: 1,
            // For dev server, it's not necessary to spin up too many workers as long as you are not doing a load test.
            // This helps reusing the memory a lot.
            numWorkers: 1,
            enableWorkerThreads: this.nextConfig.experimental.workerThreads,
            forkOptions: {
                env: {
                    ...process.env,
                    // discard --inspect/--inspect-brk flags from process.env.NODE_OPTIONS. Otherwise multiple Node.js debuggers
                    // would be started if user launch Next.js in debugging mode. The number of debuggers is linked to
                    // the number of workers Next.js tries to launch. The only worker users are interested in debugging
                    // is the main Next.js one
                    NODE_OPTIONS: (0, _utils.getFormattedNodeOptionsWithoutInspect)()
                }
            }
        });
        worker.getStdout().pipe(process.stdout);
        worker.getStderr().pipe(process.stderr);
        return worker;
    }
    constructor(options){
        try {
            // Increase the number of stack frames on the server
            Error.stackTraceLimit = 50;
        } catch  {}
        super({
            ...options,
            dev: true
        }), /**
   * The promise that resolves when the server is ready. When this is unset
   * the server is ready.
   */ this.ready = new _detachedpromise.DetachedPromise();
        this.nextConfig = options.conf;
        this.bundlerService = options.bundlerService;
        this.startServerSpan = options.startServerSpan ?? (0, _trace.trace)('start-next-dev-server');
        this.renderOpts.ErrorDebug = ReactDevOverlay;
        this.staticPathsCache = new _lrucache.LRUCache(// 5MB
        5 * 1024 * 1024, function length(value) {
            var _JSON_stringify;
            // Ensure minimum size of 1 for LRU eviction to work correctly
            return ((_JSON_stringify = JSON.stringify(value.staticPaths)) == null ? void 0 : _JSON_stringify.length) || 1;
        });
        const { pagesDir, appDir } = (0, _findpagesdir.findPagesDir)(this.dir);
        this.pagesDir = pagesDir;
        this.appDir = appDir;
        if (this.nextConfig.experimental.serverComponentsHmrCache) {
            // Ensure HMR cache has a minimum size equal to the default cacheMaxMemorySize,
            // but allow it to grow if the user has configured a larger value.
            const hmrCacheSize = Math.max(this.nextConfig.cacheMaxMemorySize, _configshared.defaultConfig.cacheMaxMemorySize);
            this.serverComponentsHmrCache = new _lrucache.LRUCache(hmrCacheSize, function length(value) {
                return JSON.stringify(value).length;
            });
        }
    }
    getServerComponentsHmrCache() {
        return this.serverComponentsHmrCache;
    }
    getRouteMatchers() {
        const { pagesDir, appDir } = (0, _findpagesdir.findPagesDir)(this.dir);
        const ensurer = {
            ensure: async (match, pathname)=>{
                await this.ensurePage({
                    definition: match.definition,
                    page: match.definition.page,
                    clientOnly: false,
                    url: pathname
                });
            }
        };
        const matchers = new _devroutematchermanager.DevRouteMatcherManager(super.getRouteMatchers(), ensurer, this.dir);
        const extensions = this.nextConfig.pageExtensions;
        const extensionsExpression = new RegExp(`\\.(?:${extensions.join('|')})$`);
        // If the pages directory is available, then configure those matchers.
        if (pagesDir) {
            const fileReader = new _batchedfilereader.BatchedFileReader(new _defaultfilereader.DefaultFileReader({
                // Only allow files that have the correct extensions.
                pathnameFilter: (pathname)=>extensionsExpression.test(pathname)
            }));
            matchers.push(new _devpagesroutematcherprovider.DevPagesRouteMatcherProvider(pagesDir, extensions, fileReader, this.localeNormalizer));
            matchers.push(new _devpagesapiroutematcherprovider.DevPagesAPIRouteMatcherProvider(pagesDir, extensions, fileReader, this.localeNormalizer));
        }
        if (appDir) {
            // We create a new file reader for the app directory because we don't want
            // to include any folders or files starting with an underscore. This will
            // prevent the reader from wasting time reading files that we know we
            // don't care about.
            const fileReader = new _batchedfilereader.BatchedFileReader(new _defaultfilereader.DefaultFileReader({
                // Ignore any directory prefixed with an underscore.
                ignorePartFilter: (part)=>part.startsWith('_')
            }));
            // TODO: Improve passing of "is running with Turbopack"
            const isTurbopack = !!process.env.TURBOPACK;
            matchers.push(new _devapppageroutematcherprovider.DevAppPageRouteMatcherProvider(appDir, extensions, fileReader, isTurbopack));
            matchers.push(new _devapprouteroutematcherprovider.DevAppRouteRouteMatcherProvider(appDir, extensions, fileReader, isTurbopack));
        }
        return matchers;
    }
    getBuildId() {
        return 'development';
    }
    async prepareImpl() {
        var _this_ready;
        (0, _trace.setGlobal)('distDir', this.distDir);
        (0, _trace.setGlobal)('phase', _constants1.PHASE_DEVELOPMENT_SERVER);
        // Use existing telemetry instance from traceGlobals instead of creating a new one.
        // Creating a new instance would overwrite the existing one, causing any telemetry
        // events recorded to the original instance to be lost during cleanup/flush.
        const existingTelemetry = _shared.traceGlobals.get('telemetry');
        const telemetry = existingTelemetry || new _storage.Telemetry({
            distDir: this.distDir
        });
        await super.prepareImpl();
        await this.matchers.reload();
        (_this_ready = this.ready) == null ? void 0 : _this_ready.resolve();
        this.ready = undefined;
        // In dev, this needs to be called after prepare because the build entries won't be known in the constructor
        this.interceptionRoutePatterns = this.getinterceptionRoutePatterns();
        // This is required by the tracing subsystem.
        (0, _trace.setGlobal)('appDir', this.appDir);
        (0, _trace.setGlobal)('pagesDir', this.pagesDir);
        // Only set telemetry if it wasn't already set
        if (!existingTelemetry) {
            (0, _trace.setGlobal)('telemetry', telemetry);
        }
        process.on('unhandledRejection', (reason)=>{
            if ((0, _ispostpone.isPostpone)(reason)) {
                // React postpones that are unhandled might end up logged here but they're
                // not really errors. They're just part of rendering.
                return;
            }
            this.logErrorWithOriginalStack(reason, 'unhandledRejection');
        });
        process.on('uncaughtException', (err)=>{
            this.logErrorWithOriginalStack(err, 'uncaughtException');
        });
    }
    async hasPage(pathname) {
        let normalizedPath;
        try {
            normalizedPath = (0, _normalizepagepath.normalizePagePath)(pathname);
        } catch (err) {
            console.error(err);
            // if normalizing the page fails it means it isn't valid
            // so it doesn't exist so don't throw and return false
            // to ensure we return 404 instead of 500
            return false;
        }
        if ((0, _utils2.isMiddlewareFile)(normalizedPath)) {
            return (0, _findpagefile.findPageFile)(this.dir, normalizedPath, this.nextConfig.pageExtensions, false).then(Boolean);
        }
        let appFile = null;
        let pagesFile = null;
        if (this.appDir) {
            appFile = await (0, _findpagefile.findPageFile)(this.appDir, normalizedPath + '/page', this.nextConfig.pageExtensions, true);
        }
        if (this.pagesDir) {
            pagesFile = await (0, _findpagefile.findPageFile)(this.pagesDir, normalizedPath, this.nextConfig.pageExtensions, false);
        }
        if (appFile && pagesFile) {
            return false;
        }
        return Boolean(appFile || pagesFile);
    }
    async runMiddleware(params) {
        try {
            const result = await super.runMiddleware({
                ...params,
                onWarning: (warn)=>{
                    this.logErrorWithOriginalStack(warn, 'warning');
                }
            });
            if ('finished' in result) {
                return result;
            }
            result.waitUntil.catch((error)=>{
                this.logErrorWithOriginalStack(error, 'unhandledRejection');
            });
            return result;
        } catch (error) {
            if (error instanceof _utils1.DecodeError) {
                throw error;
            }
            /**
       * We only log the error when it is not a MiddlewareNotFound error as
       * in that case we should be already displaying a compilation error
       * which is what makes the module not found.
       */ if (!(error instanceof _utils1.MiddlewareNotFoundError)) {
                this.logErrorWithOriginalStack(error);
            }
            const err = (0, _iserror.getProperError)(error);
            (0, _errorsource.decorateServerError)(err, _constants1.COMPILER_NAMES.edgeServer);
            const { request, response, parsedUrl } = params;
            /**
       * When there is a failure for an internal Next.js request from
       * middleware we bypass the error without finishing the request
       * so we can serve the required chunks to render the error.
       */ if (request.url.includes('/_next/static') || request.url.includes('/__nextjs_attach-nodejs-inspector') || request.url.includes('/__nextjs_original-stack-frame') || request.url.includes('/__nextjs_source-map') || request.url.includes('/__nextjs_error_feedback')) {
                return {
                    finished: false
                };
            }
            response.statusCode = 500;
            await this.renderError(err, request, response, parsedUrl.pathname);
            return {
                finished: true
            };
        }
    }
    async runEdgeFunction(params) {
        try {
            return super.runEdgeFunction({
                ...params,
                onError: (err)=>this.logErrorWithOriginalStack(err, 'app-dir'),
                onWarning: (warn)=>{
                    this.logErrorWithOriginalStack(warn, 'warning');
                }
            });
        } catch (error) {
            if (error instanceof _utils1.DecodeError) {
                throw error;
            }
            this.logErrorWithOriginalStack(error, 'warning');
            const err = (0, _iserror.getProperError)(error);
            const { req, res, page } = params;
            res.statusCode = 500;
            await this.renderError(err, req, res, page);
            return null;
        }
    }
    getRequestHandler() {
        const handler = super.getRequestHandler();
        return (req, res, parsedUrl)=>{
            const request = this.normalizeReq(req);
            const response = this.normalizeRes(res);
            const loggingConfig = this.nextConfig.logging;
            if (loggingConfig !== false) {
                // The closure variable is not used here because the request handler may be invoked twice for one request when middleware is added in the application.
                // By setting the start time we can ensure that the middleware timing is correctly included.
                if (!(0, _requestmeta.getRequestMeta)(req, 'devRequestTimingStart')) {
                    const requestStart = process.hrtime.bigint();
                    (0, _requestmeta.addRequestMeta)(req, 'devRequestTimingStart', requestStart);
                }
                const isMiddlewareRequest = (0, _requestmeta.getRequestMeta)(req, 'middlewareInvoke') ?? false;
                if (!isMiddlewareRequest) {
                    response.originalResponse.once('close', ()=>{
                        // NOTE: The route match is only attached to the request's meta data
                        // after the request handler is created, so we need to check it in the
                        // close handler and not before.
                        const routeMatch = (0, _requestmeta.getRequestMeta)(req).match;
                        if (!routeMatch) {
                            return;
                        }
                        // The closure variable is not used here because the request handler may be invoked twice for one request when middleware is added in the application.
                        // By setting the start time we can ensure that the middleware timing is correctly included.
                        const requestStart = (0, _requestmeta.getRequestMeta)(req, 'devRequestTimingStart');
                        if (!requestStart) {
                            return;
                        }
                        const requestEnd = process.hrtime.bigint();
                        (0, _logrequests.logRequests)(request, response, loggingConfig, requestStart, requestEnd, (0, _requestmeta.getRequestMeta)(req, 'devRequestTimingMiddlewareStart'), (0, _requestmeta.getRequestMeta)(req, 'devRequestTimingMiddlewareEnd'), (0, _requestmeta.getRequestMeta)(req, 'devRequestTimingInternalsEnd'), (0, _requestmeta.getRequestMeta)(req, 'devGenerateStaticParamsDuration'));
                        // Create trace span for render phase
                        const devRequestTimingInternalsEnd = (0, _requestmeta.getRequestMeta)(req, 'devRequestTimingInternalsEnd');
                        if (devRequestTimingInternalsEnd) {
                            this.startServerSpan.manualTraceChild('render-path', (0, _trace.hrtimeToEpochNanoseconds)(devRequestTimingInternalsEnd), (0, _trace.hrtimeToEpochNanoseconds)(requestEnd), {
                                path: req.url || ''
                            });
                        }
                    });
                }
            }
            return handler(request, response, parsedUrl);
        };
    }
    async handleRequest(req, res, parsedUrl) {
        const span = (0, _trace.trace)('handle-request', undefined, {
            url: req.url
        });
        const result = await span.traceAsyncFn(async ()=>{
            var _this_ready;
            await ((_this_ready = this.ready) == null ? void 0 : _this_ready.promise);
            (0, _requestmeta.addRequestMeta)(req, 'PagesErrorDebug', this.renderOpts.ErrorDebug);
            return await super.handleRequest(req, res, parsedUrl);
        });
        const memoryUsage = process.memoryUsage();
        span.traceChild('memory-usage', {
            url: req.url,
            'memory.rss': String(memoryUsage.rss),
            'memory.heapUsed': String(memoryUsage.heapUsed),
            'memory.heapTotal': String(memoryUsage.heapTotal)
        }).stop();
        return result;
    }
    async run(req, res, parsedUrl) {
        var _this_ready;
        await ((_this_ready = this.ready) == null ? void 0 : _this_ready.promise);
        const { basePath } = this.nextConfig;
        let originalPathname = null;
        // TODO: see if we can remove this in the future
        if (basePath && (0, _pathhasprefix.pathHasPrefix)(parsedUrl.pathname || '/', basePath)) {
            // strip basePath before handling dev bundles
            // If replace ends up replacing the full url it'll be `undefined`, meaning we have to default it to `/`
            originalPathname = parsedUrl.pathname;
            parsedUrl.pathname = (0, _removepathprefix.removePathPrefix)(parsedUrl.pathname || '/', basePath);
        }
        const { pathname } = parsedUrl;
        if (pathname.startsWith('/_next')) {
            if (_fs.default.existsSync((0, _path.join)(this.publicDir, '_next'))) {
                throw Object.defineProperty(new Error(_constants.PUBLIC_DIR_MIDDLEWARE_CONFLICT), "__NEXT_ERROR_CODE", {
                    value: "E394",
                    enumerable: false,
                    configurable: true
                });
            }
        }
        if (originalPathname) {
            // restore the path before continuing so that custom-routes can accurately determine
            // if they should match against the basePath or not
            parsedUrl.pathname = originalPathname;
        }
        try {
            return await super.run(req, res, parsedUrl);
        } catch (error) {
            const err = (0, _iserror.getProperError)(error);
            (0, _formatservererror.formatServerError)(err);
            this.logErrorWithOriginalStack(err);
            if (!res.sent) {
                res.statusCode = 500;
                try {
                    return await this.renderError(err, req, res, pathname, {
                        __NEXT_PAGE: (0, _iserror.default)(err) && err.page || pathname || ''
                    });
                } catch (internalErr) {
                    console.error(internalErr);
                    res.body('Internal Server Error').send();
                }
            }
        }
    }
    logErrorWithOriginalStack(err, type) {
        this.bundlerService.logErrorWithOriginalStack(err, type);
    }
    getPagesManifest() {
        return _nodemanifestloader.NodeManifestLoader.require((0, _path.join)(this.serverDistDir, _constants1.PAGES_MANIFEST)) ?? undefined;
    }
    getAppPathsManifest() {
        if (!this.enabledDirectories.app) return undefined;
        return _nodemanifestloader.NodeManifestLoader.require((0, _path.join)(this.serverDistDir, _constants1.APP_PATHS_MANIFEST)) ?? undefined;
    }
    getinterceptionRoutePatterns() {
        const rewrites = (0, _generateinterceptionroutesrewrites.generateInterceptionRoutesRewrites)(Object.keys(this.appPathRoutes ?? {}), this.nextConfig.basePath).map((route)=>new RegExp((0, _buildcustomroute.buildCustomRoute)('rewrite', route).regex));
        if (this.nextConfig.output === 'export' && rewrites.length > 0) {
            _log.error('Intercepting routes are not supported with static export.\nRead more: https://nextjs.org/docs/app/building-your-application/deploying/static-exports#unsupported-features');
            process.exit(1);
        }
        return rewrites ?? [];
    }
    async getMiddleware() {
        var _this_middleware;
        // We need to populate the match
        // field as it isn't serializable
        if (((_this_middleware = this.middleware) == null ? void 0 : _this_middleware.match) === null) {
            this.middleware.match = (0, _middlewareroutematcher.getMiddlewareRouteMatcher)(this.middleware.matchers || []);
        }
        return this.middleware;
    }
    getNextFontManifest() {
        return undefined;
    }
    async hasMiddleware() {
        return this.hasPage(this.actualMiddlewareFile);
    }
    async ensureMiddleware(url) {
        return this.ensurePage({
            page: this.actualMiddlewareFile,
            clientOnly: false,
            definition: undefined,
            url
        });
    }
    async loadInstrumentationModule() {
        let instrumentationModule;
        if (this.actualInstrumentationHookFile && await this.ensurePage({
            page: this.actualInstrumentationHookFile,
            clientOnly: false,
            definition: undefined
        }).then(()=>true).catch(()=>false)) {
            try {
                instrumentationModule = await (0, _instrumentationglobalsexternal.getInstrumentationModule)(this.dir, this.nextConfig.distDir);
            } catch (err) {
                err.message = `An error occurred while loading instrumentation hook: ${err.message}`;
                throw err;
            }
        }
        return instrumentationModule;
    }
    async runInstrumentationHookIfAvailable() {
        await (0, _instrumentationglobalsexternal.ensureInstrumentationRegistered)(this.dir, this.nextConfig.distDir);
    }
    async ensureEdgeFunction({ page, appPaths, url }) {
        return this.ensurePage({
            page,
            appPaths,
            clientOnly: false,
            definition: undefined,
            url
        });
    }
    generateRoutes(_dev) {
    // In development we expose all compiled files for react-error-overlay's line show feature
    // We use unshift so that we're sure the routes is defined before Next's default routes
    // routes.unshift({
    //   match: getPathMatch('/_next/development/:path*'),
    //   type: 'route',
    //   name: '_next/development catchall',
    //   fn: async (req, res, params) => {
    //     const p = pathJoin(this.distDir, ...(params.path || []))
    //     await this.serveStatic(req, res, p)
    //     return {
    //       finished: true,
    //     }
    //   },
    // })
    }
    async getStaticPaths({ pathname, urlPathname, requestHeaders, page, isAppPath }) {
        // we lazy load the staticPaths to prevent the user
        // from waiting on them for the page to load in dev mode
        const __getStaticPaths = async ()=>{
            const { configFileName, httpAgentOptions } = this.nextConfig;
            const { locales, defaultLocale } = this.nextConfig.i18n || {};
            const staticPathsWorker = this.getStaticPathsWorker();
            try {
                var _this_nextConfig_experimental_sri;
                const pathsResult = await staticPathsWorker.loadStaticPaths({
                    dir: this.dir,
                    distDir: this.distDir,
                    pathname,
                    config: {
                        pprConfig: this.nextConfig.experimental.ppr,
                        partialFallbacks: this.nextConfig.experimental.partialFallbacks === true,
                        configFileName,
                        cacheComponents: Boolean(this.nextConfig.cacheComponents)
                    },
                    httpAgentOptions,
                    locales,
                    defaultLocale,
                    page,
                    isAppPath,
                    requestHeaders,
                    cacheHandler: this.nextConfig.cacheHandler,
                    cacheHandlers: this.nextConfig.cacheHandlers,
                    cacheLifeProfiles: this.nextConfig.cacheLife,
                    fetchCacheKeyPrefix: this.nextConfig.experimental.fetchCacheKeyPrefix,
                    isrFlushToDisk: this.nextConfig.experimental.isrFlushToDisk,
                    cacheMaxMemorySize: this.nextConfig.cacheMaxMemorySize,
                    nextConfigOutput: this.nextConfig.output,
                    buildId: this.buildId,
                    authInterrupts: Boolean(this.nextConfig.experimental.authInterrupts),
                    sriEnabled: Boolean((_this_nextConfig_experimental_sri = this.nextConfig.experimental.sri) == null ? void 0 : _this_nextConfig_experimental_sri.algorithm)
                });
                return pathsResult;
            } finally{
                // we don't re-use workers so destroy the used one
                staticPathsWorker.end();
            }
        };
        const result = this.staticPathsCache.get(pathname);
        const nextInvoke = (0, _coalescedfunction.withCoalescedInvoke)(__getStaticPaths)(`staticPaths-${pathname}`, []).then(async (res)=>{
            var _res_value;
            const { prerenderedRoutes, fallbackMode: fallback } = res.value;
            if (isAppPath) {
                var // Ideally, we would want to compare the whole objects, but that is too expensive.
                _result_prerenderedRoutes;
                if (this.nextConfig.output === 'export') {
                    if (!prerenderedRoutes) {
                        throw Object.defineProperty(new Error(`Page "${page}" is missing exported function "generateStaticParams()", which is required with "output: export" config.`), "__NEXT_ERROR_CODE", {
                            value: "E353",
                            enumerable: false,
                            configurable: true
                        });
                    }
                    if (!prerenderedRoutes.some((item)=>item.pathname === urlPathname)) {
                        throw Object.defineProperty(new Error(`Page "${page}" is missing param "${pathname}" in "generateStaticParams()", which is required with "output: export" config.`), "__NEXT_ERROR_CODE", {
                            value: "E443",
                            enumerable: false,
                            configurable: true
                        });
                    }
                }
                // Since generateStaticParams run on the background, when accessing the
                // fallbackParams during the render, it is still set to the previous
                // result from the cache. Therefore when the result has changed, re-render
                // the Server Component to sync the fallbackParams with the new result.
                if (isAppPath && this.nextConfig.cacheComponents && // Ensure this is not the first invocation.
                result && ((_result_prerenderedRoutes = result.prerenderedRoutes) == null ? void 0 : _result_prerenderedRoutes.length) !== (prerenderedRoutes == null ? void 0 : prerenderedRoutes.length)) {
                    this.bundlerService.sendHmrMessage({
                        type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SERVER_COMPONENT_CHANGES,
                        hash: `generateStaticParams-${Date.now()}`
                    });
                }
            }
            if (!isAppPath && this.nextConfig.output === 'export') {
                if (fallback === _fallback.FallbackMode.BLOCKING_STATIC_RENDER) {
                    throw Object.defineProperty(new Error('getStaticPaths with "fallback: blocking" cannot be used with "output: export". See more info here: https://nextjs.org/docs/advanced-features/static-html-export'), "__NEXT_ERROR_CODE", {
                        value: "E11",
                        enumerable: false,
                        configurable: true
                    });
                } else if (fallback === _fallback.FallbackMode.PRERENDER) {
                    throw Object.defineProperty(new Error('getStaticPaths with "fallback: true" cannot be used with "output: export". See more info here: https://nextjs.org/docs/advanced-features/static-html-export'), "__NEXT_ERROR_CODE", {
                        value: "E210",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
            const value = {
                staticPaths: prerenderedRoutes == null ? void 0 : prerenderedRoutes.map((route)=>route.pathname),
                prerenderedRoutes,
                fallbackMode: fallback
            };
            if (((_res_value = res.value) == null ? void 0 : _res_value.fallbackMode) !== undefined && // This matches the hasGenerateStaticParams logic we do during build.
            (!isAppPath || prerenderedRoutes && prerenderedRoutes.length > 0)) {
                // we write the static paths to partial manifest for
                // fallback handling inside of entry handler's
                const rawExistingManifest = await _fs.default.promises.readFile((0, _path.join)(this.distDir, _constants1.PRERENDER_MANIFEST), 'utf8');
                const existingManifest = JSON.parse(rawExistingManifest);
                for (const staticPath of value.staticPaths || []){
                    existingManifest.routes[staticPath] = {};
                }
                // Find the fallback route from the prerendered routes. This is
                // the route whose pathname matches the page pattern (e.g.
                // /dynamic-params/[slug]) and has fallback route params describing
                // which params are unknown at build time.
                const fallbackPrerenderedRoute = prerenderedRoutes == null ? void 0 : prerenderedRoutes.find((route)=>route.pathname === pathname);
                existingManifest.dynamicRoutes[pathname] = {
                    dataRoute: null,
                    dataRouteRegex: null,
                    fallback: (0, _fallback.fallbackModeToFallbackField)(res.value.fallbackMode, page),
                    fallbackRevalidate: false,
                    fallbackExpire: undefined,
                    fallbackHeaders: undefined,
                    fallbackStatus: undefined,
                    fallbackRootParams: fallbackPrerenderedRoute == null ? void 0 : fallbackPrerenderedRoute.fallbackRootParams,
                    fallbackRouteParams: fallbackPrerenderedRoute == null ? void 0 : fallbackPrerenderedRoute.fallbackRouteParams,
                    fallbackSourceRoute: pathname,
                    prefetchDataRoute: undefined,
                    prefetchDataRouteRegex: undefined,
                    routeRegex: (0, _routeregex.getRouteRegex)(pathname).re.source,
                    experimentalPPR: undefined,
                    renderingMode: undefined,
                    allowHeader: []
                };
                const updatedManifest = JSON.stringify(existingManifest);
                if (updatedManifest !== rawExistingManifest) {
                    await _fs.default.promises.writeFile((0, _path.join)(this.distDir, _constants1.PRERENDER_MANIFEST), updatedManifest);
                }
            }
            this.staticPathsCache.set(pathname, value);
            return value;
        }).catch((err)=>{
            this.staticPathsCache.remove(pathname);
            if (!result) throw err;
            _log.error(`Failed to generate static paths for ${pathname}:`);
            console.error(err);
        });
        if (result) {
            return result;
        }
        return nextInvoke;
    }
    async ensurePage(opts) {
        await this.bundlerService.ensurePage(opts);
    }
    async findPageComponents({ locale, page, query, params, isAppPath, appPaths = null, shouldEnsure, url }) {
        var _this_ready;
        await ((_this_ready = this.ready) == null ? void 0 : _this_ready.promise);
        const compilationErr = await this.getCompilationError(page);
        if (compilationErr) {
            // Wrap build errors so that they don't get logged again
            throw new _nextserver.WrappedBuildError(compilationErr);
        }
        if (shouldEnsure || this.serverOptions.customServer) {
            await this.ensurePage({
                page,
                appPaths,
                clientOnly: false,
                definition: undefined,
                url
            });
        }
        this.nextFontManifest = super.getNextFontManifest();
        return await super.findPageComponents({
            page,
            query,
            params,
            locale,
            isAppPath,
            shouldEnsure,
            url
        });
    }
    async getFallbackErrorComponents(url) {
        await this.bundlerService.getFallbackErrorComponents(url);
        return await (0, _loaddefaulterrorcomponents.loadDefaultErrorComponents)(this.distDir);
    }
    async getCompilationError(page) {
        return await this.bundlerService.getCompilationError(page);
    }
    async instrumentationOnRequestError(...args) {
        await super.instrumentationOnRequestError(...args);
        const [err, , , silenceLog] = args;
        if (!silenceLog) {
            this.logErrorWithOriginalStack(err, 'app-dir');
        }
    }
}

//# sourceMappingURL=next-dev-server.js.map