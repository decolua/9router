"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    WrappedBuildError: null,
    default: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    WrappedBuildError: function() {
        return WrappedBuildError;
    },
    default: function() {
        return Server;
    }
});
const _configshared = require("./config-shared");
const _utils = require("../shared/lib/utils");
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _url = require("url");
const _formathostname = require("./lib/format-hostname");
const _constants = require("../shared/lib/constants");
const _utils1 = require("../shared/lib/router/utils");
const _utils2 = require("./utils");
const _isbot = require("../shared/lib/router/utils/is-bot");
const _renderresult = /*#__PURE__*/ _interop_require_default(require("./render-result"));
const _removetrailingslash = require("../shared/lib/router/utils/remove-trailing-slash");
const _denormalizepagepath = require("../shared/lib/page-path/denormalize-page-path");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
const _serverutils = require("./server-utils");
const _iserror = /*#__PURE__*/ _interop_require_wildcard(require("../lib/is-error"));
const _requestmeta = require("./request-meta");
const _removepathprefix = require("../shared/lib/router/utils/remove-path-prefix");
const _apppaths = require("../shared/lib/router/utils/app-paths");
const _gethostname = require("../shared/lib/get-hostname");
const _parseurl = require("../shared/lib/router/utils/parse-url");
const _getnextpathnameinfo = require("../shared/lib/router/utils/get-next-pathname-info");
const _approuterheaders = require("../client/components/app-router-headers");
const _localeroutenormalizer = require("./normalizers/locale-route-normalizer");
const _defaultroutematchermanager = require("./route-matcher-managers/default-route-matcher-manager");
const _apppageroutematcherprovider = require("./route-matcher-providers/app-page-route-matcher-provider");
const _approuteroutematcherprovider = require("./route-matcher-providers/app-route-route-matcher-provider");
const _pagesapiroutematcherprovider = require("./route-matcher-providers/pages-api-route-matcher-provider");
const _pagesroutematcherprovider = require("./route-matcher-providers/pages-route-matcher-provider");
const _servermanifestloader = require("./route-matcher-providers/helpers/manifest-loaders/server-manifest-loader");
const _tracer = require("./lib/trace/tracer");
const _constants1 = require("./lib/trace/constants");
const _i18nprovider = require("./lib/i18n-provider");
const _sendresponse = require("./send-response");
const _utils3 = require("./web/utils");
const _constants2 = require("../lib/constants");
const _normalizelocalepath = require("../shared/lib/i18n/normalize-locale-path");
const _matchnextdatapathname = require("./lib/match-next-data-pathname");
const _getroutefromassetpath = /*#__PURE__*/ _interop_require_default(require("../shared/lib/router/utils/get-route-from-asset-path"));
const _rsc = require("./normalizers/request/rsc");
const _stripflightheaders = require("./app-render/strip-flight-headers");
const _checks = require("./route-modules/checks");
const _nextdata = require("./normalizers/request/next-data");
const _serveractionrequestmeta = require("./lib/server-action-request-meta");
const _interceptionroutes = require("../shared/lib/router/utils/interception-routes");
const _toroute = require("./lib/to-route");
const _helpers = require("./base-http/helpers");
const _patchsetheader = require("./lib/patch-set-header");
const _ppr = require("./lib/experimental/ppr");
const _builtinrequestcontext = require("./after/builtin-request-context");
const _adapter = require("./web/adapter");
const _fallback = require("../lib/fallback");
const _segmentprefixrsc = require("./normalizers/request/segment-prefix-rsc");
const _streamingmetadata = require("./lib/streaming-metadata");
const _decodequerypathparameter = require("./lib/decode-query-path-parameter");
const _nofallbackerrorexternal = require("../shared/lib/no-fallback-error.external");
const _fixmojibake = require("./lib/fix-mojibake");
const _cachebustingsearchparam = require("../shared/lib/router/utils/cache-busting-search-param");
const _setcachebustingsearchparam = require("../client/components/router-reducer/set-cache-busting-search-param");
const _fallbackparams = require("./request/fallback-params");
const _routekind = require("./route-kind");
const _postponedrequestbody = require("./lib/postponed-request-body");
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
class WrappedBuildError extends Error {
    constructor(innerError){
        super();
        this.innerError = innerError;
    }
}
class Server {
    getServerComponentsHmrCache() {
        return this.nextConfig.experimental.serverComponentsHmrCache ? globalThis.__serverComponentsHmrCache : undefined;
    }
    /**
   * This is used to persist cache scopes across
   * prefetch -> full route requests for cache components
   * it's only fully used in dev
   */ constructor(options){
        var _this_nextConfig_i18n, _this_nextConfig_i18n1;
        this.handleRSCRequest = (req, _res, parsedUrl)=>{
            var _this_normalizers_segmentPrefetchRSC, _this_normalizers_rsc;
            if (!parsedUrl.pathname) return false;
            if ((_this_normalizers_segmentPrefetchRSC = this.normalizers.segmentPrefetchRSC) == null ? void 0 : _this_normalizers_segmentPrefetchRSC.match(parsedUrl.pathname)) {
                const result = this.normalizers.segmentPrefetchRSC.extract(parsedUrl.pathname);
                if (!result) return false;
                const { originalPathname, segmentPath } = result;
                parsedUrl.pathname = originalPathname;
                // Mark the request as a router prefetch request.
                req.headers[_approuterheaders.RSC_HEADER] = '1';
                req.headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER] = '1';
                req.headers[_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER] = segmentPath;
                (0, _requestmeta.addRequestMeta)(req, 'isRSCRequest', true);
                (0, _requestmeta.addRequestMeta)(req, 'isPrefetchRSCRequest', true);
                (0, _requestmeta.addRequestMeta)(req, 'segmentPrefetchRSCRequest', segmentPath);
            } else if ((_this_normalizers_rsc = this.normalizers.rsc) == null ? void 0 : _this_normalizers_rsc.match(parsedUrl.pathname)) {
                parsedUrl.pathname = this.normalizers.rsc.normalize(parsedUrl.pathname, true);
                // Mark the request as a RSC request.
                req.headers[_approuterheaders.RSC_HEADER] = '1';
                (0, _requestmeta.addRequestMeta)(req, 'isRSCRequest', true);
            } else if (req.headers['x-now-route-matches']) {
                // If we didn't match, return with the flight headers stripped. If in
                // minimal mode we didn't match based on the path, this can't be a RSC
                // request. This is because Vercel only sends this header during
                // revalidation requests and we want the cache to instead depend on the
                // request path for flight information.
                (0, _stripflightheaders.stripFlightHeaders)(req.headers);
                return false;
            } else if (req.headers[_approuterheaders.RSC_HEADER] === '1') {
                (0, _requestmeta.addRequestMeta)(req, 'isRSCRequest', true);
                if (req.headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER] === '1') {
                    (0, _requestmeta.addRequestMeta)(req, 'isPrefetchRSCRequest', true);
                    const segmentPrefetchRSCRequest = req.headers[_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER];
                    if (typeof segmentPrefetchRSCRequest === 'string') {
                        (0, _requestmeta.addRequestMeta)(req, 'segmentPrefetchRSCRequest', segmentPrefetchRSCRequest);
                    }
                }
            } else {
                // Otherwise just return without doing anything.
                return false;
            }
            if (req.url) {
                const parsed = (0, _parseurl.parseUrl)(req.url);
                parsed.pathname = parsedUrl.pathname;
                req.url = (0, _url.format)(parsed);
            }
            return false;
        };
        this.handleNextDataRequest = async (req, res, parsedUrl)=>{
            const middleware = await this.getMiddleware();
            const params = (0, _matchnextdatapathname.matchNextDataPathname)(parsedUrl.pathname);
            // ignore for non-next data URLs
            if (!params || !params.path) {
                return false;
            }
            if (params.path[0] !== this.buildId) {
                // Ignore if its a middleware request when we aren't on edge.
                if ((0, _requestmeta.getRequestMeta)(req, 'middlewareInvoke')) {
                    return false;
                }
                // Make sure to 404 if the buildId isn't correct
                await this.render404(req, res, parsedUrl);
                return true;
            }
            // remove buildId from URL
            params.path.shift();
            const lastParam = params.path[params.path.length - 1];
            // show 404 if it doesn't end with .json
            if (typeof lastParam !== 'string' || !lastParam.endsWith('.json')) {
                await this.render404(req, res, parsedUrl);
                return true;
            }
            // re-create page's pathname
            let pathname = `/${params.path.join('/')}`;
            pathname = (0, _getroutefromassetpath.default)(pathname, '.json');
            // ensure trailing slash is normalized per config
            if (middleware) {
                if (this.nextConfig.trailingSlash && !pathname.endsWith('/')) {
                    pathname += '/';
                }
                if (!this.nextConfig.trailingSlash && pathname.length > 1 && pathname.endsWith('/')) {
                    pathname = pathname.substring(0, pathname.length - 1);
                }
            }
            if (this.i18nProvider) {
                var _req_headers_host;
                // Remove the port from the hostname if present.
                const hostname = req == null ? void 0 : (_req_headers_host = req.headers.host) == null ? void 0 : _req_headers_host.split(':', 1)[0].toLowerCase();
                const domainLocale = this.i18nProvider.detectDomainLocale(hostname);
                const defaultLocale = (domainLocale == null ? void 0 : domainLocale.defaultLocale) ?? this.i18nProvider.config.defaultLocale;
                const localePathResult = this.i18nProvider.analyze(pathname);
                // If the locale is detected from the path, we need to remove it
                // from the pathname.
                if (localePathResult.detectedLocale) {
                    pathname = localePathResult.pathname;
                }
                // Update the query with the detected locale and default locale.
                (0, _requestmeta.addRequestMeta)(req, 'locale', localePathResult.detectedLocale);
                (0, _requestmeta.addRequestMeta)(req, 'defaultLocale', defaultLocale);
                // If the locale is not detected from the path, we need to mark that
                // it was not inferred from default.
                if (!localePathResult.detectedLocale) {
                    (0, _requestmeta.removeRequestMeta)(req, 'localeInferredFromDefault');
                }
                // If no locale was detected and we don't have middleware, we need
                // to render a 404 page.
                if (!localePathResult.detectedLocale && !middleware) {
                    (0, _requestmeta.addRequestMeta)(req, 'locale', defaultLocale);
                    await this.render404(req, res, parsedUrl);
                    return true;
                }
            }
            parsedUrl.pathname = pathname;
            (0, _requestmeta.addRequestMeta)(req, 'isNextDataReq', true);
            return false;
        };
        this.handleNextImageRequest = ()=>false;
        this.handleCatchallRenderRequest = ()=>false;
        this.handleCatchallMiddlewareRequest = ()=>false;
        /**
   * Normalizes a pathname without attaching any metadata from any matched
   * normalizer.
   *
   * @param pathname the pathname to normalize
   * @returns the normalized pathname
   */ this.normalize = (pathname)=>{
            const normalizers = [];
            if (this.normalizers.data) {
                normalizers.push(this.normalizers.data);
            }
            // We have to put the segment prefetch normalizer before the RSC normalizer
            // because the RSC normalizer will match the prefetch RSC routes too.
            if (this.normalizers.segmentPrefetchRSC) {
                normalizers.push(this.normalizers.segmentPrefetchRSC);
            }
            if (this.normalizers.rsc) {
                normalizers.push(this.normalizers.rsc);
            }
            for (const normalizer of normalizers){
                if (!normalizer.match(pathname)) continue;
                return normalizer.normalize(pathname, true);
            }
            return pathname;
        };
        this.normalizeAndAttachMetadata = async (req, res, url)=>{
            let finished = await this.handleNextImageRequest(req, res, url);
            if (finished) return true;
            if (this.enabledDirectories.pages) {
                finished = await this.handleNextDataRequest(req, res, url);
                if (finished) return true;
            }
            return false;
        };
        this.prepared = false;
        this.preparedPromise = null;
        this.customErrorNo404Warn = (0, _utils.execOnce)(()=>{
            _log.warn(`You have added a custom /_error page without a custom /404 page. This prevents the 404 page from being auto statically optimized.\nSee here for info: https://nextjs.org/docs/messages/custom-error-no-custom-404`);
        });
        const { dir = '.', quiet = false, conf, dev = false, minimalMode = false, hostname, port, experimentalTestProxy } = options;
        this.dev = dev;
        this.experimentalTestProxy = experimentalTestProxy;
        this.serverOptions = options;
        this.dir = _path.resolve(/* turbopackIgnore: true */ dir);
        this.quiet = quiet;
        this.loadEnvConfig({
            dev,
            forceReload: false
        });
        // TODO: should conf be normalized to prevent missing
        // values from causing issues as this can be user provided
        this.nextConfig = conf;
        if (this.nextConfig.experimental.runtimeServerDeploymentId) {
            if (!process.env.NEXT_DEPLOYMENT_ID) {
                throw Object.defineProperty(new Error('process.env.NEXT_DEPLOYMENT_ID is missing but runtimeServerDeploymentId is enabled'), "__NEXT_ERROR_CODE", {
                    value: "E970",
                    enumerable: false,
                    configurable: true
                });
            }
            this.deploymentId = process.env.NEXT_DEPLOYMENT_ID;
        } else {
            let id = this.nextConfig.experimental.useSkewCookie ? '' : this.nextConfig.deploymentId || '';
            this.deploymentId = id;
            process.env.NEXT_DEPLOYMENT_ID = id;
        }
        ;
        globalThis.NEXT_CLIENT_ASSET_SUFFIX = this.nextConfig.experimental.immutableAssetToken || this.deploymentId ? `?dpl=${this.nextConfig.experimental.immutableAssetToken || this.deploymentId}` : '';
        this.hostname = hostname;
        if (this.hostname) {
            // we format the hostname so that it can be fetched
            this.fetchHostname = (0, _formathostname.formatHostname)(this.hostname);
        }
        this.port = port;
        this.distDir = _path.join(/* turbopackIgnore: true */ this.dir, this.nextConfig.distDir);
        this.publicDir = this.getPublicDir();
        this.hasStaticDir = !minimalMode && this.getHasStaticDir();
        this.i18nProvider = ((_this_nextConfig_i18n = this.nextConfig.i18n) == null ? void 0 : _this_nextConfig_i18n.locales) ? new _i18nprovider.I18NProvider(this.nextConfig.i18n) : undefined;
        // Configure the locale normalizer, it's used for routes inside `pages/`.
        this.localeNormalizer = this.i18nProvider ? new _localeroutenormalizer.LocaleRouteNormalizer(this.i18nProvider) : undefined;
        const { assetPrefix, generateEtags } = this.nextConfig;
        this.buildId = this.getBuildId();
        // this is a hack to avoid Webpack knowing this is equal to this.minimalMode
        // because we replace this.minimalMode to true in production bundles.
        const minimalModeKey = 'minimalMode';
        this[minimalModeKey] = minimalMode || !!process.env.NEXT_PRIVATE_MINIMAL_MODE;
        this.enabledDirectories = this.getEnabledDirectories(dev);
        this.isAppPPREnabled = this.enabledDirectories.app && (0, _ppr.checkIsAppPPREnabled)(this.nextConfig.experimental.ppr);
        this.normalizers = {
            // We should normalize the pathname from the RSC prefix only in minimal
            // mode as otherwise that route is not exposed external to the server as
            // we instead only rely on the headers.
            rsc: this.enabledDirectories.app && this.minimalMode ? new _rsc.RSCPathnameNormalizer() : undefined,
            segmentPrefetchRSC: this.minimalMode ? new _segmentprefixrsc.SegmentPrefixRSCPathnameNormalizer() : undefined,
            data: this.enabledDirectories.pages ? new _nextdata.NextDataPathnameNormalizer(this.buildId) : undefined
        };
        this.nextFontManifest = this.getNextFontManifest();
        this.renderOpts = {
            dir: this.dir,
            supportsDynamicResponse: true,
            trailingSlash: this.nextConfig.trailingSlash,
            poweredByHeader: this.nextConfig.poweredByHeader,
            generateEtags,
            previewProps: this.getPrerenderManifest().preview,
            basePath: this.nextConfig.basePath,
            images: this.nextConfig.images,
            optimizeCss: this.nextConfig.experimental.optimizeCss,
            nextConfigOutput: this.nextConfig.output,
            nextScriptWorkers: this.nextConfig.experimental.nextScriptWorkers,
            disableOptimizedLoading: this.nextConfig.experimental.disableOptimizedLoading,
            domainLocales: (_this_nextConfig_i18n1 = this.nextConfig.i18n) == null ? void 0 : _this_nextConfig_i18n1.domains,
            distDir: this.distDir,
            serverComponents: this.enabledDirectories.app,
            cacheLifeProfiles: this.nextConfig.cacheLife,
            enableTainting: this.nextConfig.experimental.taint,
            crossOrigin: this.nextConfig.crossOrigin ? this.nextConfig.crossOrigin : undefined,
            largePageDataBytes: this.nextConfig.experimental.largePageDataBytes,
            isExperimentalCompile: this.nextConfig.experimental.isExperimentalCompile,
            // `htmlLimitedBots` is passed to server as serialized config in string format
            htmlLimitedBots: this.nextConfig.htmlLimitedBots,
            cacheComponents: this.nextConfig.cacheComponents ?? false,
            experimental: {
                expireTime: this.nextConfig.expireTime,
                staleTimes: this.nextConfig.experimental.staleTimes,
                clientTraceMetadata: this.nextConfig.experimental.clientTraceMetadata,
                clientParamParsingOrigins: this.nextConfig.experimental.clientParamParsingOrigins,
                dynamicOnHover: this.nextConfig.experimental.dynamicOnHover ?? false,
                optimisticRouting: this.nextConfig.experimental.optimisticRouting ?? false,
                inlineCss: this.nextConfig.experimental.inlineCss ?? false,
                prefetchInlining: this.nextConfig.experimental.prefetchInlining ?? false,
                authInterrupts: !!this.nextConfig.experimental.authInterrupts,
                cachedNavigations: this.nextConfig.experimental.cachedNavigations ?? false,
                maxPostponedStateSizeBytes: (0, _configshared.parseMaxPostponedStateSize)(this.nextConfig.experimental.maxPostponedStateSize)
            },
            onInstrumentationRequestError: this.instrumentationOnRequestError.bind(this),
            prefetchHints: {},
            reactMaxHeadersLength: this.nextConfig.reactMaxHeadersLength,
            logServerFunctions: typeof this.nextConfig.logging === 'object' && Boolean(this.nextConfig.logging.serverFunctions)
        };
        this.pagesManifest = this.getPagesManifest();
        this.appPathsManifest = this.getAppPathsManifest();
        this.appPathRoutes = this.getAppPathRoutes();
        this.interceptionRoutePatterns = this.getinterceptionRoutePatterns();
        // Configure the routes.
        this.matchers = this.getRouteMatchers();
        // Start route compilation. We don't wait for the routes to finish loading
        // because we use the `waitTillReady` promise below in `handleRequest` to
        // wait. Also we can't `await` in the constructor.
        void this.matchers.reload();
        this.setAssetPrefix(assetPrefix);
    }
    reloadMatchers() {
        return this.matchers.reload();
    }
    getRouteMatchers() {
        // Create a new manifest loader that get's the manifests from the server.
        const manifestLoader = new _servermanifestloader.ServerManifestLoader((name)=>{
            switch(name){
                case _constants.PAGES_MANIFEST:
                    return this.getPagesManifest() ?? null;
                case _constants.APP_PATHS_MANIFEST:
                    return this.getAppPathsManifest() ?? null;
                default:
                    return null;
            }
        });
        // Configure the matchers and handlers.
        const matchers = new _defaultroutematchermanager.DefaultRouteMatcherManager();
        // Match pages under `pages/`.
        matchers.push(new _pagesroutematcherprovider.PagesRouteMatcherProvider(this.distDir, manifestLoader, this.i18nProvider));
        // Match api routes under `pages/api/`.
        matchers.push(new _pagesapiroutematcherprovider.PagesAPIRouteMatcherProvider(this.distDir, manifestLoader, this.i18nProvider));
        // If the app directory is enabled, then add the app matchers and handlers.
        if (this.enabledDirectories.app) {
            // Match app pages under `app/`.
            matchers.push(new _apppageroutematcherprovider.AppPageRouteMatcherProvider(this.distDir, manifestLoader));
            matchers.push(new _approuteroutematcherprovider.AppRouteRouteMatcherProvider(this.distDir, manifestLoader));
        }
        return matchers;
    }
    async instrumentationOnRequestError(...args) {
        const [err, req, ctx] = args;
        if (this.instrumentation) {
            try {
                await (this.instrumentation.onRequestError == null ? void 0 : this.instrumentation.onRequestError.call(this.instrumentation, err, {
                    path: req.url || '',
                    method: req.method || 'GET',
                    // Normalize middleware headers and other server request headers
                    headers: req instanceof _adapter.NextRequestHint ? Object.fromEntries(req.headers.entries()) : req.headers
                }, ctx));
            } catch (handlerErr) {
                // Log the soft error and continue, since errors can thrown from react stream handler
                console.error('Error in instrumentation.onRequestError:', handlerErr);
            }
        }
    }
    logError(err) {
        if (this.quiet) return;
        _log.error(err);
    }
    async handleRequest(req, res, parsedUrl) {
        await this.prepare();
        const method = req.method.toUpperCase();
        const tracer = (0, _tracer.getTracer)();
        return tracer.withPropagatedContext(req.headers, ()=>{
            // Capture the parent span before creating the handleRequest span.
            // When deployed with an adapter, the platform's runtime may create its
            // own OTEL HTTP server span before Next.js runs. We propagate http.route
            // to this parent span so APM tools (e.g. Datadog) can derive the
            // resource name correctly.
            const parentSpan = tracer.getActiveScopeSpan();
            return tracer.trace(_constants1.BaseServerSpan.handleRequest, {
                spanName: `${method}`,
                kind: _tracer.SpanKind.SERVER,
                attributes: {
                    'http.method': method,
                    'http.target': req.url
                }
            }, async (span)=>this.handleRequestImpl(req, res, parsedUrl).finally(()=>{
                    if (!span) return;
                    const isRSCRequest = (0, _requestmeta.getRequestMeta)(req, 'isRSCRequest') ?? false;
                    span.setAttributes({
                        'http.status_code': res.statusCode,
                        'next.rsc': isRSCRequest
                    });
                    if (res.statusCode && res.statusCode >= 500) {
                        // For 5xx status codes: SHOULD be set to 'Error' span status.
                        // x-ref: https://opentelemetry.io/docs/specs/semconv/http/http-spans/#status
                        span.setStatus({
                            code: _tracer.SpanStatusCode.ERROR
                        });
                        // For span status 'Error', SHOULD set 'error.type' attribute.
                        span.setAttribute('error.type', res.statusCode.toString());
                    }
                    const rootSpanAttributes = tracer.getRootSpanAttributes();
                    // We were unable to get attributes, probably OTEL is not enabled
                    if (!rootSpanAttributes) return;
                    if (rootSpanAttributes.get('next.span_type') !== _constants1.BaseServerSpan.handleRequest) {
                        console.warn(`Unexpected root span type '${rootSpanAttributes.get('next.span_type')}'. Please report this Next.js issue https://github.com/vercel/next.js`);
                        return;
                    }
                    const route = rootSpanAttributes.get('next.route');
                    if (route) {
                        const name = isRSCRequest ? `RSC ${method} ${route}` : `${method} ${route}`;
                        span.setAttributes({
                            'next.route': route,
                            'http.route': route,
                            'next.span_name': name
                        });
                        span.updateName(name);
                        // Propagate http.route to the parent span if one exists and
                        // is different from the handleRequest span. This ensures APM
                        // tools that read attributes from the outermost span (e.g.
                        // a platform-created HTTP span) can derive the resource name.
                        if (parentSpan && parentSpan !== span) {
                            parentSpan.setAttribute('http.route', route);
                        }
                    } else {
                        span.updateName(isRSCRequest ? `RSC ${method}` : `${method}`);
                    }
                }));
        });
    }
    async handleRequestImpl(req, res, parsedUrl) {
        try {
            var _originalRequest_socket, _originalRequest_socket1, _this_i18nProvider, _this_nextConfig_i18n;
            // Wait for the matchers to be ready.
            await this.matchers.waitTillReady();
            // ensure cookies set in middleware are merged and
            // not overridden by API routes/getServerSideProps
            (0, _patchsetheader.patchSetHeaderWithCookieSupport)(req, (0, _helpers.isNodeNextResponse)(res) ? res.originalResponse : res);
            const urlParts = (req.url || '').split('?', 1);
            const urlNoQuery = urlParts[0];
            // this normalizes repeated slashes in the path e.g. hello//world ->
            // hello/world or backslashes to forward slashes, this does not
            // handle trailing slash as that is handled the same as a next.config.js
            // redirect
            if (urlNoQuery == null ? void 0 : urlNoQuery.match(/(\\|\/\/)/)) {
                const cleanUrl = (0, _utils.normalizeRepeatedSlashes)(req.url);
                res.redirect(cleanUrl, 308).body(cleanUrl).send();
                return;
            }
            // Parse url if parsedUrl not provided
            if (!parsedUrl || typeof parsedUrl !== 'object') {
                if (!req.url) {
                    throw Object.defineProperty(new Error('Invariant: url can not be undefined'), "__NEXT_ERROR_CODE", {
                        value: "E123",
                        enumerable: false,
                        configurable: true
                    });
                }
                parsedUrl = (0, _parseurl.parseUrl)(req.url);
            }
            if (!parsedUrl.pathname) {
                throw Object.defineProperty(new Error("Invariant: pathname can't be empty"), "__NEXT_ERROR_CODE", {
                    value: "E412",
                    enumerable: false,
                    configurable: true
                });
            }
            // Parse the querystring ourselves if the user doesn't handle querystring parsing
            if (typeof parsedUrl.query === 'string') {
                parsedUrl.query = Object.fromEntries(new URLSearchParams(parsedUrl.query));
            }
            // Update the `x-forwarded-*` headers.
            const { originalRequest = null } = (0, _helpers.isNodeNextRequest)(req) ? req : {};
            const xForwardedProto = originalRequest == null ? void 0 : originalRequest.headers['x-forwarded-proto'];
            const isHttps = xForwardedProto ? xForwardedProto === 'https' : !!(originalRequest == null ? void 0 : (_originalRequest_socket = originalRequest.socket) == null ? void 0 : _originalRequest_socket.encrypted);
            req.headers['x-forwarded-host'] ??= req.headers['host'] ?? this.hostname;
            req.headers['x-forwarded-port'] ??= this.port ? this.port.toString() : isHttps ? '443' : '80';
            req.headers['x-forwarded-proto'] ??= isHttps ? 'https' : 'http';
            req.headers['x-forwarded-for'] ??= originalRequest == null ? void 0 : (_originalRequest_socket1 = originalRequest.socket) == null ? void 0 : _originalRequest_socket1.remoteAddress;
            // This should be done before any normalization of the pathname happens as
            // it captures the initial URL.
            this.attachRequestMeta(req, parsedUrl);
            let finished = await this.handleRSCRequest(req, res, parsedUrl);
            if (finished) return;
            const domainLocale = (_this_i18nProvider = this.i18nProvider) == null ? void 0 : _this_i18nProvider.detectDomainLocale((0, _gethostname.getHostname)(parsedUrl, req.headers));
            const defaultLocale = (domainLocale == null ? void 0 : domainLocale.defaultLocale) || ((_this_nextConfig_i18n = this.nextConfig.i18n) == null ? void 0 : _this_nextConfig_i18n.defaultLocale);
            (0, _requestmeta.addRequestMeta)(req, 'defaultLocale', defaultLocale);
            const url = (0, _parseurl.parseUrl)(req.url.replace(/^\/+/, '/'));
            const pathnameInfo = (0, _getnextpathnameinfo.getNextPathnameInfo)(url.pathname, {
                nextConfig: this.nextConfig,
                i18nProvider: this.i18nProvider
            });
            url.pathname = pathnameInfo.pathname;
            if (pathnameInfo.basePath) {
                req.url = (0, _removepathprefix.removePathPrefix)(req.url, this.nextConfig.basePath);
            }
            const useMatchedPathHeader = this.minimalMode && typeof req.headers[_constants2.MATCHED_PATH_HEADER] === 'string';
            // TODO: merge handling with invokePath
            if (useMatchedPathHeader) {
                try {
                    var _this_normalizers_data, _this_i18nProvider1, _this_getRoutesManifest;
                    if (this.enabledDirectories.app) {
                        // ensure /index path is normalized for prerender
                        // in minimal mode
                        if (req.url.match(/^\/index($|\?)/)) {
                            req.url = req.url.replace(/^\/index/, '/');
                        }
                        parsedUrl.pathname = parsedUrl.pathname === '/index' ? '/' : parsedUrl.pathname;
                    }
                    // x-matched-path is the source of truth, it tells what page
                    // should be rendered because we don't process rewrites in minimalMode
                    let { pathname: matchedPath } = new URL((0, _fixmojibake.fixMojibake)(req.headers[_constants2.MATCHED_PATH_HEADER]), 'http://localhost');
                    let { pathname: urlPathname } = new URL(req.url, 'http://localhost');
                    // For ISR the URL is normalized to the prerenderPath so if
                    // it's a data request the URL path will be the data URL,
                    // basePath is already stripped by this point
                    if ((_this_normalizers_data = this.normalizers.data) == null ? void 0 : _this_normalizers_data.match(urlPathname)) {
                        (0, _requestmeta.addRequestMeta)(req, 'isNextDataReq', true);
                    }
                    // It's important to execute the following block even it the request
                    // matches a pages data route from above.
                    if (this.isAppPPREnabled && this.minimalMode && req.headers[_constants2.NEXT_RESUME_HEADER] === '1' && req.method === 'POST') {
                        const { maxPostponedStateSize, maxPostponedStateSizeBytes } = (0, _postponedrequestbody.getMaxPostponedStateSize)(this.nextConfig.experimental.maxPostponedStateSize);
                        // Decode the postponed state from the request body, it will come as
                        // an array of buffers, so collect them and then concat them to form
                        // the string.
                        const body = await (0, _postponedrequestbody.readBodyWithSizeLimit)(req.body, maxPostponedStateSizeBytes);
                        if (body === null) {
                            res.statusCode = 413;
                            res.body((0, _postponedrequestbody.getPostponedStateExceededErrorMessage)(maxPostponedStateSize)).send();
                            return;
                        }
                        const postponed = body.toString('utf8');
                        (0, _requestmeta.addRequestMeta)(req, 'postponed', postponed);
                    }
                    // If the request is a next data request and it has a postponed state,
                    // we should error, as it represents an unprocessable request.
                    if ((0, _requestmeta.getRequestMeta)(req, 'isNextDataReq') && (0, _requestmeta.getRequestMeta)(req, 'postponed')) {
                        // The server understood that this is a PPR resume request, as the
                        // headers were included to correctly indicate a resume request, but
                        // because the request URL indicates that this should render a next
                        // data route (a pages router route), this represents an
                        // unprocessable request.
                        res.statusCode = 422;
                        res.send();
                        return;
                    }
                    matchedPath = this.normalize(matchedPath);
                    const normalizedUrlPath = this.stripNextDataPath(urlPathname);
                    matchedPath = (0, _denormalizepagepath.denormalizePagePath)(matchedPath);
                    // Perform locale detection and normalization.
                    const localeAnalysisResult = (_this_i18nProvider1 = this.i18nProvider) == null ? void 0 : _this_i18nProvider1.analyze(matchedPath, {
                        defaultLocale
                    });
                    // The locale result will be defined even if the locale was not
                    // detected for the request because it will be inferred from the
                    // default locale.
                    if (localeAnalysisResult) {
                        (0, _requestmeta.addRequestMeta)(req, 'locale', localeAnalysisResult.detectedLocale);
                        // If the detected locale was inferred from the default locale, we
                        // need to modify the metadata on the request to indicate that.
                        if (localeAnalysisResult.inferredFromDefault) {
                            (0, _requestmeta.addRequestMeta)(req, 'localeInferredFromDefault', true);
                        } else {
                            (0, _requestmeta.removeRequestMeta)(req, 'localeInferredFromDefault');
                        }
                    }
                    let srcPathname = matchedPath;
                    let pageIsDynamic = (0, _utils1.isDynamicRoute)(srcPathname);
                    let paramsResult = {
                        params: false,
                        hasValidParams: false
                    };
                    const match = await this.matchers.match(srcPathname, {
                        i18n: localeAnalysisResult
                    });
                    if (!pageIsDynamic && match) {
                        // Update the source pathname to the matched page's pathname.
                        srcPathname = match.definition.pathname;
                        // The page is dynamic if the params are defined. We know at this
                        // stage that the matched path is not a static page if the params
                        // were parsed from the matched path header.
                        if (typeof match.params !== 'undefined') {
                            pageIsDynamic = true;
                            paramsResult.params = match.params;
                            paramsResult.hasValidParams = true;
                        }
                    }
                    // The rest of this function can't handle i18n properly, so ensure we
                    // restore the pathname with the locale information stripped from it
                    // now that we're done matching if we're using i18n.
                    if (localeAnalysisResult) {
                        matchedPath = localeAnalysisResult.pathname;
                    }
                    const utils = (0, _serverutils.getServerUtils)({
                        pageIsDynamic,
                        page: srcPathname,
                        i18n: this.nextConfig.i18n,
                        basePath: this.nextConfig.basePath,
                        rewrites: ((_this_getRoutesManifest = this.getRoutesManifest()) == null ? void 0 : _this_getRoutesManifest.rewrites) || {
                            beforeFiles: [],
                            afterFiles: [],
                            fallback: []
                        },
                        caseSensitive: !!this.nextConfig.experimental.caseSensitiveRoutes
                    });
                    // Ensure parsedUrl.pathname includes locale before processing
                    // rewrites or they won't match correctly.
                    if (defaultLocale && !pathnameInfo.locale) {
                        parsedUrl.pathname = `/${defaultLocale}${parsedUrl.pathname}`;
                    }
                    // Store a copy of `parsedUrl.query` before calling handleRewrites.
                    // Since `handleRewrites` might add new queries to `parsedUrl.query`.
                    const originQueryParams = {
                        ...parsedUrl.query
                    };
                    const pathnameBeforeRewrite = parsedUrl.pathname;
                    const { rewriteParams, rewrittenParsedUrl } = utils.handleRewrites(req, parsedUrl);
                    const rewriteParamKeys = Object.keys(rewriteParams);
                    // Create a copy of the query params to avoid mutating the original
                    // object. This prevents any overlapping query params that have the
                    // same normalized key from causing issues.
                    const rewrittenQueryParams = {
                        ...rewrittenParsedUrl.query
                    };
                    const didRewrite = pathnameBeforeRewrite !== rewrittenParsedUrl.pathname;
                    if (didRewrite && rewrittenParsedUrl.pathname) {
                        (0, _requestmeta.addRequestMeta)(req, 'rewrittenPathname', rewrittenParsedUrl.pathname);
                    }
                    const routeParamKeys = new Set();
                    for (const [key, value] of Object.entries(parsedUrl.query)){
                        const normalizedKey = (0, _utils3.normalizeNextQueryParam)(key);
                        if (!normalizedKey) continue;
                        // Remove the prefixed key from the query params because we want
                        // to consume it for the dynamic route matcher.
                        delete parsedUrl.query[key];
                        routeParamKeys.add(normalizedKey);
                        if (typeof value === 'undefined') continue;
                        rewrittenQueryParams[normalizedKey] = Array.isArray(value) ? value.map((v)=>(0, _decodequerypathparameter.decodeQueryPathParameter)(v)) : (0, _decodequerypathparameter.decodeQueryPathParameter)(value);
                    }
                    // interpolate dynamic params and normalize URL if needed
                    if (pageIsDynamic) {
                        let params = {};
                        // If we don't already have valid params, try to parse them from
                        // the query params.
                        if (!paramsResult.hasValidParams) {
                            paramsResult = utils.normalizeDynamicRouteParams(rewrittenQueryParams, false);
                        }
                        // for prerendered ISR paths we attempt parsing the route
                        // params from the URL directly as route-matches may not
                        // contain the correct values due to the filesystem path
                        // matching before the dynamic route has been matched
                        if (!paramsResult.hasValidParams && !(0, _utils1.isDynamicRoute)(normalizedUrlPath)) {
                            let matcherParams = utils.dynamicRouteMatcher == null ? void 0 : utils.dynamicRouteMatcher.call(utils, normalizedUrlPath);
                            if (matcherParams) {
                                utils.normalizeDynamicRouteParams(matcherParams, false);
                                Object.assign(paramsResult.params, matcherParams);
                                paramsResult.hasValidParams = true;
                            }
                        }
                        // if an action request is bypassing a prerender and we
                        // don't have the params in the URL since it was prerendered
                        // and matched during handle: 'filesystem' rather than dynamic route
                        // resolving we need to parse the params from the matched-path.
                        // Note: this is similar to above case but from match-path instead
                        // of from the request URL since a rewrite could cause that to not
                        // match the src pathname
                        if (// we can have a collision with /index and a top-level /[slug]
                        matchedPath !== '/index' && !paramsResult.hasValidParams && !(0, _utils1.isDynamicRoute)(matchedPath)) {
                            let matcherParams = utils.dynamicRouteMatcher == null ? void 0 : utils.dynamicRouteMatcher.call(utils, matchedPath);
                            if (matcherParams) {
                                const curParamsResult = utils.normalizeDynamicRouteParams(matcherParams, false);
                                if (curParamsResult.hasValidParams) {
                                    Object.assign(params, matcherParams);
                                    paramsResult = curParamsResult;
                                }
                            }
                        }
                        if (paramsResult.hasValidParams) {
                            params = paramsResult.params;
                        }
                        const routeMatchesHeader = req.headers['x-now-route-matches'];
                        if (typeof routeMatchesHeader === 'string' && routeMatchesHeader && (0, _utils1.isDynamicRoute)(matchedPath) && !paramsResult.hasValidParams) {
                            const routeMatches = utils.getParamsFromRouteMatches(routeMatchesHeader);
                            if (routeMatches) {
                                paramsResult = utils.normalizeDynamicRouteParams(routeMatches, true);
                                if (paramsResult.hasValidParams) {
                                    params = paramsResult.params;
                                }
                            }
                        }
                        // Try to parse the params from the query if we couldn't parse them
                        // from the route matches but ignore missing optional params.
                        if (!paramsResult.hasValidParams) {
                            paramsResult = utils.normalizeDynamicRouteParams(rewrittenQueryParams, true);
                            if (paramsResult.hasValidParams) {
                                params = paramsResult.params;
                            }
                        }
                        // If the pathname being requested is the same as the source
                        // pathname, and we don't have valid params, we want to use the
                        // default route matches.
                        if (utils.defaultRouteMatches && normalizedUrlPath === srcPathname && !paramsResult.hasValidParams) {
                            params = utils.defaultRouteMatches;
                            // If the route matches header is an empty string, we want to
                            // render a fallback shell. This is because we know this came from
                            // a prerender (it has the header) but it's values were filtered
                            // out (because the allowQuery was empty). If it was undefined
                            // then we know that the request is hitting the lambda directly.
                            if (routeMatchesHeader === '') {
                                (0, _requestmeta.addRequestMeta)(req, 'renderFallbackShell', true);
                            }
                        }
                        if (params) {
                            matchedPath = utils.interpolateDynamicPath(srcPathname, params);
                            req.url = utils.interpolateDynamicPath(req.url, params);
                            // If the request is for a segment prefetch, we need to update the
                            // segment prefetch request path to include the interpolated
                            // params.
                            let segmentPrefetchRSCRequest = (0, _requestmeta.getRequestMeta)(req, 'segmentPrefetchRSCRequest');
                            if (segmentPrefetchRSCRequest && (0, _utils1.isDynamicRoute)(segmentPrefetchRSCRequest, false)) {
                                segmentPrefetchRSCRequest = utils.interpolateDynamicPath(segmentPrefetchRSCRequest, params);
                                req.headers[_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER] = segmentPrefetchRSCRequest;
                                (0, _requestmeta.addRequestMeta)(req, 'segmentPrefetchRSCRequest', segmentPrefetchRSCRequest);
                            }
                        }
                    }
                    if (pageIsDynamic || didRewrite) {
                        var _utils_defaultRouteRegex;
                        utils.normalizeCdnUrl(req, [
                            ...rewriteParamKeys,
                            ...Object.keys(((_utils_defaultRouteRegex = utils.defaultRouteRegex) == null ? void 0 : _utils_defaultRouteRegex.groups) || {})
                        ]);
                    }
                    // Remove the route `params` keys from `parsedUrl.query` if they are
                    // not in the original query params.
                    // If it's used in both route `params` and query `searchParams`, it should be kept.
                    for (const key of routeParamKeys){
                        if (!(key in originQueryParams)) {
                            delete parsedUrl.query[key];
                        }
                    }
                    parsedUrl.pathname = matchedPath;
                    url.pathname = parsedUrl.pathname;
                    // For Pages Router routes, use the normalized queryParams from
                    // handleRewrites to ensure catch-all routes get proper array values.
                    // App Router routes should not include rewrite query params as they
                    // affect RSC payload.
                    if ((match == null ? void 0 : match.definition.kind) === _routekind.RouteKind.PAGES || (match == null ? void 0 : match.definition.kind) === _routekind.RouteKind.PAGES_API) {
                        parsedUrl.query = rewrittenQueryParams;
                    }
                    finished = await this.normalizeAndAttachMetadata(req, res, parsedUrl);
                    if (finished) return;
                } catch (err) {
                    if (err instanceof _utils.DecodeError || err instanceof _utils.NormalizeError) {
                        res.statusCode = 400;
                        return this.renderError(null, req, res, '/_error', {});
                    }
                    throw err;
                }
            }
            (0, _requestmeta.addRequestMeta)(req, 'isLocaleDomain', Boolean(domainLocale));
            if (pathnameInfo.locale) {
                req.url = (0, _url.format)(url);
                (0, _requestmeta.addRequestMeta)(req, 'didStripLocale', true);
            }
            // If we aren't in minimal mode or there is no locale in the query
            // string, add the locale to the query string.
            if (!this.minimalMode || !(0, _requestmeta.getRequestMeta)(req, 'locale')) {
                // If the locale is in the pathname, add it to the query string.
                if (pathnameInfo.locale) {
                    (0, _requestmeta.addRequestMeta)(req, 'locale', pathnameInfo.locale);
                } else if (defaultLocale) {
                    (0, _requestmeta.addRequestMeta)(req, 'locale', defaultLocale);
                    (0, _requestmeta.addRequestMeta)(req, 'localeInferredFromDefault', true);
                }
            }
            // set incremental cache to request meta so it can
            // be passed down for edge functions and the fetch disk
            // cache can be leveraged locally
            if (!this.serverOptions.webServerConfig && !(0, _requestmeta.getRequestMeta)(req, 'incrementalCache')) {
                const incrementalCache = await this.getIncrementalCache({
                    requestHeaders: Object.assign({}, req.headers)
                });
                incrementalCache.resetRequestCache();
                (0, _requestmeta.addRequestMeta)(req, 'incrementalCache', incrementalCache);
                globalThis.__incrementalCache = incrementalCache;
            }
            // set server components HMR cache to request meta so it can be passed
            // down for edge functions
            if (!(0, _requestmeta.getRequestMeta)(req, 'serverComponentsHmrCache')) {
                (0, _requestmeta.addRequestMeta)(req, 'serverComponentsHmrCache', this.getServerComponentsHmrCache());
            }
            // when invokePath is specified we can short short circuit resolving
            // we only honor this header if we are inside of a render worker to
            // prevent external users coercing the routing path
            const invokePath = (0, _requestmeta.getRequestMeta)(req, 'invokePath');
            const useInvokePath = !useMatchedPathHeader && invokePath;
            if (useInvokePath) {
                var _this_nextConfig_i18n1;
                const invokeStatus = (0, _requestmeta.getRequestMeta)(req, 'invokeStatus');
                if (invokeStatus) {
                    const invokeQuery = (0, _requestmeta.getRequestMeta)(req, 'invokeQuery');
                    if (invokeQuery) {
                        Object.assign(parsedUrl.query, invokeQuery);
                    }
                    res.statusCode = invokeStatus;
                    let err = (0, _requestmeta.getRequestMeta)(req, 'invokeError') || null;
                    return this.renderError(err, req, res, '/_error', parsedUrl.query);
                }
                const parsedMatchedPath = new URL(invokePath || '/', 'http://n');
                const invokePathnameInfo = (0, _getnextpathnameinfo.getNextPathnameInfo)(parsedMatchedPath.pathname, {
                    nextConfig: this.nextConfig,
                    parseData: false
                });
                if (invokePathnameInfo.locale) {
                    (0, _requestmeta.addRequestMeta)(req, 'locale', invokePathnameInfo.locale);
                }
                if (parsedUrl.pathname !== parsedMatchedPath.pathname) {
                    parsedUrl.pathname = parsedMatchedPath.pathname;
                    (0, _requestmeta.addRequestMeta)(req, 'rewrittenPathname', invokePathnameInfo.pathname);
                }
                const normalizeResult = (0, _normalizelocalepath.normalizeLocalePath)((0, _removepathprefix.removePathPrefix)(parsedUrl.pathname, this.nextConfig.basePath || ''), (_this_nextConfig_i18n1 = this.nextConfig.i18n) == null ? void 0 : _this_nextConfig_i18n1.locales);
                if (normalizeResult.detectedLocale) {
                    (0, _requestmeta.addRequestMeta)(req, 'locale', normalizeResult.detectedLocale);
                }
                parsedUrl.pathname = normalizeResult.pathname;
                for (const key of Object.keys(parsedUrl.query)){
                    delete parsedUrl.query[key];
                }
                const invokeQuery = (0, _requestmeta.getRequestMeta)(req, 'invokeQuery');
                if (invokeQuery) {
                    Object.assign(parsedUrl.query, invokeQuery);
                }
                finished = await this.normalizeAndAttachMetadata(req, res, parsedUrl);
                if (finished) return;
                await this.handleCatchallRenderRequest(req, res, parsedUrl);
                return;
            }
            if ((0, _requestmeta.getRequestMeta)(req, 'middlewareInvoke')) {
                finished = await this.normalizeAndAttachMetadata(req, res, parsedUrl);
                if (finished) return;
                finished = await this.handleCatchallMiddlewareRequest(req, res, parsedUrl);
                if (finished) return;
                const err = new Error();
                err.result = {
                    response: new Response(null, {
                        headers: {
                            'x-middleware-next': '1'
                        }
                    })
                };
                err.bubble = true;
                throw err;
            }
            // This wasn't a request via the matched path or the invoke path, so
            // prepare for a legacy run by removing the base path.
            // ensure we strip the basePath when not using an invoke header
            if (!useMatchedPathHeader && pathnameInfo.basePath) {
                parsedUrl.pathname = (0, _removepathprefix.removePathPrefix)(parsedUrl.pathname, pathnameInfo.basePath);
            }
            res.statusCode = 200;
            return await this.run(req, res, parsedUrl);
        } catch (err) {
            if (err instanceof _nofallbackerrorexternal.NoFallbackError) {
                throw err;
            }
            if (err && typeof err === 'object' && err.code === 'ERR_INVALID_URL' || err instanceof _utils.DecodeError || err instanceof _utils.NormalizeError) {
                res.statusCode = 400;
                return this.renderError(null, req, res, '/_error', {});
            }
            if (this.minimalMode || this.dev || (0, _tracer.isBubbledError)(err) && err.bubble) {
                throw err;
            }
            this.logError((0, _iserror.getProperError)(err));
            res.statusCode = 500;
            res.body('Internal Server Error').send();
        }
    }
    /**
   * @internal - this method is internal to Next.js and should not be used directly by end-users
   */ getRequestHandlerWithMetadata(meta) {
        const handler = this.getRequestHandler();
        return (req, res, parsedUrl)=>{
            (0, _requestmeta.setRequestMeta)(req, meta);
            return handler(req, res, parsedUrl);
        };
    }
    getRequestHandler() {
        return this.handleRequest.bind(this);
    }
    setAssetPrefix(prefix) {
        this.nextConfig.assetPrefix = prefix ? prefix.replace(/\/$/, '') : '';
    }
    /**
   * Runs async initialization of server.
   * It is idempotent, won't fire underlying initialization more than once.
   */ async prepare() {
        if (this.prepared) return;
        // Get instrumentation module
        if (!this.instrumentation) {
            this.instrumentation = await this.loadInstrumentationModule();
        }
        if (this.preparedPromise === null) {
            this.preparedPromise = this.prepareImpl().then(()=>{
                this.prepared = true;
                this.preparedPromise = null;
            });
        }
        return this.preparedPromise;
    }
    async prepareImpl() {}
    async loadInstrumentationModule() {}
    async close() {}
    getAppPathRoutes() {
        const appPathRoutes = {};
        Object.keys(this.appPathsManifest || {}).forEach((entry)=>{
            const normalizedPath = (0, _apppaths.normalizeAppPath)(entry);
            if (!appPathRoutes[normalizedPath]) {
                appPathRoutes[normalizedPath] = [];
            }
            appPathRoutes[normalizedPath].push(entry);
        });
        return appPathRoutes;
    }
    async run(req, res, parsedUrl) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.run, async ()=>this.runImpl(req, res, parsedUrl));
    }
    async runImpl(req, res, parsedUrl) {
        await this.handleCatchallRenderRequest(req, res, parsedUrl);
    }
    async pipe(fn, partialContext) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.pipe, async ()=>this.pipeImpl(fn, partialContext));
    }
    async pipeImpl(fn, partialContext) {
        const ua = partialContext.req.headers['user-agent'] || '';
        const ctx = {
            ...partialContext,
            renderOpts: {
                ...this.renderOpts,
                // `renderOpts.botType` is accumulated in `this.renderImpl()`
                supportsDynamicResponse: !this.renderOpts.botType,
                serveStreamingMetadata: (0, _streamingmetadata.shouldServeStreamingMetadata)(ua, this.nextConfig.htmlLimitedBots)
            }
        };
        const payload = await fn(ctx);
        if (payload === null) {
            return;
        }
        const { req, res } = ctx;
        const originalStatus = res.statusCode;
        const { body } = payload;
        let { cacheControl } = payload;
        if (!res.sent) {
            const { generateEtags, poweredByHeader } = this.renderOpts;
            // In dev, we should not cache pages for any reason.
            if (this.dev) {
                res.setHeader('Cache-Control', 'no-cache, must-revalidate');
                cacheControl = undefined;
            }
            if (cacheControl && cacheControl.expire === undefined) {
                cacheControl.expire = this.nextConfig.expireTime;
            }
            await this.sendRenderResult(req, res, {
                result: body,
                generateEtags,
                poweredByHeader,
                cacheControl
            });
            res.statusCode = originalStatus;
        }
    }
    async getStaticHTML(fn, partialContext) {
        const ctx = {
            ...partialContext,
            renderOpts: {
                ...this.renderOpts,
                supportsDynamicResponse: false
            }
        };
        const payload = await fn(ctx);
        if (payload === null) {
            return null;
        }
        return payload.body.toUnchunkedString();
    }
    async render(req, res, pathname, query = {}, parsedUrl, internalRender = false) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.render, async ()=>this.renderImpl(req, res, pathname, query, parsedUrl, internalRender));
    }
    getWaitUntil() {
        const builtinRequestContext = (0, _builtinrequestcontext.getBuiltinRequestContext)();
        if (builtinRequestContext) {
            // the platform provided a request context.
            // use the `waitUntil` from there, whether actually present or not --
            // if not present, `after` will error.
            // NOTE: if we're in an edge runtime sandbox, this context will be used to forward the outer waitUntil.
            return builtinRequestContext.waitUntil;
        }
        if (this.minimalMode) {
            // we're built for a serverless environment, and `waitUntil` is not available,
            // but using a noop would likely lead to incorrect behavior,
            // because we have no way of keeping the invocation alive.
            // return nothing, and `after` will error if used.
            //
            // NOTE: for edge functions, `NextWebServer` always runs in minimal mode.
            //
            // NOTE: if we're in an edge runtime sandbox, waitUntil will be passed in using "@next/request-context",
            // so we won't get here.
            return undefined;
        }
        return this.getInternalWaitUntil();
    }
    getInternalWaitUntil() {
        return undefined;
    }
    async renderImpl(req, res, pathname, query = {}, parsedUrl, internalRender = false) {
        var _req_url;
        if (!pathname.startsWith('/')) {
            console.warn(`Cannot render page with path "${pathname}", did you mean "/${pathname}"?. See more info here: https://nextjs.org/docs/messages/render-no-starting-slash`);
        }
        if (this.serverOptions.customServer && pathname === '/index' && !await this.hasPage('/index')) {
            // maintain backwards compatibility for custom server
            // (see custom-server integration tests)
            pathname = '/';
        }
        const ua = req.headers['user-agent'] || '';
        this.renderOpts.botType = (0, _isbot.getBotType)(ua);
        // we allow custom servers to call render for all URLs
        // so check if we need to serve a static _next file or not.
        // we don't modify the URL for _next/data request but still
        // call render so we special case this to prevent an infinite loop
        if (!internalRender && !this.minimalMode && !(0, _requestmeta.getRequestMeta)(req, 'isNextDataReq') && (((_req_url = req.url) == null ? void 0 : _req_url.match(/^\/_next\//)) || this.hasStaticDir && req.url.match(/^\/static\//))) {
            return this.handleRequest(req, res, parsedUrl);
        }
        if ((0, _utils2.isBlockedPage)(pathname)) {
            return this.render404(req, res, parsedUrl);
        }
        return this.pipe((ctx)=>this.renderToResponse(ctx), {
            req,
            res,
            pathname,
            query
        });
    }
    async getStaticPaths({ pathname }) {
        var _this_getPrerenderManifest_dynamicRoutes_pathname;
        // Read whether or not fallback should exist from the manifest.
        const fallbackField = (_this_getPrerenderManifest_dynamicRoutes_pathname = this.getPrerenderManifest().dynamicRoutes[pathname]) == null ? void 0 : _this_getPrerenderManifest_dynamicRoutes_pathname.fallback;
        return {
            // `staticPaths` is intentionally set to `undefined` as it should've
            // been caught when checking disk data.
            staticPaths: undefined,
            fallbackMode: (0, _fallback.parseFallbackField)(fallbackField)
        };
    }
    async renderToResponseWithComponents(requestContext, findComponentsResult) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.renderToResponseWithComponents, async ()=>this.renderToResponseWithComponentsImpl(requestContext, findComponentsResult));
    }
    pathCouldBeIntercepted(resolvedPathname) {
        return (0, _interceptionroutes.isInterceptionRouteAppPath)(resolvedPathname) || this.interceptionRoutePatterns.some((regexp)=>{
            return regexp.test(resolvedPathname);
        });
    }
    setVaryHeader(req, res, isAppPath, resolvedPathname) {
        const baseVaryHeader = `${_approuterheaders.RSC_HEADER}, ${_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER}, ${_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER}, ${_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER}`;
        const isRSCRequest = (0, _requestmeta.getRequestMeta)(req, 'isRSCRequest') ?? false;
        let addedNextUrlToVary = false;
        if (isAppPath && this.pathCouldBeIntercepted(resolvedPathname)) {
            // Interception route responses can vary based on the `Next-URL` header.
            // We use the Vary header to signal this behavior to the client to properly cache the response.
            res.appendHeader('vary', `${baseVaryHeader}, ${_approuterheaders.NEXT_URL}`);
            addedNextUrlToVary = true;
        } else if (isAppPath || isRSCRequest) {
            // We don't need to include `Next-URL` in the Vary header for non-interception routes since it won't affect the response.
            // We also set this header for pages to avoid caching issues when navigating between pages and app.
            res.appendHeader('vary', baseVaryHeader);
        }
        if (!addedNextUrlToVary) {
            // Remove `Next-URL` from the request headers we determined it wasn't necessary to include in the Vary header.
            // This is to avoid any dependency on the `Next-URL` header being present when preparing the response.
            delete req.headers[_approuterheaders.NEXT_URL];
        }
    }
    async renderToResponseWithComponentsImpl({ req, res, pathname, renderOpts: opts }, { components, query }) {
        var _this;
        if (pathname === _constants.UNDERSCORE_NOT_FOUND_ROUTE) {
            pathname = '/404';
        }
        const isErrorPathname = pathname === '/_error';
        const is404Page = pathname === '/404' || isErrorPathname && res.statusCode === 404;
        const is500Page = pathname === '/500' || isErrorPathname && res.statusCode === 500;
        const isAppPath = components.isAppPath === true;
        const hasServerProps = !!components.getServerSideProps;
        const isPossibleServerAction = (0, _serveractionrequestmeta.getIsPossibleServerAction)(req);
        let isSSG = !!components.getStaticProps;
        // NOTE: Don't delete headers[RSC] yet, it still needs to be used in renderToHTML later
        const isRSCRequest = (0, _requestmeta.getRequestMeta)(req, 'isRSCRequest') ?? false;
        // Not all CDNs respect the Vary header when caching. We must assume that
        // only the URL is used to vary the responses. The Next client computes a
        // hash of the header values and sends it as a search param. Before
        // responding to a request, we must verify that the hash matches the
        // expected value. Neglecting to do this properly can lead to cache
        // poisoning attacks on certain CDNs.
        if (!this.minimalMode && this.nextConfig.experimental.validateRSCRequestHeaders && isRSCRequest && // In the event that we're serving a NoFallbackError, the headers will
        // already be stripped so this comparison will always fail, resulting in
        // a redirect loop.
        !is404Page) {
            const headers = req.headers;
            const prefetchHeaderValue = headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER];
            const routerPrefetch = prefetchHeaderValue !== undefined ? prefetchHeaderValue === '1' || prefetchHeaderValue === '2' ? prefetchHeaderValue : undefined : // so we don't expect the header to be stripped by an intermediate layer.
            // This should only happen for static prefetches, so we only handle those here.
            (0, _requestmeta.getRequestMeta)(req, 'isPrefetchRSCRequest') ? '1' : undefined;
            const segmentPrefetchRSCRequest = headers[_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER] || (0, _requestmeta.getRequestMeta)(req, 'segmentPrefetchRSCRequest');
            const expectedHash = (0, _cachebustingsearchparam.computeCacheBustingSearchParam)(routerPrefetch, segmentPrefetchRSCRequest, headers[_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER], headers[_approuterheaders.NEXT_URL]);
            const actualHash = (0, _requestmeta.getRequestMeta)(req, 'cacheBustingSearchParam') ?? new URL(req.url || '', 'http://localhost').searchParams.get(_approuterheaders.NEXT_RSC_UNION_QUERY);
            if (expectedHash !== actualHash) {
                // The hash sent by the client does not match the expected value.
                // Redirect to the URL with the correct cache-busting search param.
                // This prevents cache poisoning attacks on CDNs that don't respect Vary headers.
                // Note: When no headers are present, expectedHash is empty string and client
                // must send `_rsc` param, otherwise actualHash is null and hash check fails.
                const url = new URL(req.url || '', 'http://localhost');
                (0, _setcachebustingsearchparam.setCacheBustingSearchParamWithHash)(url, expectedHash);
                res.statusCode = 307;
                res.setHeader('location', `${url.pathname}${url.search}`);
                res.body('').send();
                return null;
            }
        }
        // Compute the iSSG cache key. We use the rewritten pathname since
        // pages with fallback: false are allowed to be rewritten to
        // and we need to look up the path by the rewritten path
        let urlPathname = (0, _parseurl.parseUrl)(req.url || '').pathname || '/';
        let resolvedUrlPathname = (0, _requestmeta.getRequestMeta)(req, 'rewrittenPathname') || urlPathname;
        this.setVaryHeader(req, res, isAppPath, resolvedUrlPathname);
        let staticPaths;
        let hasFallback = false;
        const prerenderManifest = this.getPrerenderManifest();
        if (hasFallback || (staticPaths == null ? void 0 : staticPaths.includes(resolvedUrlPathname)) || // this signals revalidation in deploy environments
        // TODO: make this more generic
        req.headers['x-now-route-matches']) {
            isSSG = true;
        } else if (!this.dev) {
            isSSG ||= !!prerenderManifest.routes[(0, _toroute.toRoute)(pathname)];
        }
        // Toggle whether or not this is a Data request
        const isNextDataRequest = !!((0, _requestmeta.getRequestMeta)(req, 'isNextDataReq') || req.headers['x-nextjs-data'] && this.serverOptions.webServerConfig) && (isSSG || hasServerProps);
        // when we are handling a middleware prefetch and it doesn't
        // resolve to a static data route we bail early to avoid
        // unexpected SSR invocations
        if (!isSSG && req.headers['x-middleware-prefetch'] && !(is404Page || pathname === '/_error')) {
            res.setHeader(_constants2.MATCHED_PATH_HEADER, pathname);
            res.setHeader('x-middleware-skip', '1');
            res.setHeader('cache-control', 'private, no-cache, no-store, max-age=0, must-revalidate');
            res.body('{}').send();
            return null;
        }
        // normalize req.url for SSG paths as it is not exposed
        // to getStaticProps and the asPath should not expose /_next/data
        if (isSSG && this.minimalMode && req.headers[_constants2.MATCHED_PATH_HEADER] && req.url.startsWith('/_next/data')) {
            req.url = this.stripNextDataPath(req.url);
        }
        const locale = (0, _requestmeta.getRequestMeta)(req, 'locale');
        if (!!req.headers['x-nextjs-data'] && (!res.statusCode || res.statusCode === 200)) {
            res.setHeader('x-nextjs-matched-path', `${locale ? `/${locale}` : ''}${pathname}`);
        }
        let routeModule;
        if (components.routeModule) {
            routeModule = components.routeModule;
        }
        /**
     * If the route being rendered is an app page, and the ppr feature has been
     * enabled, then the given route _could_ support PPR.
     */ const couldSupportPPR = this.isAppPPREnabled && typeof routeModule !== 'undefined' && (0, _checks.isAppPageRouteModule)(routeModule);
        // When enabled, this will allow the use of the `?__nextppronly` query to
        // enable debugging of the static shell.
        const hasDebugStaticShellQuery = process.env.__NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING === '1' && typeof query.__nextppronly !== 'undefined' && couldSupportPPR;
        // Whether the testing API is exposed (dev mode or explicit flag)
        const exposeTestingApi = this.dev === true || this.nextConfig.experimental.exposeTestingApiInProductionBuild === true;
        // Check for the instant test cookie for MPA navigations (page reload, full
        // page load) in the Instant Navigation Testing API. Only applies to
        // document requests (no RSC header) - RSC requests should proceed normally
        // even during a locked scope, with blocking happening on the client side.
        const hasInstantTestCookie = exposeTestingApi && req.headers[_approuterheaders.RSC_HEADER] === undefined && typeof req.headers.cookie === 'string' && req.headers.cookie.includes(_approuterheaders.NEXT_INSTANT_TEST_COOKIE + '=') && couldSupportPPR;
        // This page supports PPR if it is marked as being `PARTIALLY_STATIC` in the
        // prerender manifest and this is an app page.
        const isRoutePPREnabled = couldSupportPPR && (((_this = prerenderManifest.routes[pathname] ?? prerenderManifest.dynamicRoutes[pathname]) == null ? void 0 : _this.renderingMode) === 'PARTIALLY_STATIC' || // Ideally we'd want to check the appConfig to see if this page has PPR
        // enabled or not, but that would require plumbing the appConfig through
        // to the server during development. We assume that the page supports it
        // but only during development or when the testing API is exposed.
        (hasDebugStaticShellQuery || hasInstantTestCookie) && (exposeTestingApi || this.experimentalTestProxy === true));
        // If we're in minimal mode, then try to get the postponed information from
        // the request metadata. If available, use it for resuming the postponed
        // render.
        const minimalPostponed = isRoutePPREnabled ? (0, _requestmeta.getRequestMeta)(req, 'postponed') : undefined;
        // we need to ensure the status code if /404 is visited directly
        if (is404Page && !isNextDataRequest && !isRSCRequest) {
            res.statusCode = 404;
        }
        // ensure correct status is set when visiting a status page
        // directly e.g. /500
        if (_constants.STATIC_STATUS_PAGES.includes(pathname)) {
            res.statusCode = parseInt(pathname.slice(1), 10);
        }
        if (// Server actions can use non-GET/HEAD methods.
        !isPossibleServerAction && // Resume can use non-GET/HEAD methods.
        !minimalPostponed && !is404Page && !is500Page && pathname !== '/_error' && req.method !== 'HEAD' && req.method !== 'GET' && (typeof components.Component === 'string' || isSSG)) {
            res.statusCode = 405;
            res.setHeader('Allow', [
                'GET',
                'HEAD'
            ]);
            res.body('Method Not Allowed').send();
            return null;
        }
        // handle static page
        if (typeof components.Component === 'string') {
            return {
                body: _renderresult.default.fromStatic(components.Component, _constants2.HTML_CONTENT_TYPE_HEADER)
            };
        }
        if (opts.supportsDynamicResponse === true) {
            var _components_Document;
            const ua = req.headers['user-agent'] || '';
            const isBotRequest = (0, _isbot.isBot)(ua);
            const isSupportedDocument = typeof ((_components_Document = components.Document) == null ? void 0 : _components_Document.getInitialProps) !== 'function' || // The built-in `Document` component also supports dynamic HTML for concurrent mode.
            _constants.NEXT_BUILTIN_DOCUMENT in components.Document;
            // Disable dynamic HTML in cases that we know it won't be generated,
            // so that we can continue generating a cache key when possible.
            // TODO-APP: should the first render for a dynamic app path
            // be static so we can collect revalidate and populate the
            // cache if there are no dynamic data requirements
            opts.supportsDynamicResponse = !isSSG && !isBotRequest && isSupportedDocument;
        }
        // In development, we always want to generate dynamic HTML.
        if (!isNextDataRequest && isAppPath && this.dev) {
            opts.supportsDynamicResponse = true;
        }
        if (isSSG && this.minimalMode && req.headers[_constants2.MATCHED_PATH_HEADER]) {
            // the url value is already correct when the matched-path header is set
            resolvedUrlPathname = urlPathname;
        }
        urlPathname = (0, _removetrailingslash.removeTrailingSlash)(urlPathname);
        resolvedUrlPathname = (0, _removetrailingslash.removeTrailingSlash)(resolvedUrlPathname);
        if (this.localeNormalizer) {
            resolvedUrlPathname = this.localeNormalizer.normalize(resolvedUrlPathname);
        }
        // remove /_next/data prefix from urlPathname so it matches
        // for direct page visit and /_next/data visit
        if (isNextDataRequest) {
            resolvedUrlPathname = this.stripNextDataPath(resolvedUrlPathname);
            urlPathname = this.stripNextDataPath(urlPathname);
        }
        // use existing incrementalCache instance if available
        const incrementalCache = await this.getIncrementalCache({
            requestHeaders: Object.assign({}, req.headers)
        });
        // TODO: investigate, this is not safe across multiple concurrent requests
        incrementalCache.resetRequestCache();
        if ((routeModule == null ? void 0 : routeModule.isDev) && (0, _utils1.isDynamicRoute)(pathname) && (components.getStaticPaths || isAppPath)) {
            var _pathsResults_staticPaths;
            let getStaticPathsStart;
            if (this.dev) {
                getStaticPathsStart = process.hrtime.bigint();
            }
            const pathsResults = await this.getStaticPaths({
                pathname,
                urlPathname,
                requestHeaders: req.headers,
                page: components.page,
                isAppPath
            });
            if (this.dev && getStaticPathsStart && ((_pathsResults_staticPaths = pathsResults.staticPaths) == null ? void 0 : _pathsResults_staticPaths.length)) {
                (0, _requestmeta.addRequestMeta)(req, 'devGenerateStaticParamsDuration', process.hrtime.bigint() - getStaticPathsStart);
            }
            if (isAppPath && this.nextConfig.cacheComponents) {
                var _pathsResults_prerenderedRoutes;
                if ((_pathsResults_prerenderedRoutes = pathsResults.prerenderedRoutes) == null ? void 0 : _pathsResults_prerenderedRoutes.length) {
                    let smallestFallbackRouteParams = null;
                    for (const route of pathsResults.prerenderedRoutes){
                        const fallbackRouteParams = route.fallbackRouteParams;
                        if (!fallbackRouteParams || fallbackRouteParams.length === 0) {
                            // There are no fallback route params so we don't need to continue
                            smallestFallbackRouteParams = null;
                            break;
                        }
                        if (smallestFallbackRouteParams === null || fallbackRouteParams.length < smallestFallbackRouteParams.length) {
                            smallestFallbackRouteParams = fallbackRouteParams;
                        }
                    }
                    if (smallestFallbackRouteParams) {
                        (0, _requestmeta.addRequestMeta)(req, 'fallbackParams', (0, _fallbackparams.createOpaqueFallbackRouteParams)(smallestFallbackRouteParams));
                    }
                }
            }
        }
        // An OPTIONS request to a page handler is invalid.
        if (req.method === 'OPTIONS' && !is404Page && (!routeModule || !(0, _checks.isAppRouteRouteModule)(routeModule))) {
            await (0, _sendresponse.sendResponse)(req, res, new Response(null, {
                status: 400
            }));
            return null;
        }
        const request = (0, _helpers.isNodeNextRequest)(req) ? req.originalRequest : req;
        const response = (0, _helpers.isNodeNextResponse)(res) ? res.originalResponse : res;
        const parsedInitUrl = (0, _parseurl.parseUrl)((0, _requestmeta.getRequestMeta)(req, 'initURL') || req.url);
        let initPathname = parsedInitUrl.pathname || '/';
        for (const normalizer of [
            this.normalizers.segmentPrefetchRSC,
            this.normalizers.rsc
        ]){
            if (normalizer == null ? void 0 : normalizer.match(initPathname)) {
                initPathname = normalizer.normalize(initPathname);
            }
        }
        // On minimal mode, the request url of dynamic route can be a
        // literal dynamic route ('/[slug]') instead of actual URL, so overwriting to initPathname
        // will transform back the resolved url to the dynamic route pathname.
        if (!(this.minimalMode && isErrorPathname)) {
            request.url = `${initPathname}${parsedInitUrl.search || ''}`;
        }
        // propagate the request context for dev
        (0, _requestmeta.setRequestMeta)(request, (0, _requestmeta.getRequestMeta)(req));
        (0, _requestmeta.addRequestMeta)(request, 'distDir', this.distDir);
        (0, _requestmeta.addRequestMeta)(request, 'query', query);
        (0, _requestmeta.addRequestMeta)(request, 'params', opts.params);
        (0, _requestmeta.addRequestMeta)(request, 'minimalMode', this.minimalMode);
        if (opts.err) {
            (0, _requestmeta.addRequestMeta)(request, 'invokeError', opts.err);
        }
        const maybeDevRequest = // we need to capture fetch metrics when they are set
        // and can't wait for handler to resolve as the fetch
        // metrics are logged on response close which happens
        // before handler resolves
        process.env.NODE_ENV === 'development' ? new Proxy(request, {
            get (target, prop) {
                if (typeof target[prop] === 'function') {
                    return target[prop].bind(target);
                }
                return target[prop];
            },
            set (target, prop, value) {
                if (prop === 'fetchMetrics') {
                    ;
                    req.fetchMetrics = value;
                }
                target[prop] = value;
                return true;
            }
        }) : request;
        // @ts-expect-error This isn't entirely correct, but the ServerRequest type param seems overly
        // generic anyway.
        let handlerReq = maybeDevRequest;
        // @ts-expect-error This isn't entirely correct, but the ServerResponse type param seems overly
        // generic anyway.
        let handlerRes = response;
        await components.ComponentMod.handler(handlerReq, handlerRes, {
            waitUntil: this.getWaitUntil()
        });
        // response is handled fully in handler
        return null;
    }
    stripNextDataPath(filePath, stripLocale = true) {
        if (filePath.includes(this.buildId)) {
            const splitPath = filePath.substring(filePath.indexOf(this.buildId) + this.buildId.length);
            filePath = (0, _denormalizepagepath.denormalizePagePath)(splitPath.replace(/\.json$/, ''));
        }
        if (this.localeNormalizer && stripLocale) {
            return this.localeNormalizer.normalize(filePath);
        }
        return filePath;
    }
    // map the route to the actual bundle name
    getOriginalAppPaths(route) {
        if (this.enabledDirectories.app) {
            var _this_appPathRoutes;
            const originalAppPath = (_this_appPathRoutes = this.appPathRoutes) == null ? void 0 : _this_appPathRoutes[route];
            if (!originalAppPath) {
                return null;
            }
            return originalAppPath;
        }
        return null;
    }
    async renderPageComponent(ctx, bubbleNoFallback) {
        var _this_nextConfig_experimental_sri;
        const { query, pathname } = ctx;
        const appPaths = this.getOriginalAppPaths(pathname);
        const isAppPath = Array.isArray(appPaths);
        let page = pathname;
        if (isAppPath) {
            // the last item in the array is the root page, if there are parallel routes
            page = appPaths[appPaths.length - 1];
        }
        const result = await this.findPageComponents({
            locale: (0, _requestmeta.getRequestMeta)(ctx.req, 'locale'),
            page,
            query,
            params: ctx.renderOpts.params || {},
            isAppPath,
            sriEnabled: !!((_this_nextConfig_experimental_sri = this.nextConfig.experimental.sri) == null ? void 0 : _this_nextConfig_experimental_sri.algorithm),
            appPaths,
            // Ensuring for loading page component routes is done via the matcher.
            shouldEnsure: false
        });
        if (result) {
            (0, _tracer.getTracer)().setRootSpanAttribute('next.route', pathname);
            try {
                return await this.renderToResponseWithComponents(ctx, result);
            } catch (err) {
                const isNoFallbackError = err instanceof _nofallbackerrorexternal.NoFallbackError;
                if (!isNoFallbackError || isNoFallbackError && bubbleNoFallback) {
                    throw err;
                }
            }
        }
        return false;
    }
    async renderToResponse(ctx) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.renderToResponse, {
            spanName: `rendering page`,
            attributes: {
                'next.route': ctx.pathname
            }
        }, async ()=>{
            return this.renderToResponseImpl(ctx);
        });
    }
    async renderToResponseImpl(ctx) {
        var _this_i18nProvider;
        const { req, res, query, pathname } = ctx;
        let page = pathname;
        const bubbleNoFallback = (0, _requestmeta.getRequestMeta)(ctx.req, 'bubbleNoFallback') ?? false;
        if (!this.minimalMode && this.nextConfig.experimental.validateRSCRequestHeaders) {
            (0, _requestmeta.addRequestMeta)(ctx.req, 'cacheBustingSearchParam', query[_approuterheaders.NEXT_RSC_UNION_QUERY]);
        }
        delete query[_approuterheaders.NEXT_RSC_UNION_QUERY];
        const options = {
            i18n: (_this_i18nProvider = this.i18nProvider) == null ? void 0 : _this_i18nProvider.fromRequest(req, pathname)
        };
        const existingMatch = (0, _requestmeta.getRequestMeta)(ctx.req, 'match');
        let fastPath = true;
        // when a specific invoke-output is meant to be matched
        // ensure a prior dynamic route/page doesn't take priority
        const invokeOutput = (0, _requestmeta.getRequestMeta)(ctx.req, 'invokeOutput');
        if (!this.minimalMode && typeof invokeOutput === 'string' && (0, _utils1.isDynamicRoute)(invokeOutput || '') && invokeOutput !== (existingMatch == null ? void 0 : existingMatch.definition.pathname) || (// Parallel routes are matched in `existingMatch` but since currently
        // there can be multiple matches it's not guaranteed to be the right match
        // therefor we need to opt-out of the fast path for parallel routes.
        existingMatch == null ? void 0 : existingMatch.definition.page.includes('/@'))) {
            fastPath = false;
        }
        try {
            for await (const match of fastPath && existingMatch ? [
                existingMatch
            ] : this.matchers.matchAll(pathname, options)){
                if (!this.minimalMode && typeof invokeOutput === 'string' && (0, _utils1.isDynamicRoute)(invokeOutput || '') && invokeOutput !== match.definition.pathname) {
                    continue;
                }
                const result = await this.renderPageComponent({
                    ...ctx,
                    pathname: match.definition.pathname,
                    renderOpts: {
                        ...ctx.renderOpts,
                        params: match.params
                    }
                }, bubbleNoFallback);
                if (result !== false) return result;
            }
            // currently edge functions aren't receiving the x-matched-path
            // header so we need to fallback to matching the current page
            // when we weren't able to match via dynamic route to handle
            // the rewrite case
            // @ts-expect-error extended in child class web-server
            if (this.serverOptions.webServerConfig) {
                // @ts-expect-error extended in child class web-server
                ctx.pathname = this.serverOptions.webServerConfig.page;
                const result = await this.renderPageComponent(ctx, bubbleNoFallback);
                if (result !== false) return result;
            }
        } catch (error) {
            const err = (0, _iserror.getProperError)(error);
            if (error instanceof _utils.MissingStaticPage) {
                console.error('Invariant: failed to load static page', JSON.stringify({
                    page,
                    url: ctx.req.url,
                    matchedPath: ctx.req.headers[_constants2.MATCHED_PATH_HEADER],
                    initUrl: (0, _requestmeta.getRequestMeta)(ctx.req, 'initURL'),
                    didRewrite: !!(0, _requestmeta.getRequestMeta)(ctx.req, 'rewrittenPathname'),
                    rewrittenPathname: (0, _requestmeta.getRequestMeta)(ctx.req, 'rewrittenPathname')
                }, null, 2));
                throw err;
            }
            if (err instanceof _nofallbackerrorexternal.NoFallbackError && bubbleNoFallback) {
                throw err;
            }
            if (err instanceof _utils.DecodeError || err instanceof _utils.NormalizeError) {
                res.statusCode = 400;
                return await this.renderErrorToResponse(ctx, err);
            }
            res.statusCode = 500;
            // if pages/500 is present we still need to trigger
            // /_error `getInitialProps` to allow reporting error
            if (await this.hasPage('/500')) {
                (0, _requestmeta.addRequestMeta)(ctx.req, 'customErrorRender', true);
                await this.renderErrorToResponse(ctx, err);
                (0, _requestmeta.removeRequestMeta)(ctx.req, 'customErrorRender');
            }
            const isWrappedError = err instanceof WrappedBuildError;
            if (!isWrappedError) {
                if (this.minimalMode || this.dev) {
                    if ((0, _iserror.default)(err)) err.page = page;
                    throw err;
                }
                this.logError((0, _iserror.getProperError)(err));
            }
            const response = await this.renderErrorToResponse(ctx, isWrappedError ? err.innerError : err);
            return response;
        }
        const middleware = await this.getMiddleware();
        if (middleware && !!ctx.req.headers['x-nextjs-data'] && (!res.statusCode || res.statusCode === 200 || res.statusCode === 404)) {
            const locale = (0, _requestmeta.getRequestMeta)(req, 'locale');
            res.setHeader('x-nextjs-matched-path', `${locale ? `/${locale}` : ''}${pathname}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', _constants2.JSON_CONTENT_TYPE_HEADER);
            res.body('{}');
            res.send();
            return null;
        }
        res.statusCode = 404;
        return this.renderErrorToResponse(ctx, null);
    }
    async renderToHTML(req, res, pathname, query = {}) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.renderToHTML, async ()=>{
            return this.renderToHTMLImpl(req, res, pathname, query);
        });
    }
    async renderToHTMLImpl(req, res, pathname, query = {}) {
        return this.getStaticHTML((ctx)=>this.renderToResponse(ctx), {
            req,
            res,
            pathname,
            query
        });
    }
    async renderError(err, req, res, pathname, query = {}, setHeaders = true) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.renderError, async ()=>{
            return this.renderErrorImpl(err, req, res, pathname, query, setHeaders);
        });
    }
    async renderErrorImpl(err, req, res, pathname, query = {}, setHeaders = true) {
        if (setHeaders) {
            res.setHeader('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
        }
        return this.pipe(async (ctx)=>{
            const response = await this.renderErrorToResponse(ctx, err);
            if (this.minimalMode && res.statusCode === 500) {
                throw err;
            }
            return response;
        }, {
            req,
            res,
            pathname,
            query
        });
    }
    async renderErrorToResponse(ctx, err) {
        return (0, _tracer.getTracer)().trace(_constants1.BaseServerSpan.renderErrorToResponse, async ()=>{
            return this.renderErrorToResponseImpl(ctx, err);
        });
    }
    async renderErrorToResponseImpl(ctx, err) {
        // Short-circuit favicon.ico in development to avoid compiling 404 page when the app has no favicon.ico.
        // Since favicon.ico is automatically requested by the browser.
        if (this.dev && ctx.pathname === '/favicon.ico') {
            return {
                body: _renderresult.default.EMPTY
            };
        }
        const { res, query } = ctx;
        try {
            let result = null;
            const is404 = res.statusCode === 404;
            let using404Page = false;
            const hasAppDir = this.enabledDirectories.app;
            if (is404) {
                if (hasAppDir) {
                    // Use the not-found entry in app directory
                    result = await this.findPageComponents({
                        locale: (0, _requestmeta.getRequestMeta)(ctx.req, 'locale'),
                        page: _constants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY,
                        query,
                        params: {},
                        isAppPath: true,
                        shouldEnsure: true,
                        url: ctx.req.url
                    });
                    using404Page = result !== null;
                }
                if (!result && await this.hasPage('/404')) {
                    result = await this.findPageComponents({
                        locale: (0, _requestmeta.getRequestMeta)(ctx.req, 'locale'),
                        page: '/404',
                        query,
                        params: {},
                        isAppPath: false,
                        // Ensuring can't be done here because you never "match" a 404 route.
                        shouldEnsure: true,
                        url: ctx.req.url
                    });
                    using404Page = result !== null;
                }
            }
            let statusPage = `/${res.statusCode}`;
            if (!(0, _requestmeta.getRequestMeta)(ctx.req, 'customErrorRender') && !result && _constants.STATIC_STATUS_PAGES.includes(statusPage)) {
                // skip ensuring /500 in dev mode as it isn't used and the
                // dev overlay is used instead
                if (statusPage !== '/500' || !this.dev) {
                    if (!result && hasAppDir) {
                        // Otherwise if app router present, load app router built-in 500 page
                        result = await this.findPageComponents({
                            locale: (0, _requestmeta.getRequestMeta)(ctx.req, 'locale'),
                            page: statusPage,
                            query,
                            params: {},
                            isAppPath: true,
                            // Ensuring can't be done here because you never "match" a 500
                            // route.
                            shouldEnsure: true,
                            url: ctx.req.url
                        });
                    }
                    // If the above App Router result is empty, fallback to pages router 500 page
                    result = await this.findPageComponents({
                        locale: (0, _requestmeta.getRequestMeta)(ctx.req, 'locale'),
                        page: statusPage,
                        query,
                        params: {},
                        isAppPath: false,
                        // Ensuring can't be done here because you never "match" a 500
                        // route.
                        shouldEnsure: true,
                        url: ctx.req.url
                    });
                }
            }
            if (!result) {
                result = await this.findPageComponents({
                    locale: (0, _requestmeta.getRequestMeta)(ctx.req, 'locale'),
                    page: '/_error',
                    query,
                    params: {},
                    isAppPath: false,
                    // Ensuring can't be done here because you never "match" an error
                    // route.
                    shouldEnsure: true,
                    url: ctx.req.url
                });
                statusPage = '/_error';
            }
            if (process.env.NODE_ENV !== 'production' && !using404Page && await this.hasPage('/_error') && !await this.hasPage('/404')) {
                this.customErrorNo404Warn();
            }
            if (!result) {
                // this can occur when a project directory has been moved/deleted
                // which is handled in the parent process in development
                if (this.dev) {
                    return {
                        // wait for dev-server to restart before refreshing
                        body: _renderresult.default.fromStatic(`
              <pre>missing required error components, refreshing...</pre>
              <script>
                async function check() {
                  const res = await fetch(location.href).catch(() => ({}))

                  if (res.status === 200) {
                    location.reload()
                  } else {
                    setTimeout(check, 1000)
                  }
                }
                check()
              </script>`, _constants2.HTML_CONTENT_TYPE_HEADER)
                    };
                }
                throw new WrappedBuildError(Object.defineProperty(new Error('missing required error components'), "__NEXT_ERROR_CODE", {
                    value: "E60",
                    enumerable: false,
                    configurable: true
                }));
            }
            // If the page has a route module, use it for the new match. If it doesn't
            // have a route module, remove the match.
            if (result.components.routeModule) {
                (0, _requestmeta.addRequestMeta)(ctx.req, 'match', {
                    definition: result.components.routeModule.definition,
                    params: undefined
                });
            } else {
                (0, _requestmeta.removeRequestMeta)(ctx.req, 'match');
            }
            try {
                return await this.renderToResponseWithComponents({
                    ...ctx,
                    pathname: statusPage,
                    renderOpts: {
                        ...ctx.renderOpts,
                        err
                    }
                }, result);
            } catch (maybeFallbackError) {
                if (maybeFallbackError instanceof _nofallbackerrorexternal.NoFallbackError) {
                    throw Object.defineProperty(new Error('invariant: failed to render error page'), "__NEXT_ERROR_CODE", {
                        value: "E55",
                        enumerable: false,
                        configurable: true
                    });
                }
                throw maybeFallbackError;
            }
        } catch (error) {
            const renderToHtmlError = (0, _iserror.getProperError)(error);
            const isWrappedError = renderToHtmlError instanceof WrappedBuildError;
            if (!isWrappedError) {
                this.logError(renderToHtmlError);
            }
            res.statusCode = 500;
            const fallbackComponents = await this.getFallbackErrorComponents(ctx.req.url);
            if (fallbackComponents) {
                // There was an error, so use it's definition from the route module
                // to add the match to the request.
                (0, _requestmeta.addRequestMeta)(ctx.req, 'match', {
                    definition: fallbackComponents.routeModule.definition,
                    params: undefined
                });
                return this.renderToResponseWithComponents({
                    ...ctx,
                    pathname: '/_error',
                    renderOpts: {
                        ...ctx.renderOpts,
                        // We render `renderToHtmlError` here because `err` is
                        // already captured in the stacktrace.
                        err: isWrappedError ? renderToHtmlError.innerError : renderToHtmlError
                    }
                }, {
                    query,
                    components: fallbackComponents
                });
            }
            return {
                body: _renderresult.default.fromStatic('Internal Server Error', 'text/plain')
            };
        }
    }
    async renderErrorToHTML(err, req, res, pathname, query = {}) {
        return this.getStaticHTML((ctx)=>this.renderErrorToResponse(ctx, err), {
            req,
            res,
            pathname,
            query
        });
    }
    async render404(req, res, parsedUrl, setHeaders = true) {
        const { pathname, query } = parsedUrl ? parsedUrl : (0, _parseurl.parseUrl)(req.url);
        // Ensure the locales are provided on the request meta.
        if (this.nextConfig.i18n) {
            if (!(0, _requestmeta.getRequestMeta)(req, 'locale')) {
                (0, _requestmeta.addRequestMeta)(req, 'locale', this.nextConfig.i18n.defaultLocale);
            }
            (0, _requestmeta.addRequestMeta)(req, 'defaultLocale', this.nextConfig.i18n.defaultLocale);
        }
        res.statusCode = 404;
        return this.renderError(null, req, res, pathname, query, setHeaders);
    }
}

//# sourceMappingURL=base-server.js.map