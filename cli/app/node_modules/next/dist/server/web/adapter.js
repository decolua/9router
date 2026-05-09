"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    NextRequestHint: null,
    adapter: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    NextRequestHint: function() {
        return NextRequestHint;
    },
    adapter: function() {
        return adapter;
    }
});
const _error = require("./error");
const _utils = require("./utils");
const _fetchevent = require("./spec-extension/fetch-event");
const _request = require("./spec-extension/request");
const _response = require("./spec-extension/response");
const _relativizeurl = require("../../shared/lib/router/utils/relativize-url");
const _nexturl = require("./next-url");
const _internalutils = require("../internal-utils");
const _apppaths = require("../../shared/lib/router/utils/app-paths");
const _approuterheaders = require("../../client/components/app-router-headers");
const _globals = require("./globals");
const _requeststore = require("../async-storage/request-store");
const _workunitasyncstorageexternal = require("../app-render/work-unit-async-storage.external");
const _workstore = require("../async-storage/work-store");
const _workasyncstorageexternal = require("../app-render/work-async-storage.external");
const _tracer = require("../lib/trace/tracer");
const _constants = require("../lib/trace/constants");
const _webonclose = require("./web-on-close");
const _getedgepreviewprops = require("./get-edge-preview-props");
const _builtinrequestcontext = require("../after/builtin-request-context");
const _implicittags = require("../lib/implicit-tags");
const _requestmeta = require("../request-meta");
class NextRequestHint extends _request.NextRequest {
    constructor(params){
        super(params.input, params.init);
        this.sourcePage = params.page;
    }
    get request() {
        throw Object.defineProperty(new _error.PageSignatureError({
            page: this.sourcePage
        }), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    respondWith() {
        throw Object.defineProperty(new _error.PageSignatureError({
            page: this.sourcePage
        }), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    waitUntil() {
        throw Object.defineProperty(new _error.PageSignatureError({
            page: this.sourcePage
        }), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
}
const headersGetter = {
    keys: (headers)=>Array.from(headers.keys()),
    get: (headers, key)=>headers.get(key) ?? undefined
};
let propagator = (request, fn)=>{
    const tracer = (0, _tracer.getTracer)();
    return tracer.withPropagatedContext(request.headers, fn, headersGetter);
};
let testApisIntercepted = false;
function ensureTestApisIntercepted() {
    if (!testApisIntercepted) {
        testApisIntercepted = true;
        if (process.env.NEXT_PRIVATE_TEST_PROXY === 'true') {
            const { interceptTestApis, wrapRequestHandler } = // eslint-disable-next-line @next/internal/typechecked-require -- experimental/testmode is not built ins next/dist/esm
            require('next/dist/experimental/testmode/server-edge');
            interceptTestApis();
            propagator = wrapRequestHandler(propagator);
        }
    }
}
async function adapter(params) {
    var _getBuiltinRequestContext;
    ensureTestApisIntercepted();
    await (0, _globals.ensureInstrumentationRegistered)();
    // TODO-APP: use explicit marker for this
    const isEdgeRendering = typeof globalThis.__BUILD_MANIFEST !== 'undefined';
    params.request.url = (0, _apppaths.normalizeRscURL)(params.request.url);
    const requestURL = params.bypassNextUrl ? new URL(params.request.url) : new _nexturl.NextURL(params.request.url, {
        headers: params.request.headers,
        nextConfig: params.request.nextConfig
    });
    // Iterator uses an index to keep track of the current iteration. Because of deleting and appending below we can't just use the iterator.
    // Instead we use the keys before iteration.
    const keys = [
        ...requestURL.searchParams.keys()
    ];
    for (const key of keys){
        const value = requestURL.searchParams.getAll(key);
        const normalizedKey = (0, _utils.normalizeNextQueryParam)(key);
        if (normalizedKey) {
            requestURL.searchParams.delete(normalizedKey);
            for (const val of value){
                requestURL.searchParams.append(normalizedKey, val);
            }
            requestURL.searchParams.delete(key);
        }
    }
    // Ensure users only see page requests, never data requests.
    let buildId = process.env.__NEXT_BUILD_ID || '';
    if ('buildId' in requestURL) {
        buildId = requestURL.buildId || '';
        requestURL.buildId = '';
    }
    const requestHeaders = (0, _utils.fromNodeOutgoingHttpHeaders)(params.request.headers);
    const isNextDataRequest = requestHeaders.has('x-nextjs-data');
    const isRSCRequest = requestHeaders.get(_approuterheaders.RSC_HEADER) === '1';
    if (isNextDataRequest && requestURL.pathname === '/index') {
        requestURL.pathname = '/';
    }
    const flightHeaders = new Map();
    // Headers should only be stripped for middleware
    if (!isEdgeRendering && !process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE) {
        for (const header of _approuterheaders.FLIGHT_HEADERS){
            const value = requestHeaders.get(header);
            if (value !== null) {
                flightHeaders.set(header, value);
                requestHeaders.delete(header);
            }
        }
    }
    const normalizeURL = process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE ? new URL(params.request.url) : requestURL;
    const rscHash = normalizeURL.searchParams.get(_approuterheaders.NEXT_RSC_UNION_QUERY);
    const request = new NextRequestHint({
        page: params.page,
        // Strip internal query parameters off the request.
        input: process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE ? normalizeURL.toString() : (0, _internalutils.stripInternalSearchParams)(normalizeURL).toString(),
        init: {
            body: params.request.body,
            headers: requestHeaders,
            method: params.request.method,
            nextConfig: params.request.nextConfig,
            signal: params.request.signal
        }
    });
    if (params.request.requestMeta) {
        (0, _requestmeta.setRequestMeta)(request, params.request.requestMeta);
    }
    /**
   * This allows to identify the request as a data request. The user doesn't
   * need to know about this property neither use it. We add it for testing
   * purposes.
   */ if (isNextDataRequest) {
        Object.defineProperty(request, '__isData', {
            enumerable: false,
            value: true
        });
    }
    if (// If we are inside of the next start sandbox
    // leverage the shared instance if not we need
    // to create a fresh cache instance each time
    !globalThis.__incrementalCacheShared && params.IncrementalCache) {
        ;
        globalThis.__incrementalCache = new params.IncrementalCache({
            CurCacheHandler: params.incrementalCacheHandler,
            minimalMode: process.env.NODE_ENV !== 'development',
            fetchCacheKeyPrefix: process.env.__NEXT_FETCH_CACHE_KEY_PREFIX,
            dev: process.env.NODE_ENV === 'development',
            requestHeaders: params.request.headers,
            getPrerenderManifest: ()=>{
                return {
                    version: -1,
                    routes: {},
                    dynamicRoutes: {},
                    notFoundRoutes: [],
                    preview: (0, _getedgepreviewprops.getEdgePreviewProps)()
                };
            }
        });
    }
    // if we're in an edge runtime sandbox, we should use the waitUntil
    // that we receive from the enclosing NextServer
    const outerWaitUntil = params.request.waitUntil ?? ((_getBuiltinRequestContext = (0, _builtinrequestcontext.getBuiltinRequestContext)()) == null ? void 0 : _getBuiltinRequestContext.waitUntil);
    const event = new _fetchevent.NextFetchEvent({
        request,
        page: params.page,
        context: outerWaitUntil ? {
            waitUntil: outerWaitUntil
        } : undefined
    });
    let response;
    let cookiesFromResponse;
    response = await propagator(request, ()=>{
        // we only care to make async storage available for middleware
        const isMiddleware = params.page === '/middleware' || params.page === '/src/middleware' || params.page === '/proxy' || params.page === '/src/proxy';
        if (isMiddleware) {
            // if we're in an edge function, we only get a subset of `nextConfig` (no `experimental`),
            // so we have to inject it via DefinePlugin.
            // in `next start` this will be passed normally (see `NextNodeServer.runMiddleware`).
            const waitUntil = event.waitUntil.bind(event);
            const closeController = new _webonclose.CloseController();
            return (0, _tracer.getTracer)().trace(_constants.MiddlewareSpan.execute, {
                spanName: `middleware ${request.method}`,
                attributes: {
                    'http.target': request.nextUrl.pathname,
                    'http.method': request.method
                }
            }, async ()=>{
                try {
                    var _params_request_nextConfig_experimental, _params_request_nextConfig, _params_request_nextConfig_experimental1, _params_request_nextConfig1;
                    const onUpdateCookies = (cookies)=>{
                        cookiesFromResponse = cookies;
                    };
                    const previewProps = (0, _getedgepreviewprops.getEdgePreviewProps)();
                    const page = '/' // Fake Work
                    ;
                    const fallbackRouteParams = null;
                    const implicitTags = await (0, _implicittags.getImplicitTags)(page, request.nextUrl.pathname, fallbackRouteParams);
                    const requestStore = (0, _requeststore.createRequestStoreForAPI)(request, request.nextUrl, implicitTags, onUpdateCookies, previewProps);
                    const workStore = (0, _workstore.createWorkStore)({
                        page,
                        renderOpts: {
                            cacheLifeProfiles: (_params_request_nextConfig = params.request.nextConfig) == null ? void 0 : (_params_request_nextConfig_experimental = _params_request_nextConfig.experimental) == null ? void 0 : _params_request_nextConfig_experimental.cacheLife,
                            cacheComponents: false,
                            experimental: {
                                isRoutePPREnabled: false,
                                authInterrupts: !!((_params_request_nextConfig1 = params.request.nextConfig) == null ? void 0 : (_params_request_nextConfig_experimental1 = _params_request_nextConfig1.experimental) == null ? void 0 : _params_request_nextConfig_experimental1.authInterrupts)
                            },
                            supportsDynamicResponse: true,
                            waitUntil,
                            onClose: closeController.onClose.bind(closeController),
                            onAfterTaskError: undefined
                        },
                        isPrefetchRequest: request.headers.get(_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER) === '1',
                        buildId: buildId ?? '',
                        previouslyRevalidatedTags: []
                    });
                    return await _workasyncstorageexternal.workAsyncStorage.run(workStore, ()=>_workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, params.handler, request, event));
                } finally{
                    // middleware cannot stream, so we can consider the response closed
                    // as soon as the handler returns.
                    // we can delay running it until a bit later --
                    // if it's needed, we'll have a `waitUntil` lock anyway.
                    setTimeout(()=>{
                        closeController.dispatchClose();
                    }, 0);
                }
            });
        }
        return params.handler(request, event);
    });
    // check if response is a Response object
    if (response && !(response instanceof Response)) {
        throw Object.defineProperty(new TypeError('Expected an instance of Response to be returned'), "__NEXT_ERROR_CODE", {
            value: "E567",
            enumerable: false,
            configurable: true
        });
    }
    if (response && cookiesFromResponse) {
        response.headers.set('set-cookie', cookiesFromResponse);
    }
    /**
   * For rewrites we must always include the locale in the final pathname
   * so we re-create the NextURL forcing it to include it when the it is
   * an internal rewrite. Also we make sure the outgoing rewrite URL is
   * a data URL if the request was a data request.
   */ const rewrite = response == null ? void 0 : response.headers.get('x-middleware-rewrite');
    if (response && rewrite && (isRSCRequest || !isEdgeRendering)) {
        var _params_request_nextConfig_experimental_clientParamParsingOrigins, _params_request_nextConfig_experimental, _params_request_nextConfig;
        const destination = new _nexturl.NextURL(rewrite, {
            forceLocale: true,
            headers: params.request.headers,
            nextConfig: params.request.nextConfig
        });
        if (!process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE && !isEdgeRendering) {
            if (destination.host === request.nextUrl.host) {
                destination.buildId = buildId || destination.buildId;
                response.headers.set('x-middleware-rewrite', String(destination));
            }
        }
        /**
     * When the request is a data request we must show if there was a rewrite
     * with an internal header so the client knows which component to load
     * from the data request.
     */ const { url: relativeDestination, isRelative } = (0, _relativizeurl.parseRelativeURL)(destination.toString(), requestURL.toString());
        if (!isEdgeRendering && isNextDataRequest && // if the rewrite is external and external rewrite
        // resolving config is enabled don't add this header
        // so the upstream app can set it instead
        !(process.env.__NEXT_EXTERNAL_MIDDLEWARE_REWRITE_RESOLVE && relativeDestination.match(/http(s)?:\/\//))) {
            response.headers.set('x-nextjs-rewrite', relativeDestination);
        }
        // Check to see if this is a non-relative rewrite. If it is, we need
        // to check to see if it's an allowed origin to receive the rewritten
        // headers.
        const isAllowedOrigin = !isRelative ? (_params_request_nextConfig = params.request.nextConfig) == null ? void 0 : (_params_request_nextConfig_experimental = _params_request_nextConfig.experimental) == null ? void 0 : (_params_request_nextConfig_experimental_clientParamParsingOrigins = _params_request_nextConfig_experimental.clientParamParsingOrigins) == null ? void 0 : _params_request_nextConfig_experimental_clientParamParsingOrigins.some((origin)=>new RegExp(origin).test(destination.origin)) : false;
        // If this is an RSC request, and the pathname or search has changed, and
        // this isn't an external rewrite, we need to set the rewritten pathname and
        // query headers.
        if (isRSCRequest && (isRelative || isAllowedOrigin)) {
            if (requestURL.pathname !== destination.pathname) {
                response.headers.set(_approuterheaders.NEXT_REWRITTEN_PATH_HEADER, destination.pathname);
            }
            if (requestURL.search !== destination.search) {
                response.headers.set(_approuterheaders.NEXT_REWRITTEN_QUERY_HEADER, // remove the leading ? from the search string
                destination.search.slice(1));
            }
        }
    }
    /**
   * Always forward the `_rsc` search parameter to the rewritten URL for RSC requests,
   * unless it's already present. This is necessary to ensure that RSC hash validation
   * works correctly after a rewrite. For internal rewrites, the server can validate the
   * RSC hash using the original URL, so forwarding the `_rsc` parameter is less critical.
   * However, for external rewrites (where the request is proxied to another Next.js server),
   * the external server does not have access to the original URL or its search parameters.
   * In these cases, forwarding the `_rsc` parameter is essential so that the external server
   * can perform the correct RSC hash validation.
   */ if (response && rewrite && isRSCRequest && rscHash) {
        const rewriteURL = new URL(rewrite);
        if (!rewriteURL.searchParams.has(_approuterheaders.NEXT_RSC_UNION_QUERY)) {
            rewriteURL.searchParams.set(_approuterheaders.NEXT_RSC_UNION_QUERY, rscHash);
            response.headers.set('x-middleware-rewrite', rewriteURL.toString());
        }
    }
    /**
   * For redirects we will not include the locale in case when it is the
   * default and we must also make sure the outgoing URL is a data one if
   * the incoming request was a data request.
   */ const redirect = response == null ? void 0 : response.headers.get('Location');
    if (response && redirect && !isEdgeRendering) {
        const redirectURL = new _nexturl.NextURL(redirect, {
            forceLocale: false,
            headers: params.request.headers,
            nextConfig: params.request.nextConfig
        });
        /**
     * Responses created from redirects have immutable headers so we have
     * to clone the response to be able to modify it.
     */ response = new Response(response.body, response);
        if (!process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE) {
            if (redirectURL.host === requestURL.host) {
                redirectURL.buildId = buildId || redirectURL.buildId;
                response.headers.set('Location', (0, _relativizeurl.getRelativeURL)(redirectURL, requestURL));
            }
        }
        /**
     * When the request is a data request we can't use the location header as
     * it may end up with CORS error. Instead we map to an internal header so
     * the client knows the destination.
     */ if (isNextDataRequest) {
            response.headers.delete('Location');
            response.headers.set('x-nextjs-redirect', (0, _relativizeurl.getRelativeURL)(redirectURL.toString(), requestURL.toString()));
        }
    }
    const finalResponse = response ? response : _response.NextResponse.next();
    // Flight headers are not overridable / removable so they are applied at the end.
    const middlewareOverrideHeaders = finalResponse.headers.get('x-middleware-override-headers');
    const overwrittenHeaders = [];
    if (middlewareOverrideHeaders) {
        for (const [key, value] of flightHeaders){
            finalResponse.headers.set(`x-middleware-request-${key}`, value);
            overwrittenHeaders.push(key);
        }
        if (overwrittenHeaders.length > 0) {
            finalResponse.headers.set('x-middleware-override-headers', middlewareOverrideHeaders + ',' + overwrittenHeaders.join(','));
        }
    }
    return {
        response: finalResponse,
        waitUntil: (0, _fetchevent.getWaitUntilPromiseFromEvent)(event) ?? Promise.resolve(),
        fetchMetrics: request.fetchMetrics
    };
}

//# sourceMappingURL=adapter.js.map