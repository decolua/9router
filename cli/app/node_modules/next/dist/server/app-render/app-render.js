"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "renderToHTMLOrFlight", {
    enumerable: true,
    get: function() {
        return renderToHTMLOrFlight;
    }
});
const _jsxruntime = require("react/jsx-runtime");
const _workasyncstorageexternal = require("../app-render/work-async-storage.external");
const _react = /*#__PURE__*/ _interop_require_wildcard(require("react"));
const _renderresult = /*#__PURE__*/ _interop_require_default(require("../render-result"));
const _streamops = require("./stream-ops");
const _internalutils = require("../internal-utils");
const _approuterheaders = require("../../client/components/app-router-headers");
const _metadatacontext = require("../../lib/metadata/metadata-context");
const _requeststore = require("../async-storage/request-store");
const _workstore = require("../async-storage/work-store");
const _httpaccessfallback = require("../../client/components/http-access-fallback/http-access-fallback");
const _redirect = require("../../client/components/redirect");
const _redirecterror = require("../../client/components/redirect-error");
const _implicittags = require("../lib/implicit-tags");
const _constants = require("../lib/trace/constants");
const _tracer = require("../lib/trace/tracer");
const _flightrenderresult = require("./flight-render-result");
const _createerrorhandler = require("./create-error-handler");
const _getshortdynamicparamtype = require("./get-short-dynamic-param-type");
const _getsegmentparam = require("../../shared/lib/router/utils/get-segment-param");
const _getscriptnoncefromheader = require("./get-script-nonce-from-header");
const _parseandvalidateflightrouterstate = require("./parse-and-validate-flight-router-state");
const _createflightrouterstatefromloadertree = require("./create-flight-router-state-from-loader-tree");
const _actionhandler = require("./action-handler");
const _bailouttocsr = require("../../shared/lib/lazy-dynamic/bailout-to-csr");
const _log = require("../../build/output/log");
const _requestcookies = require("../web/spec-extension/adapters/request-cookies");
const _serverinsertedhtml = require("./server-inserted-html");
const _requiredscripts = require("./required-scripts");
const _addpathprefix = require("../../shared/lib/router/utils/add-path-prefix");
const _makegetserverinsertedhtml = require("./make-get-server-inserted-html");
const _walktreewithflightrouterstate = require("./walk-tree-with-flight-router-state");
const _createcomponenttree = require("./create-component-tree");
const _getassetquerystring = require("./get-asset-query-string");
const _manifestssingleton = require("./manifests-singleton");
const _postponedstate = require("./postponed-state");
const _hooksservercontext = require("../../client/components/hooks-server-context");
const _useflightresponse = require("./use-flight-response");
const _staticgenerationbailout = require("../../client/components/static-generation-bailout");
const _formatservererror = require("../../lib/format-server-error");
const _errortelemetryutils = require("../../lib/error-telemetry-utils");
const _dynamicrendering = require("./dynamic-rendering");
const _clientcomponentrendererlogger = require("../client-component-renderer-logger");
const _helpers = require("../base-http/helpers");
const _parserelativeurl = require("../../shared/lib/router/utils/parse-relative-url");
const _approuter = /*#__PURE__*/ _interop_require_default(require("../../client/components/app-router"));
const _serveractionrequestmeta = require("../lib/server-action-request-meta");
const _createinitialrouterstate = require("../../client/components/router-reducer/create-initial-router-state");
const _approuterinstance = require("../../client/components/app-router-instance");
const _utils = require("../instrumentation/utils");
const _segment = require("../../shared/lib/segment");
const _fallbackparams = require("../request/fallback-params");
const _apprenderprerenderutils = require("./app-render-prerender-utils");
const _prospectiverenderutils = require("./prospective-render-utils");
const _apprenderrenderutils = require("./app-render-render-utils");
const _scheduler = require("../../lib/scheduler");
const _workunitasyncstorageexternal = require("./work-unit-async-storage.external");
const _consoleasyncstorageexternal = require("./console-async-storage.external");
const _cachesignal = require("./cache-signal");
const _varyparams = require("./vary-params");
const _utils1 = require("../lib/trace/utils");
const _invarianterror = require("../../shared/lib/invariant-error");
const _staletime = require("./stale-time");
const _constants1 = require("../../lib/constants");
const _createcomponentstylesandscripts = require("./create-component-styles-and-scripts");
const _parseloadertree = require("../../shared/lib/router/utils/parse-loader-tree");
const _resumedatacache = require("../resume-data-cache/resume-data-cache");
const _iserror = /*#__PURE__*/ _interop_require_default(require("../../lib/is-error"));
const _createserverinsertedmetadata = require("./metadata-insertion/create-server-inserted-metadata");
const _serverutils = require("../server-utils");
const _revalidationutils = require("../revalidation-utils");
const _trackmoduleloadingexternal = require("./module-loading/track-module-loading.external");
const _reactlargeshellerror = require("./react-large-shell-error");
const _segmentexplorerpath = require("./segment-explorer-path");
const _requestmeta = require("../request-meta");
const _getdynamicparam = require("../../shared/lib/router/utils/get-dynamic-param");
const _imageconfigcontextsharedruntime = require("../../shared/lib/image-config-context.shared-runtime");
const _imageconfig = require("../../shared/lib/image-config");
const _stagedrendering = require("./staged-rendering");
const _instantconfig = require("./instant-validation/instant-config");
const _warnonce = require("../../shared/lib/utils/warn-once");
const _debugchannelserver = require("./debug-channel-server");
const _streamutils = require("./instant-validation/stream-utils");
const _boundarytracking = require("./instant-validation/boundary-tracking");
const _cookies = require("../web/spec-extension/cookies");
const _instantvalidationerror = require("./instant-validation/instant-validation-error");
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
function maybeAppendBuildIdToRSCPayload(ctx, payload) {
    if (!ctx.sharedContext.deploymentId) {
        // When using the build id, we need to initialize the id on initial page load, so a build id
        // header wouldn't be enough.
        payload.b = ctx.sharedContext.buildId;
    }
    return payload;
}
const flightDataPathHeadKey = 'h';
const getFlightViewportKey = (requestId)=>requestId + 'v';
const getFlightMetadataKey = (requestId)=>requestId + 'm';
const filterStackFrame = process.env.NODE_ENV !== 'production' ? require('../lib/source-maps').filterStackFrameDEV : undefined;
function parseRequestHeaders(headers, options) {
    // runtime prefetch requests are *not* treated as prefetch requests
    // (TODO: this is confusing, we should refactor this to express this better)
    const isPrefetchRequest = headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER] === '1';
    const isRuntimePrefetchRequest = headers[_approuterheaders.NEXT_ROUTER_PREFETCH_HEADER] === '2';
    const isHmrRefresh = headers[_approuterheaders.NEXT_HMR_REFRESH_HEADER] !== undefined;
    const isRSCRequest = headers[_approuterheaders.RSC_HEADER] !== undefined;
    const shouldProvideFlightRouterState = isRSCRequest && (!isPrefetchRequest || !options.isRoutePPREnabled);
    const flightRouterState = shouldProvideFlightRouterState ? (0, _parseandvalidateflightrouterstate.parseAndValidateFlightRouterState)(headers[_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER]) : undefined;
    // Checks if this is a prefetch of the Route Tree by the Segment Cache
    const isRouteTreePrefetchRequest = headers[_approuterheaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER] === '/_tree';
    const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
    const nonce = typeof csp === 'string' ? (0, _getscriptnoncefromheader.getScriptNonceFromHeader)(csp) : undefined;
    const previouslyRevalidatedTags = (0, _serverutils.getPreviouslyRevalidatedTags)(headers, options.previewModeId);
    let requestId;
    let htmlRequestId;
    if (process.env.__NEXT_DEV_SERVER) {
        // The request IDs are only used for the dev server to send debug
        // information to the matching client (identified by the HTML request ID
        // that was sent to the client with the HTML document) for the current
        // request (identified by the request ID, as defined by the client).
        requestId = typeof headers[_approuterheaders.NEXT_REQUEST_ID_HEADER] === 'string' ? headers[_approuterheaders.NEXT_REQUEST_ID_HEADER] : undefined;
        htmlRequestId = typeof headers[_approuterheaders.NEXT_HTML_REQUEST_ID_HEADER] === 'string' ? headers[_approuterheaders.NEXT_HTML_REQUEST_ID_HEADER] : undefined;
    }
    return {
        flightRouterState,
        isPrefetchRequest,
        isRuntimePrefetchRequest,
        isRouteTreePrefetchRequest,
        isHmrRefresh,
        isRSCRequest,
        nonce,
        previouslyRevalidatedTags,
        requestId,
        htmlRequestId
    };
}
/**
 * Walks the loader tree to find the minimum `unstable_dynamicStaleTime` exported by
 * any page module. Returns null if no page exports the config.
 *
 * This only reads static exports from page modules — it does not render any
 * server components, so it's cheap to call.
 *
 * TODO: Move this to the prefetch hints file so we don't have to walk the
 * tree on every render.
 */ async function getDynamicStaleTime(tree) {
    const { page, parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
    let result = null;
    // Only pages (not layouts) can export unstable_dynamicStaleTime.
    if (typeof page !== 'undefined') {
        const pageMod = await page[0]();
        if (pageMod && typeof pageMod.unstable_dynamicStaleTime === 'number') {
            const value = pageMod.unstable_dynamicStaleTime;
            result = result !== null ? Math.min(result, value) : value;
        }
    }
    const childPromises = [];
    for(const parallelRouteKey in parallelRoutes){
        childPromises.push(getDynamicStaleTime(parallelRoutes[parallelRouteKey]));
    }
    const childResults = await Promise.all(childPromises);
    for (const childResult of childResults){
        if (childResult !== null) {
            result = result !== null ? Math.min(result, childResult) : childResult;
        }
    }
    return result;
}
function createNotFoundLoaderTree(loaderTree) {
    const components = loaderTree[2];
    const hasGlobalNotFound = !!components['global-not-found'];
    const notFoundTreeComponents = hasGlobalNotFound ? {
        layout: components['global-not-found'],
        page: [
            ()=>null,
            'next/dist/client/components/builtin/empty-stub'
        ]
    } : {
        page: components['not-found']
    };
    return [
        '',
        {
            children: [
                _segment.PAGE_SEGMENT_KEY,
                {},
                notFoundTreeComponents,
                null
            ]
        },
        // Always include global-error so that getGlobalErrorStyles can access it.
        // When global-not-found is present, use full components.
        // Otherwise, only include global-error module.
        hasGlobalNotFound ? components : {
            'global-error': components['global-error']
        },
        null
    ];
}
/**
 * Returns a function that parses the dynamic segment and return the associated value.
 */ function makeGetDynamicParamFromSegment(interpolatedParams, fallbackRouteParams, optimisticRouting) {
    return function getDynamicParamFromSegment(loaderTree) {
        const [segment, , , staticSiblings] = loaderTree;
        const segmentParam = (0, _getsegmentparam.getSegmentParam)(segment);
        if (!segmentParam) {
            return null;
        }
        const segmentKey = segmentParam.paramName;
        const dynamicParamType = _getshortdynamicparamtype.dynamicParamTypes[segmentParam.paramType];
        // Static siblings are only included when optimistic routing is enabled
        const siblings = optimisticRouting ? staticSiblings : null;
        return (0, _getdynamicparam.getDynamicParam)(interpolatedParams, segmentKey, dynamicParamType, fallbackRouteParams, siblings);
    };
}
function NonIndex({ createElement, pagePath, statusCode, isPossibleServerAction }) {
    const is404Page = pagePath === '/404';
    const isInvalidStatusCode = typeof statusCode === 'number' && statusCode > 400;
    // Only render noindex for page request, skip for server actions
    // TODO: is this correct if `isPossibleServerAction` is a false positive?
    if (!isPossibleServerAction && (is404Page || isInvalidStatusCode)) {
        return createElement('meta', {
            name: 'robots',
            content: 'noindex'
        });
    }
    return null;
}
/**
 * This is used by server actions & client-side navigations to generate RSC data from a client-side request.
 * This function is only called on "dynamic" requests (ie, there wasn't already a static response).
 * It uses request headers (namely `next-router-state-tree`) to determine where to start rendering.
 */ async function generateDynamicRSCPayload(ctx, options) {
    // Flight data that is going to be passed to the browser.
    // Currently a single item array but in the future multiple patches might be combined in a single request.
    // We initialize `flightData` to an empty string because the client router knows how to tolerate
    // it (treating it as an MPA navigation). The only time this function wouldn't generate flight data
    // is for server actions, if the server action handler instructs this function to skip it. When the server
    // action reducer sees a falsy value, it'll simply resolve the action with no data.
    let flightData = '';
    const { componentMod: { routeModule: { userland: { loaderTree } }, createElement, createMetadataComponents, Fragment }, query, requestId, flightRouterState, workStore, url } = ctx;
    const serveStreamingMetadata = !!ctx.renderOpts.serveStreamingMetadata;
    if (!(options == null ? void 0 : options.skipPageRendering)) {
        var _ctx_renderOpts_prefetchHints;
        const preloadCallbacks = [];
        // If we're performing instant validation, we need to render the whole tree,
        // without skipping shared layouts.
        const needsFullTree = process.env.__NEXT_DEV_SERVER && ctx.renderOpts.cacheComponents && !(options == null ? void 0 : options.actionResult) && // Only for navigations
        await (0, _instantconfig.anySegmentNeedsInstantValidationInDev)(loaderTree);
        const metadataIsRuntimePrefetchable = await (0, _instantconfig.anySegmentHasRuntimePrefetchEnabled)(loaderTree);
        const { Viewport, Metadata, MetadataOutlet } = createMetadataComponents({
            tree: loaderTree,
            parsedQuery: query,
            pathname: url.pathname,
            metadataContext: (0, _metadatacontext.createMetadataContext)(ctx.renderOpts),
            interpolatedParams: ctx.interpolatedParams,
            serveStreamingMetadata,
            isRuntimePrefetchable: metadataIsRuntimePrefetchable
        });
        const rscHead = createElement(Fragment, {
            key: flightDataPathHeadKey
        }, createElement(NonIndex, {
            createElement,
            pagePath: ctx.pagePath,
            statusCode: ctx.res.statusCode,
            isPossibleServerAction: ctx.isPossibleServerAction
        }), createElement(Viewport, {
            key: getFlightViewportKey(requestId)
        }), createElement(Metadata, {
            key: getFlightMetadataKey(requestId)
        }));
        flightData = (needsFullTree ? await (0, _walktreewithflightrouterstate.createFullTreeFlightDataForNavigation)({
            ctx,
            loaderTree,
            rscHead,
            injectedCSS: new Set(),
            injectedJS: new Set(),
            injectedFontPreloadTags: new Set(),
            preloadCallbacks,
            MetadataOutlet
        }) : await (0, _walktreewithflightrouterstate.walkTreeWithFlightRouterState)({
            ctx,
            loaderTreeToFilter: loaderTree,
            parentParams: {},
            flightRouterState,
            rscHead,
            injectedCSS: new Set(),
            injectedJS: new Set(),
            injectedFontPreloadTags: new Set(),
            rootLayoutIncluded: false,
            preloadCallbacks,
            MetadataOutlet,
            hintTree: ((_ctx_renderOpts_prefetchHints = ctx.renderOpts.prefetchHints) == null ? void 0 : _ctx_renderOpts_prefetchHints[ctx.pagePath]) ?? null
        })).map((path)=>path.slice(1)) // remove the '' (root) segment
        ;
    }
    // In dev, the Vary header may not reliably reflect whether a route can
    // be intercepted, because interception routes are compiled on demand.
    // Default to true so the client doesn't cache a stale Fallback entry.
    const varyHeader = ctx.res.getHeader('vary');
    const couldBeIntercepted = !!process.env.__NEXT_DEV_SERVER || typeof varyHeader === 'string' && varyHeader.includes(_approuterheaders.NEXT_URL);
    // If we have an action result, then this is a server action response.
    // We can rely on this because `ActionResult` will always be a promise, even if
    // the result is falsey.
    if (options == null ? void 0 : options.actionResult) {
        return maybeAppendBuildIdToRSCPayload(ctx, {
            a: options.actionResult,
            f: flightData,
            q: getRenderedSearch(query),
            i: !!couldBeIntercepted
        });
    }
    // Otherwise, it's a regular RSC response.
    const baseResponse = maybeAppendBuildIdToRSCPayload(ctx, {
        f: flightData,
        q: getRenderedSearch(query),
        i: !!couldBeIntercepted,
        S: workStore.isStaticGeneration,
        h: (0, _varyparams.getMetadataVaryParamsThenable)()
    });
    if ((options == null ? void 0 : options.staleTimeIterable) !== undefined) {
        baseResponse.s = options.staleTimeIterable;
    }
    if ((options == null ? void 0 : options.staticStageByteLengthPromise) !== undefined) {
        baseResponse.l = options.staticStageByteLengthPromise;
    }
    if ((options == null ? void 0 : options.runtimePrefetchStream) !== undefined) {
        baseResponse.p = options.runtimePrefetchStream;
    }
    // Include the per-page dynamic stale time from unstable_dynamicStaleTime, but only
    // for dynamic renders (not prerenders/static generation). The client treats
    // its presence as authoritative.
    // TODO: Move this to the prefetch hints file so we don't have to walk the
    // tree on every render.
    if (!workStore.isStaticGeneration) {
        const dynamicStaleTime = await getDynamicStaleTime(ctx.componentMod.routeModule.userland.loaderTree);
        if (dynamicStaleTime !== null) {
            baseResponse.d = dynamicStaleTime;
        }
    }
    return baseResponse;
}
function createErrorContext(ctx, renderSource) {
    return {
        routerKind: 'App Router',
        routePath: ctx.pagePath,
        // TODO: is this correct if `isPossibleServerAction` is a false positive?
        routeType: ctx.isPossibleServerAction ? 'action' : 'render',
        renderSource,
        revalidateReason: (0, _utils.getRevalidateReason)(ctx.workStore)
    };
}
/**
 * Produces a RenderResult containing the Flight data for the given request. See
 * `generateDynamicRSCPayload` for information on the contents of the render result.
 */ async function generateDynamicFlightRenderResult(req, ctx, requestStore, options) {
    const { htmlRequestId, renderOpts, requestId, workStore } = ctx;
    const { onInstrumentationRequestError, setReactDebugChannel, isBuildTimePrerendering = false } = renderOpts;
    function onFlightDataRenderError(err, silenceLog) {
        return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'react-server-components-payload'), silenceLog);
    }
    const onError = (0, _createerrorhandler.createReactServerErrorHandler)(process.env.NODE_ENV === 'development', isBuildTimePrerendering, workStore.reactServerErrorsByDigest, onFlightDataRenderError);
    const debugChannel = setReactDebugChannel && (0, _debugchannelserver.createDebugChannel)();
    if (debugChannel) {
        setReactDebugChannel(debugChannel.clientSide, htmlRequestId, requestId);
    }
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    // For app dir, use the bundled version of Flight server renderer (renderToReadableStream)
    // which contains the subset React.
    const rscPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, generateDynamicRSCPayload, ctx, options);
    const flightStream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ctx.componentMod, rscPayload, clientModules, {
        onError,
        temporaryReferences: options == null ? void 0 : options.temporaryReferences,
        filterStackFrame,
        debugChannel: debugChannel == null ? void 0 : debugChannel.serverSide
    });
    return new _flightrenderresult.FlightRenderResult(flightStream, {
        fetchMetrics: workStore.fetchMetrics
    }, options == null ? void 0 : options.waitUntil);
}
/**
 * Production-only staged dynamic flight render for cache components. Uses
 * staged rendering to separate static (RDC-backed) from runtime/dynamic
 * content.
 */ async function generateStagedDynamicFlightRenderResult(req, ctx, requestStore) {
    const { componentMod, workStore, renderOpts } = ctx;
    const { renderToReadableStream, routeModule } = componentMod;
    const { loaderTree } = routeModule.userland;
    const { onInstrumentationRequestError, experimental } = renderOpts;
    function onFlightDataRenderError(err, silenceLog) {
        return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'react-server-components-payload'), silenceLog);
    }
    const onError = (0, _createerrorhandler.createReactServerErrorHandler)(false, false, workStore.reactServerErrorsByDigest, onFlightDataRenderError);
    const selectStaleTime = (0, _staletime.createSelectStaleTime)(experimental);
    const staleTimeIterable = new _staletime.StaleTimeIterable();
    // TODO(cached-navs): this assumes that we checked during build that there's no sync IO.
    // but it can happen e.g. after a revalidation or conditionally for a param that wasn't prerendered.
    // we should change this to track sync IO, log an error and advance to dynamic.
    const shouldTrackSyncIO = false;
    const stageController = new _stagedrendering.StagedRenderingController(null, null, shouldTrackSyncIO);
    // Initialize stale time tracking on the request store.
    requestStore.stale = _constants1.INFINITE_CACHE;
    requestStore.stagedRendering = stageController;
    requestStore.asyncApiPromises = createAsyncApiPromises(stageController, requestStore.cookies, requestStore.mutableCookies, requestStore.headers);
    (0, _staletime.trackStaleTime)(requestStore, staleTimeIterable, selectStaleTime);
    // Deferred promise for the static stage byte length. Flight serializes the
    // resolved value into the stream so the client knows where the static
    // prefix ends.
    let resolveStaticStageByteLength;
    const staticStageByteLengthPromise = new Promise((resolve)=>{
        resolveStaticStageByteLength = resolve;
    });
    // Check if this route has opted into runtime prefetching via
    // unstable_instant. If so, we piggyback on the dynamic render to fill caches
    // and then spawn a final runtime prerender whose result stream is embedded in
    // the RSC payload. This is gated on the explicit opt-in because it adds extra
    // server processing, increases the response payload size, and the runtime
    // prefetch output should have been validated first.
    const hasRuntimePrefetch = await (0, _instantconfig.anySegmentHasRuntimePrefetchEnabled)(loaderTree);
    let runtimePrefetchStream;
    if (hasRuntimePrefetch) {
        // Create a mutable cache that gets filled during the dynamic render.
        const prerenderResumeDataCache = (0, _resumedatacache.createPrerenderResumeDataCache)();
        requestStore.prerenderResumeDataCache = prerenderResumeDataCache;
        const cacheSignal = new _cachesignal.CacheSignal();
        (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
        requestStore.cacheSignal = cacheSignal;
        // Create a deferred stream for the runtime prefetch result. Its readable
        // side goes into the RSC payload (Flight serializes it lazily). The
        // writable side receives the runtime prerender result once the dynamic
        // render has filled all caches.
        const runtimePrefetchTransform = new TransformStream();
        runtimePrefetchStream = runtimePrefetchTransform.readable;
        // Wait for the dynamic render to fill caches, then run the final runtime
        // prerender (fire-and-forget — does not block the response).
        void cacheSignal.cacheReady().then(()=>spawnRuntimePrefetchWithFilledCaches(runtimePrefetchTransform.writable, ctx, prerenderResumeDataCache, requestStore, onError));
    }
    const rscPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, generateDynamicRSCPayload, ctx, {
        staleTimeIterable,
        staticStageByteLengthPromise,
        runtimePrefetchStream
    });
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    const flightReadableStream = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
        stageController.advanceStage(_stagedrendering.RenderStage.Static);
        const stream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, renderToReadableStream, rscPayload, clientModules, {
            onError,
            filterStackFrame
        });
        const [dynamicStream, staticStream] = stream.tee();
        countStaticStageBytes(staticStream, stageController).then(resolveStaticStageByteLength);
        return dynamicStream;
    }, ()=>{
        // This is a separate task that doesn't advance a stage. It forces
        // draining the microtask queue so that the stale time iterable is closed
        // before we advance to the dynamic stage.
        void (0, _staletime.finishStaleTimeTracking)(staleTimeIterable);
    }, ()=>{
        stageController.advanceStage(_stagedrendering.RenderStage.Dynamic);
    });
    return new _flightrenderresult.FlightRenderResult(flightReadableStream, {
        fetchMetrics: workStore.fetchMetrics
    });
}
/**
 * Runs a final runtime prerender using the provided (already filled) cache and
 * pipes its output into the provided writable stream. The caller is responsible
 * for waiting until caches are warm before calling this function.
 */ async function spawnRuntimePrefetchWithFilledCaches(writable, ctx, prerenderResumeDataCache, requestStore, onError) {
    try {
        const { componentMod, getDynamicParamFromSegment } = ctx;
        const { loaderTree } = componentMod.routeModule.userland;
        const rootParams = (0, _createcomponenttree.getRootParams)(loaderTree, getDynamicParamFromSegment);
        const staleTimeIterable = new _staletime.StaleTimeIterable();
        const { result } = await finalRuntimeServerPrerender(ctx, generateDynamicRSCPayload.bind(null, ctx, {
            staleTimeIterable
        }), prerenderResumeDataCache, null, rootParams, requestStore.headers, requestStore.cookies, requestStore.draftMode, onError, staleTimeIterable);
        await result.prelude.pipeTo(writable);
    } catch  {
        // Runtime prerender failed. Close the stream gracefully — the navigation
        // still works, we just won't get cached runtime data.
        try {
            await writable.close();
        } catch  {
        // Writable may already be closed/errored.
        }
    }
}
async function stagedRenderToReadableStreamWithoutCachesInDev(ctx, requestStore, getPayload, options) {
    // We're rendering while bypassing caches,
    // so we have no hope of showing a useful runtime stage.
    // But we still want things like `params` to show up in devtools correctly,
    // which relies on mechanisms we've set up for staged rendering,
    // so we do a 2-task version (Static -> Dynamic) instead.
    // We aren't filling caches so we don't need to abort this render, it'll
    // stream in a single pass
    const stageController = new _stagedrendering.StagedRenderingController(null, null, false // do not track sync IO (we don't have reliable stages)
    );
    const environmentName = ()=>{
        const currentStage = stageController.currentStage;
        switch(currentStage){
            case _stagedrendering.RenderStage.Before:
            case _stagedrendering.RenderStage.EarlyStatic:
            case _stagedrendering.RenderStage.Static:
                return 'Prerender';
            case _stagedrendering.RenderStage.EarlyRuntime:
            case _stagedrendering.RenderStage.Runtime:
            case _stagedrendering.RenderStage.Dynamic:
            case _stagedrendering.RenderStage.Abandoned:
                return 'Server';
            default:
                currentStage;
                throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid render stage: ${currentStage}`), "__NEXT_ERROR_CODE", {
                    value: "E881",
                    enumerable: false,
                    configurable: true
                });
        }
    };
    requestStore.stagedRendering = stageController;
    requestStore.asyncApiPromises = createAsyncApiPromises(stageController, requestStore.cookies, requestStore.mutableCookies, requestStore.headers);
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    const rscPayload = await getPayload(requestStore);
    return await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
        stageController.advanceStage(_stagedrendering.RenderStage.Static);
        return _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ctx.componentMod, rscPayload, clientModules, {
            ...options,
            environmentName
        });
    }, ()=>{
        stageController.advanceStage(_stagedrendering.RenderStage.Dynamic);
    });
}
/**
 * Fork of `generateDynamicFlightRenderResult` that renders using `renderWithRestartOnCacheMissInDev`
 * to ensure correct separation of environments Prerender/Server (for use in Cache Components)
 */ async function generateDynamicFlightRenderResultWithStagesInDev(req, ctx, initialRequestStore, createRequestStore, fallbackParams) {
    const { htmlRequestId, renderOpts, requestId, workStore, componentMod: { createElement, routeModule: { userland: { loaderTree } } }, url } = ctx;
    const { onInstrumentationRequestError, setReactDebugChannel, setCacheStatus, isBuildTimePrerendering = false } = renderOpts;
    function onFlightDataRenderError(err, silenceLog) {
        return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'react-server-components-payload'), silenceLog);
    }
    const onError = (0, _createerrorhandler.createReactServerErrorHandler)(process.env.NODE_ENV === 'development', isBuildTimePrerendering, workStore.reactServerErrorsByDigest, onFlightDataRenderError);
    // We validate RSC requests for HMR refreshes and client navigations when
    // instant configs exist, since we render all the layouts necessary to perform
    // the validation in those cases.
    const shouldValidate = !isBypassingCachesInDev(initialRequestStore) && (initialRequestStore.isHmrRefresh === true || await (0, _instantconfig.anySegmentNeedsInstantValidationInDev)(loaderTree));
    const getPayload = async (requestStore)=>{
        const payload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, generateDynamicRSCPayload, ctx, undefined);
        if (isBypassingCachesInDev(requestStore)) {
            // Mark the RSC payload to indicate that caches were bypassed in dev.
            // This lets the client know not to cache anything based on this render.
            payload._bypassCachesInDev = createElement(WarnForBypassCachesInDev, {
                route: workStore.route
            });
        } else if (shouldValidate) {
            // If this payload will be used for validation, it needs to contain the
            // canonical URL. Without it we'd get an error.
            payload.c = prepareInitialCanonicalUrl(url);
        }
        return payload;
    };
    let debugChannel;
    let stream;
    if (// We only do this flow if we can safely recreate the store from scratch
    // (which is not the case for renders after an action)
    createRequestStore && // We only do this flow if we're not bypassing caches in dev using
    // "disable cache" in devtools or a hard refresh (cache-control: "no-store")
    !isBypassingCachesInDev(initialRequestStore)) {
        // Before we kick off the render, we set the cache status back to it's initial state
        // in case a previous render bypassed the cache.
        if (setCacheStatus) {
            setCacheStatus('ready', htmlRequestId);
        }
        const { stream: serverStream, accumulatedChunksPromise, syncInterruptReason, startTime, staticStageEndTime, runtimeStageEndTime, debugChannel: returnedDebugChannel, requestStore: finalRequestStore } = await renderWithRestartOnCacheMissInDev(ctx, initialRequestStore, createRequestStore, getPayload, onError);
        if (shouldValidate) {
            let validationDebugChannelClient = undefined;
            if (returnedDebugChannel) {
                const [t1, t2] = returnedDebugChannel.clientSide.readable.tee();
                returnedDebugChannel.clientSide.readable = t1;
                validationDebugChannelClient = nodeStreamFromReadableStream(t2);
            }
            _consoleasyncstorageexternal.consoleAsyncStorage.run({
                dim: true
            }, spawnStaticShellValidationInDev, accumulatedChunksPromise, syncInterruptReason, startTime, staticStageEndTime, runtimeStageEndTime, ctx, finalRequestStore, fallbackParams, validationDebugChannelClient);
        } else {
            logValidationSkipped(ctx);
        }
        debugChannel = returnedDebugChannel;
        stream = serverStream;
    } else {
        // We're either bypassing caches or we can't restart the render.
        // Do a dynamic render, but with (basic) environment labels.
        // Set cache status to bypass when specifically bypassing caches in dev
        if (setCacheStatus) {
            setCacheStatus('bypass', htmlRequestId);
        }
        debugChannel = setReactDebugChannel && (0, _debugchannelserver.createDebugChannel)();
        stream = await stagedRenderToReadableStreamWithoutCachesInDev(ctx, initialRequestStore, getPayload, {
            onError: onError,
            filterStackFrame,
            debugChannel: debugChannel == null ? void 0 : debugChannel.serverSide
        });
    }
    if (debugChannel && setReactDebugChannel) {
        setReactDebugChannel(debugChannel.clientSide, htmlRequestId, requestId);
    }
    return new _flightrenderresult.FlightRenderResult(stream, {
        fetchMetrics: workStore.fetchMetrics
    });
}
async function generateRuntimePrefetchResult(req, ctx, requestStore) {
    const { workStore, renderOpts } = ctx;
    const { isBuildTimePrerendering = false, onInstrumentationRequestError } = renderOpts;
    function onFlightDataRenderError(err, silenceLog) {
        return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, // TODO(runtime-ppr): should we use a different value?
        createErrorContext(ctx, 'react-server-components-payload'), silenceLog);
    }
    const onError = (0, _createerrorhandler.createReactServerErrorHandler)(false, isBuildTimePrerendering, workStore.reactServerErrorsByDigest, onFlightDataRenderError);
    const metadata = {};
    const staleTimeIterable = new _staletime.StaleTimeIterable();
    const { componentMod: { routeModule: { userland: { loaderTree } } }, getDynamicParamFromSegment } = ctx;
    const rootParams = (0, _createcomponenttree.getRootParams)(loaderTree, getDynamicParamFromSegment);
    // We need to share caches between the prospective prerender and the final prerender,
    // but we're not going to persist this anywhere.
    const prerenderResumeDataCache = (0, _resumedatacache.createPrerenderResumeDataCache)();
    // We're not resuming an existing render.
    const renderResumeDataCache = null;
    await prospectiveRuntimeServerPrerender(ctx, generateDynamicRSCPayload.bind(null, ctx), prerenderResumeDataCache, renderResumeDataCache, rootParams, requestStore.headers, requestStore.cookies, requestStore.draftMode);
    const response = await finalRuntimeServerPrerender(ctx, generateDynamicRSCPayload.bind(null, ctx, {
        staleTimeIterable
    }), prerenderResumeDataCache, renderResumeDataCache, rootParams, requestStore.headers, requestStore.cookies, requestStore.draftMode, onError, staleTimeIterable);
    applyMetadataFromPrerenderResult(response, metadata, workStore);
    metadata.fetchMetrics = ctx.workStore.fetchMetrics;
    return new _flightrenderresult.FlightRenderResult(response.result.prelude, metadata);
}
async function prospectiveRuntimeServerPrerender(ctx, getPayload, prerenderResumeDataCache, renderResumeDataCache, rootParams, headers, cookies, draftMode) {
    const { implicitTags, renderOpts, workStore } = ctx;
    const { ComponentMod } = renderOpts;
    // Prerender controller represents the lifetime of the prerender.
    // It will be aborted when a Task is complete or a synchronously aborting
    // API is called. Notably during cache-filling renders this does not actually
    // terminate the render itself which will continue until all caches are filled
    const initialServerPrerenderController = new AbortController();
    // This controller represents the lifetime of the React render call. Notably
    // during the cache-filling render it is different from the prerender controller
    // because we don't want to end the react render until all caches are filled.
    const initialServerRenderController = new AbortController();
    // The cacheSignal helps us track whether caches are still filling or we are ready
    // to cut the render off.
    const cacheSignal = new _cachesignal.CacheSignal();
    const initialServerPrerenderStore = {
        type: 'prerender-runtime',
        phase: 'render',
        rootParams,
        implicitTags,
        renderSignal: initialServerRenderController.signal,
        controller: initialServerPrerenderController,
        // During the initial prerender we need to track all cache reads to ensure
        // we render long enough to fill every cache it is possible to visit during
        // the final prerender.
        cacheSignal,
        // We only need to track dynamic accesses during the final prerender.
        dynamicTracking: null,
        // Runtime prefetches are never cached server-side, only client-side,
        // so we set `expire` and `revalidate` to their minimum values just in case.
        revalidate: 1,
        expire: 0,
        stale: _constants1.INFINITE_CACHE,
        tags: [
            ...implicitTags.tags
        ],
        renderResumeDataCache,
        prerenderResumeDataCache,
        hmrRefreshHash: undefined,
        // We don't track vary params during initial prerender, only the final one
        varyParamsAccumulator: null,
        // No stage sequencing needed for prospective renders.
        stagedRendering: null,
        // These are not present in regular prerenders, but allowed in a runtime prerender.
        headers,
        cookies,
        draftMode
    };
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    // We're not going to use the result of this render because the only time it could be used
    // is if it completes in a microtask and that's likely very rare for any non-trivial app
    const initialServerPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(initialServerPrerenderStore, getPayload);
    const prerenderOptions = {
        filterStackFrame,
        onError: (err)=>{
            const digest = (0, _createerrorhandler.getDigestForWellKnownError)(err);
            if (digest) {
                return digest;
            }
            if (initialServerPrerenderController.signal.aborted) {
                // The render aborted before this error was handled which indicates
                // the error is caused by unfinished components within the render
                return;
            } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
                (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
            }
        },
        // We don't want to stop rendering until the cacheSignal is complete so we pass
        // a different signal to this render call than is used by dynamic APIs to signify
        // transitioning out of the prerender environment
        signal: initialServerRenderController.signal
    };
    const pendingInitialServerResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(initialServerPrerenderStore, (0, _streamops.getServerPrerender)(ComponentMod), initialServerPayload, clientModules, prerenderOptions);
    // Wait for all caches to be finished filling and for async imports to resolve
    (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
    await cacheSignal.cacheReady();
    initialServerRenderController.abort();
    initialServerPrerenderController.abort();
    // We don't need to continue the prerender process if we already
    // detected invalid dynamic usage in the initial prerender phase.
    if (workStore.invalidDynamicUsageError) {
        throw workStore.invalidDynamicUsageError;
    }
    try {
        return await (0, _apprenderprerenderutils.createReactServerPrerenderResult)(pendingInitialServerResult);
    } catch (err) {
        if (initialServerRenderController.signal.aborted || initialServerPrerenderController.signal.aborted) {
        // These are expected errors that might error the prerender. we ignore them.
        } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
            // We don't normally log these errors because we are going to retry anyway but
            // it can be useful for debugging Next.js itself to get visibility here when needed
            (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
        }
        return null;
    }
}
/**
 * Prepends a single ASCII byte to the stream indicating whether the response
 * is partial (contains dynamic holes): '~' (0x7e) for partial, '#' (0x23)
 * for complete.
 */ function prependIsPartialByte(stream, isPartial) {
    const byte = new Uint8Array([
        isPartial ? 0x7e : 0x23
    ]);
    return stream.pipeThrough(new TransformStream({
        start (controller) {
            controller.enqueue(byte);
        }
    }));
}
async function finalRuntimeServerPrerender(ctx, getPayload, prerenderResumeDataCache, renderResumeDataCache, rootParams, headers, cookies, draftMode, onError, staleTimeIterable) {
    const { implicitTags, renderOpts } = ctx;
    const { ComponentMod, experimental, isDebugDynamicAccesses } = renderOpts;
    const selectStaleTime = (0, _staletime.createSelectStaleTime)(experimental);
    let serverIsDynamic = false;
    const finalServerController = new AbortController();
    const serverDynamicTracking = (0, _dynamicrendering.createDynamicTrackingState)(isDebugDynamicAccesses);
    const finalStageController = new _stagedrendering.StagedRenderingController(finalServerController.signal, null, true // track sync IO
    );
    const varyParamsAccumulator = (0, _varyparams.createResponseVaryParamsAccumulator)();
    const finalServerPrerenderStore = {
        type: 'prerender-runtime',
        phase: 'render',
        rootParams,
        implicitTags,
        renderSignal: finalServerController.signal,
        controller: finalServerController,
        // All caches we could read must already be filled so no tracking is necessary
        cacheSignal: null,
        dynamicTracking: serverDynamicTracking,
        // Runtime prefetches are never cached server-side, only client-side,
        // so we set `expire` and `revalidate` to their minimum values just in case.
        revalidate: 1,
        expire: 0,
        stale: _constants1.INFINITE_CACHE,
        tags: [
            ...implicitTags.tags
        ],
        prerenderResumeDataCache,
        renderResumeDataCache,
        hmrRefreshHash: undefined,
        varyParamsAccumulator,
        // Used to separate the stages in the 5-task pipeline.
        stagedRendering: finalStageController,
        // These are not present in regular prerenders, but allowed in a runtime prerender.
        headers,
        cookies,
        draftMode
    };
    (0, _staletime.trackStaleTime)(finalServerPrerenderStore, staleTimeIterable, selectStaleTime);
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    const finalRSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(finalServerPrerenderStore, getPayload);
    let prerenderIsPending = true;
    const result = await (0, _apprenderrenderutils.runInSequentialTasks)(async ()=>{
        // EarlyStatic stage: render begins.
        // Runtime-prefetchable segments render immediately.
        // Non-prefetchable segments are gated until the Static stage.
        finalStageController.advanceStage(_stagedrendering.RenderStage.EarlyStatic);
        const prerenderResult = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(finalServerPrerenderStore, (0, _streamops.getServerPrerender)(ComponentMod), finalRSCPayload, clientModules, {
            filterStackFrame,
            onError,
            signal: finalServerController.signal
        });
        prerenderIsPending = false;
        return prerenderResult;
    }, ()=>{
        // Advance to Static stage: resolve promise holding back
        // non-prefetchable segments so they can begin rendering.
        finalStageController.advanceStage(_stagedrendering.RenderStage.Static);
    }, ()=>{
        // Advance to EarlyRuntime stage: resolve cookies/headers for
        // runtime-prefetchable segments. Sync IO is checked here.
        finalStageController.advanceStage(_stagedrendering.RenderStage.EarlyRuntime);
    }, ()=>{
        // Advance to Runtime stage: resolve cookies/headers for
        // non-prefetchable segments. Sync IO is allowed here.
        finalStageController.advanceStage(_stagedrendering.RenderStage.Runtime);
    }, ()=>{
        Promise.all([
            (0, _staletime.finishStaleTimeTracking)(staleTimeIterable),
            (0, _varyparams.finishAccumulatingVaryParams)(varyParamsAccumulator)
        ]).then(()=>{
            // Abort. This runs as a microtask after Flight has flushed the
            // staleTime and varyParams closing chunks, but before the next
            // macrotask resolves the overall result.
            if (finalServerController.signal.aborted) {
                // If the server controller is already aborted we must have called
                // something that required aborting the prerender synchronously such
                // as with new Date()
                serverIsDynamic = true;
                return;
            }
            if (prerenderIsPending) {
                // If prerenderIsPending then we have blocked for longer than a Task
                // and we assume there is something unfinished.
                serverIsDynamic = true;
            }
            finalServerController.abort();
        });
    });
    result.prelude = prependIsPartialByte(result.prelude, serverIsDynamic);
    return {
        result,
        // TODO(runtime-ppr): do we need to produce a digest map here?
        // digestErrorsMap: ...,
        dynamicAccess: serverDynamicTracking,
        isPartial: serverIsDynamic,
        collectedRevalidate: finalServerPrerenderStore.revalidate,
        collectedExpire: finalServerPrerenderStore.expire,
        collectedStale: staleTimeIterable.currentValue,
        collectedTags: finalServerPrerenderStore.tags
    };
}
/**
 * Crawlers will inadvertently think the canonicalUrl in the RSC payload should be crawled
 * when our intention is to just seed the router state with the current URL.
 * This function splits up the pathname so that we can later join it on
 * when we're ready to consume the path.
 */ function prepareInitialCanonicalUrl(url) {
    return (url.pathname + url.search).split('/');
}
function getRenderedSearch(query) {
    // Inlined implementation of querystring.encode, which is not available in
    // the Edge runtime.
    const pairs = [];
    for(const key in query){
        const value = query[key];
        if (value == null) continue;
        if (Array.isArray(value)) {
            for (const v of value){
                pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
            }
        } else {
            pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
    }
    // The result should match the format of a web URL's `search` property, since
    // this is the format that's stored in the App Router state.
    // TODO: We're a bit inconsistent about this. The x-nextjs-rewritten-query
    // header omits the leading question mark. Should refactor to always do
    // that instead.
    if (pairs.length === 0) {
        // If the search string is empty, return an empty string.
        return '';
    }
    // Prepend '?' to the search params string.
    return '?' + pairs.join('&');
}
// This is the data necessary to render <AppRouter /> when no SSR errors are encountered
async function getRSCPayload(tree, ctx, options) {
    var _ctx_renderOpts_prefetchHints;
    const { is404, staleTimeIterable, staticStageByteLengthPromise, runtimePrefetchStream } = options;
    const injectedCSS = new Set();
    const injectedJS = new Set();
    const injectedFontPreloadTags = new Set();
    let missingSlots;
    // We only track missing parallel slots in development
    if (process.env.__NEXT_DEV_SERVER) {
        missingSlots = new Set();
    }
    const { getDynamicParamFromSegment, query, appUsingSizeAdjustment, componentMod: { createMetadataComponents, createElement, Fragment }, url, workStore } = ctx;
    const hints = ((_ctx_renderOpts_prefetchHints = ctx.renderOpts.prefetchHints) == null ? void 0 : _ctx_renderOpts_prefetchHints[ctx.pagePath]) ?? null;
    const initialTree = await (0, _createflightrouterstatefromloadertree.createFlightRouterStateFromLoaderTree)(tree, hints, getDynamicParamFromSegment, query);
    const serveStreamingMetadata = !!ctx.renderOpts.serveStreamingMetadata;
    const hasGlobalNotFound = !!tree[2]['global-not-found'];
    const metadataIsRuntimePrefetchable = await (0, _instantconfig.anySegmentHasRuntimePrefetchEnabled)(tree);
    const { Viewport, Metadata, MetadataOutlet } = createMetadataComponents({
        tree,
        // When it's using global-not-found, metadata errorType is undefined, which will retrieve the
        // metadata from the page.
        // When it's using not-found, metadata errorType is 'not-found', which will retrieve the
        // metadata from the not-found.js boundary.
        // TODO: remove this condition and keep it undefined when global-not-found is stabilized.
        errorType: is404 && !hasGlobalNotFound ? 'not-found' : undefined,
        parsedQuery: query,
        pathname: url.pathname,
        metadataContext: (0, _metadatacontext.createMetadataContext)(ctx.renderOpts),
        interpolatedParams: ctx.interpolatedParams,
        serveStreamingMetadata,
        isRuntimePrefetchable: metadataIsRuntimePrefetchable
    });
    const preloadCallbacks = [];
    const seedData = await (0, _createcomponenttree.createComponentTree)({
        ctx,
        loaderTree: tree,
        parentParams: {},
        parentOptionalCatchAllParamName: null,
        parentRuntimePrefetchable: false,
        injectedCSS,
        injectedJS,
        injectedFontPreloadTags,
        rootLayoutIncluded: false,
        missingSlots,
        preloadCallbacks,
        authInterrupts: ctx.renderOpts.experimental.authInterrupts,
        MetadataOutlet
    });
    // When the `vary` response header is present with `Next-URL`, that means there's a chance
    // it could respond differently if there's an interception route. We provide this information
    // to `AppRouter` so that it can properly seed the prefetch cache with a prefix, if needed.
    // In dev, the Vary header may not reliably reflect whether a route can
    // be intercepted, because interception routes are compiled on demand.
    // Default to true so the client doesn't cache a stale Fallback entry.
    const varyHeader = ctx.res.getHeader('vary');
    const couldBeIntercepted = !!process.env.__NEXT_DEV_SERVER || typeof varyHeader === 'string' && varyHeader.includes(_approuterheaders.NEXT_URL);
    const initialHead = createElement(Fragment, {
        key: flightDataPathHeadKey
    }, createElement(NonIndex, {
        createElement,
        pagePath: ctx.pagePath,
        statusCode: ctx.res.statusCode,
        isPossibleServerAction: ctx.isPossibleServerAction
    }), createElement(Viewport, null), createElement(Metadata, null), appUsingSizeAdjustment ? createElement('meta', {
        name: 'next-size-adjust',
        content: ''
    }) : null);
    const { GlobalError, styles: globalErrorStyles } = await getGlobalErrorStyles(tree, ctx);
    // Assume the head we're rendering contains only partial data if PPR is
    // enabled and this is a statically generated response. This is used by the
    // client Segment Cache after a prefetch to determine if it can skip the
    // second request to fill in the dynamic data.
    //
    // See similar comment in create-component-tree.tsx for more context.
    const isPossiblyPartialHead = workStore.isStaticGeneration && ctx.renderOpts.experimental.isRoutePPREnabled === true;
    return maybeAppendBuildIdToRSCPayload(ctx, {
        // See the comment above the `Preloads` component (below) for why this is part of the payload
        P: createElement(Preloads, {
            preloadCallbacks: preloadCallbacks
        }),
        c: prepareInitialCanonicalUrl(url),
        q: getRenderedSearch(query),
        i: !!couldBeIntercepted,
        f: [
            [
                initialTree,
                seedData,
                initialHead,
                isPossiblyPartialHead
            ]
        ],
        m: missingSlots,
        G: [
            GlobalError,
            globalErrorStyles
        ],
        // Tells the client whether this route supports per-segment prefetching.
        // With Cache Components, all routes support it. Without it, only fully
        // static pages do, because their per-segment prefetch responses are
        // generated during static generation (build or ISR).
        S: workStore.isStaticGeneration || ctx.renderOpts.cacheComponents,
        h: (0, _varyparams.getMetadataVaryParamsThenable)(),
        s: staleTimeIterable,
        l: staticStageByteLengthPromise,
        p: runtimePrefetchStream,
        // Include the per-page dynamic stale time from unstable_dynamicStaleTime, but
        // only for dynamic renders. The client treats its presence as
        // authoritative.
        // TODO: Move this to the prefetch hints file so we don't have to walk
        // the tree on every render.
        d: !workStore.isStaticGeneration ? await getDynamicStaleTime(tree) ?? undefined : undefined
    });
}
/**
 * Preload calls (such as `ReactDOM.preloadStyle` and `ReactDOM.preloadFont`) need to be called during rendering
 * in order to create the appropriate preload tags in the DOM, otherwise they're a no-op. Since we invoke
 * renderToReadableStream with a function that returns component props rather than a component itself, we use
 * this component to "render  " the preload calls.
 */ function Preloads({ preloadCallbacks }) {
    preloadCallbacks.forEach((preloadFn)=>preloadFn());
    return null;
}
// This is the data necessary to render <AppRouter /> when an error state is triggered
async function getErrorRSCPayload(tree, ctx, ssrError, errorType) {
    var _ctx_renderOpts_prefetchHints;
    const { getDynamicParamFromSegment, query, componentMod: { createMetadataComponents, createElement, Fragment }, url, workStore } = ctx;
    const serveStreamingMetadata = !!ctx.renderOpts.serveStreamingMetadata;
    const metadataIsRuntimePrefetchable = await (0, _instantconfig.anySegmentHasRuntimePrefetchEnabled)(tree);
    const { Viewport, Metadata } = createMetadataComponents({
        tree,
        parsedQuery: query,
        pathname: url.pathname,
        metadataContext: (0, _metadatacontext.createMetadataContext)(ctx.renderOpts),
        errorType,
        interpolatedParams: ctx.interpolatedParams,
        serveStreamingMetadata: serveStreamingMetadata,
        isRuntimePrefetchable: metadataIsRuntimePrefetchable
    });
    const initialHead = createElement(Fragment, {
        key: flightDataPathHeadKey
    }, createElement(NonIndex, {
        createElement,
        pagePath: ctx.pagePath,
        statusCode: ctx.res.statusCode,
        isPossibleServerAction: ctx.isPossibleServerAction
    }), createElement(Viewport, null), process.env.__NEXT_DEV_SERVER && createElement('meta', {
        name: 'next-error',
        content: 'not-found'
    }), createElement(Metadata, null));
    const errorHints = ((_ctx_renderOpts_prefetchHints = ctx.renderOpts.prefetchHints) == null ? void 0 : _ctx_renderOpts_prefetchHints[ctx.pagePath]) ?? null;
    const initialTree = await (0, _createflightrouterstatefromloadertree.createFlightRouterStateFromLoaderTree)(tree, errorHints, getDynamicParamFromSegment, query);
    let err = undefined;
    if (ssrError) {
        err = (0, _iserror.default)(ssrError) ? ssrError : Object.defineProperty(new Error(ssrError + ''), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    // For metadata notFound error there's no global not found boundary on top
    // so we create a not found page with AppRouter
    const seedData = [
        createElement('html', {
            id: '__next_error__'
        }, createElement('head', null), createElement('body', null, process.env.__NEXT_DEV_SERVER && err ? createElement('template', {
            'data-next-error-message': err.message,
            'data-next-error-digest': 'digest' in err ? err.digest : '',
            'data-next-error-stack': err.stack
        }) : null)),
        {},
        null,
        false,
        null
    ];
    const { GlobalError, styles: globalErrorStyles } = await getGlobalErrorStyles(tree, ctx);
    const isPossiblyPartialHead = workStore.isStaticGeneration && ctx.renderOpts.experimental.isRoutePPREnabled === true;
    return maybeAppendBuildIdToRSCPayload(ctx, {
        c: prepareInitialCanonicalUrl(url),
        q: getRenderedSearch(query),
        m: undefined,
        i: false,
        f: [
            [
                initialTree,
                seedData,
                initialHead,
                isPossiblyPartialHead
            ]
        ],
        G: [
            GlobalError,
            globalErrorStyles
        ],
        // Tells the client whether this route supports per-segment prefetching.
        // With Cache Components, all routes support it. Without it, only fully
        // static pages do, because their per-segment prefetch responses are
        // generated during static generation (build or ISR).
        S: workStore.isStaticGeneration || ctx.renderOpts.cacheComponents,
        h: (0, _varyparams.getMetadataVaryParamsThenable)()
    });
}
// This component must run in an SSR context. It will render the RSC root component
function App({ reactServerStream, reactDebugStream, debugEndTime, preinitScripts, ServerInsertedHTMLProvider, nonce, images }) {
    preinitScripts();
    const response = _react.use((0, _useflightresponse.getFlightStream)(reactServerStream, reactDebugStream, debugEndTime, nonce));
    const initialState = (0, _createinitialrouterstate.createInitialRouterState)({
        // This is not used during hydration, so we don't have to pass a
        // real timestamp.
        navigatedAt: -1,
        initialRSCPayload: response,
        // location is not initialized in the SSR render
        // it's set to window.location during hydration
        location: null
    });
    const actionQueue = (0, _approuterinstance.createMutableActionQueue)(initialState, null);
    const { HeadManagerContext } = require('../../shared/lib/head-manager-context.shared-runtime');
    return /*#__PURE__*/ (0, _jsxruntime.jsx)(HeadManagerContext.Provider, {
        value: {
            appDir: true,
            nonce
        },
        children: /*#__PURE__*/ (0, _jsxruntime.jsx)(_imageconfigcontextsharedruntime.ImageConfigContext.Provider, {
            value: images ?? _imageconfig.imageConfigDefault,
            children: /*#__PURE__*/ (0, _jsxruntime.jsx)(ServerInsertedHTMLProvider, {
                children: /*#__PURE__*/ (0, _jsxruntime.jsx)(_approuter.default, {
                    actionQueue: actionQueue,
                    globalErrorState: response.G
                })
            })
        })
    });
/* eslint-enable @next/internal/no-ambiguous-jsx -- React Client */ }
// @TODO our error stream should be probably just use the same root component. But it was previously
// different I don't want to figure out if that is meaningful at this time so just keeping the behavior
// consistent for now.
function ErrorApp({ reactServerStream, preinitScripts, ServerInsertedHTMLProvider, nonce, images }) {
    /* eslint-disable @next/internal/no-ambiguous-jsx -- React Client */ preinitScripts();
    const response = _react.use((0, _useflightresponse.getFlightStream)(reactServerStream, undefined, undefined, nonce));
    const initialState = (0, _createinitialrouterstate.createInitialRouterState)({
        // This is not used during hydration, so we don't have to pass a
        // real timestamp.
        navigatedAt: -1,
        initialRSCPayload: response,
        // location is not initialized in the SSR render
        // it's set to window.location during hydration
        location: null
    });
    const actionQueue = (0, _approuterinstance.createMutableActionQueue)(initialState, null);
    return /*#__PURE__*/ (0, _jsxruntime.jsx)(_imageconfigcontextsharedruntime.ImageConfigContext.Provider, {
        value: images ?? _imageconfig.imageConfigDefault,
        children: /*#__PURE__*/ (0, _jsxruntime.jsx)(ServerInsertedHTMLProvider, {
            children: /*#__PURE__*/ (0, _jsxruntime.jsx)(_approuter.default, {
                actionQueue: actionQueue,
                globalErrorState: response.G
            })
        })
    });
/* eslint-enable @next/internal/no-ambiguous-jsx -- React Client */ }
async function renderToHTMLOrFlightImpl(req, res, url, pagePath, query, renderOpts, workStore, parsedRequestHeaders, postponedState, serverComponentsHmrCache, sharedContext, interpolatedParams, fallbackRouteParams) {
    const isNotFoundPath = pagePath === '/404';
    if (isNotFoundPath) {
        res.statusCode = 404;
    }
    // A unique request timestamp used by development to ensure that it's
    // consistent and won't change during this request. This is important to
    // avoid that resources can be deduped by React Float if the same resource is
    // rendered or preloaded multiple times: `<link href="a.css?v={Date.now()}"/>`.
    const requestTimestamp = Date.now();
    const { ComponentMod, nextFontManifest, serverActions, assetPrefix = '', enableTainting, cacheComponents, setIsrStatus } = renderOpts;
    const { cachedNavigations } = renderOpts.experimental;
    // We need to expose the bundled `require` API globally for
    // react-server-dom-webpack. This is a hack until we find a better way.
    if (ComponentMod.__next_app__) {
        const instrumented = (0, _clientcomponentrendererlogger.wrapClientComponentLoader)(ComponentMod);
        // When we are prerendering if there is a cacheSignal for tracking
        // cache reads we track calls to `loadChunk` and `require`. This allows us
        // to treat chunk/module loading with similar semantics as cache reads to avoid
        // module loading from causing a prerender to abort too early.
        const shouldTrackModuleLoading = ()=>{
            if (!cacheComponents) {
                return false;
            }
            if (process.env.__NEXT_DEV_SERVER) {
                return true;
            }
            const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
            if (!workUnitStore) {
                return false;
            }
            switch(workUnitStore.type){
                case 'prerender':
                case 'prerender-client':
                case 'validation-client':
                case 'prerender-runtime':
                case 'cache':
                case 'private-cache':
                    return true;
                case 'prerender-ppr':
                case 'prerender-legacy':
                case 'request':
                case 'unstable-cache':
                case 'generate-static-params':
                    return false;
                default:
                    workUnitStore;
            }
        };
        const __next_require__ = (...args)=>{
            const exportsOrPromise = instrumented.require(...args);
            if (shouldTrackModuleLoading()) {
                // requiring an async module returns a promise.
                (0, _trackmoduleloadingexternal.trackPendingImport)(exportsOrPromise);
            }
            return exportsOrPromise;
        };
        // @ts-expect-error
        globalThis.__next_require__ = __next_require__;
        const __next_chunk_load__ = (...args)=>{
            const loadingChunk = instrumented.loadChunk(...args);
            if (shouldTrackModuleLoading()) {
                (0, _trackmoduleloadingexternal.trackPendingChunkLoad)(loadingChunk);
            }
            return loadingChunk;
        };
        // @ts-expect-error
        globalThis.__next_chunk_load__ = __next_chunk_load__;
    }
    if (process.env.__NEXT_DEV_SERVER && setIsrStatus && !cacheComponents) {
        // Reset the ISR status at start of request.
        const { pathname } = new URL(req.url || '/', 'http://n');
        setIsrStatus(pathname, // Only pages using the Node runtime can use ISR, Edge is always dynamic.
        process.env.NEXT_RUNTIME === 'edge' ? false : undefined);
    }
    if (// The type check here ensures that `req` is correctly typed, and the
    // environment variable check provides dead code elimination.
    process.env.NEXT_RUNTIME !== 'edge' && (0, _helpers.isNodeNextRequest)(req)) {
        res.onClose(()=>{
            // We stop tracking fetch metrics when the response closes, since we
            // report them at that time.
            workStore.shouldTrackFetchMetrics = false;
        });
        req.originalRequest.on('end', ()=>{
            if ('performance' in globalThis) {
                const metrics = (0, _clientcomponentrendererlogger.getClientComponentLoaderMetrics)({
                    reset: true
                });
                if (metrics) {
                    (0, _tracer.getTracer)().startSpan(_constants.NextNodeServerSpan.clientComponentLoading, {
                        startTime: metrics.clientComponentLoadStart,
                        attributes: {
                            'next.clientComponentLoadCount': metrics.clientComponentLoadCount,
                            'next.span_type': _constants.NextNodeServerSpan.clientComponentLoading
                        }
                    }).end(metrics.clientComponentLoadStart + metrics.clientComponentLoadTimes);
                }
            }
        });
    }
    const metadata = {
        statusCode: isNotFoundPath ? 404 : undefined
    };
    const appUsingSizeAdjustment = !!(nextFontManifest == null ? void 0 : nextFontManifest.appUsingSizeAdjust);
    ComponentMod.patchFetch();
    // Pull out the hooks/references from the component.
    const { routeModule: { userland: { loaderTree } }, taintObjectReference } = ComponentMod;
    if (enableTainting) {
        taintObjectReference('Do not pass process.env to Client Components since it will leak sensitive data', process.env);
    }
    workStore.fetchMetrics = [];
    metadata.fetchMetrics = workStore.fetchMetrics;
    // don't modify original query object
    query = {
        ...query
    };
    (0, _internalutils.stripInternalQueries)(query);
    const { isStaticGeneration } = workStore;
    let requestId;
    let htmlRequestId;
    const { flightRouterState, isPrefetchRequest, isRuntimePrefetchRequest, isRSCRequest, isHmrRefresh, nonce } = parsedRequestHeaders;
    if (parsedRequestHeaders.requestId) {
        // If the client has provided a request ID (in development mode), we use it.
        requestId = parsedRequestHeaders.requestId;
    } else {
        // Otherwise we generate a new request ID.
        if (isStaticGeneration) {
            requestId = Buffer.from(await crypto.subtle.digest('SHA-1', Buffer.from(req.url))).toString('hex');
        } else if (process.env.NEXT_RUNTIME === 'edge') {
            requestId = crypto.randomUUID();
        } else {
            requestId = require('next/dist/compiled/nanoid').nanoid();
        }
    }
    // If the client has provided an HTML request ID, we use it to associate the
    // request with the HTML document from which it originated, which is used to
    // send debug information to the associated WebSocket client. Otherwise, this
    // is the request for the HTML document, so we use the request ID also as the
    // HTML request ID.
    htmlRequestId = parsedRequestHeaders.htmlRequestId || requestId;
    const getDynamicParamFromSegment = makeGetDynamicParamFromSegment(interpolatedParams, fallbackRouteParams, renderOpts.experimental.optimisticRouting);
    const isPossibleActionRequest = (0, _serveractionrequestmeta.getIsPossibleServerAction)(req);
    // For implicit tags, we use the resolved pathname which has dynamic params
    // interpolated, is decoded, and has trailing slash removed.
    const resolvedPathname = (0, _requestmeta.getRequestMeta)(req, 'resolvedPathname');
    if (!resolvedPathname) {
        throw Object.defineProperty(new _invarianterror.InvariantError('resolvedPathname must be set in request metadata'), "__NEXT_ERROR_CODE", {
            value: "E981",
            enumerable: false,
            configurable: true
        });
    }
    const implicitTags = await (0, _implicittags.getImplicitTags)(workStore.page, resolvedPathname, fallbackRouteParams);
    const ctx = {
        componentMod: ComponentMod,
        url,
        renderOpts,
        workStore,
        parsedRequestHeaders,
        getDynamicParamFromSegment,
        interpolatedParams,
        query,
        isPrefetch: isPrefetchRequest,
        isPossibleServerAction: isPossibleActionRequest,
        requestTimestamp,
        appUsingSizeAdjustment,
        flightRouterState,
        requestId,
        htmlRequestId,
        pagePath,
        assetPrefix,
        isNotFoundPath,
        nonce,
        res,
        sharedContext,
        implicitTags
    };
    (0, _tracer.getTracer)().setRootSpanAttribute('next.route', pagePath);
    if (isStaticGeneration) {
        // We're either building or revalidating. In either case we need to
        // prerender our page rather than render it.
        const prerenderToStreamWithTracing = (0, _tracer.getTracer)().wrap(_constants.AppRenderSpan.getBodyResult, {
            spanName: `prerender route (app) ${pagePath}`,
            attributes: {
                'next.route': pagePath
            }
        }, prerenderToStream);
        const response = await prerenderToStreamWithTracing(req, res, ctx, metadata, loaderTree, fallbackRouteParams);
        // If we're debugging partial prerendering, print all the dynamic API accesses
        // that occurred during the render.
        // @TODO move into renderToStream function
        if (response.dynamicAccess && (0, _dynamicrendering.accessedDynamicData)(response.dynamicAccess) && renderOpts.isDebugDynamicAccesses) {
            (0, _log.warn)('The following dynamic usage was detected:');
            for (const access of (0, _dynamicrendering.formatDynamicAPIAccesses)(response.dynamicAccess)){
                (0, _log.warn)(access);
            }
        }
        // If we encountered any unexpected errors during build we fail the
        // prerendering phase and the build.
        if (workStore.invalidDynamicUsageError) {
            (0, _dynamicrendering.logDisallowedDynamicError)(workStore, workStore.invalidDynamicUsageError);
            throw new _staticgenerationbailout.StaticGenBailoutError();
        }
        if (response.digestErrorsMap.size) {
            const buildFailingError = response.digestErrorsMap.values().next().value;
            if (buildFailingError) throw buildFailingError;
        }
        // Pick first userland SSR error, which is also not a RSC error.
        if (response.ssrErrors.length) {
            const buildFailingError = response.ssrErrors.find((err)=>(0, _createerrorhandler.isUserLandError)(err));
            if (buildFailingError) throw buildFailingError;
        }
        const options = {
            metadata,
            contentType: _constants1.HTML_CONTENT_TYPE_HEADER
        };
        // If we have pending revalidates, wait until they are all resolved.
        const maybeRevalidatesPromise = (0, _revalidationutils.executeRevalidates)(workStore);
        if (maybeRevalidatesPromise !== false) {
            const revalidatesPromise = maybeRevalidatesPromise.finally(()=>{
                if (process.env.NEXT_PRIVATE_DEBUG_CACHE) {
                    console.log('pending revalidates promise finished for:', url.href);
                }
            });
            if (renderOpts.waitUntil) {
                renderOpts.waitUntil(revalidatesPromise);
            } else {
                options.waitUntil = revalidatesPromise;
            }
        }
        applyMetadataFromPrerenderResult(response, metadata, workStore);
        if (response.renderResumeDataCache) {
            metadata.renderResumeDataCache = response.renderResumeDataCache;
        }
        const streamString = await (0, _streamops.streamToString)(response.stream);
        const result = new _renderresult.default(streamString, options);
        // Run build-time instant validation if the page has instant configs
        // TODO(instant-validation-build): This is not a great place to wire this in.
        if (workStore.cacheComponentsEnabled && workStore.isBuildTimePrerendering && renderOpts.runInstantValidation && await (0, _instantconfig.anySegmentNeedsInstantValidationInBuild)(loaderTree)) {
            // Throws StaticGenBailoutError if validation failed.
            await validateInstantConfigsInBuild(ctx, response.renderResumeDataCache ?? null);
        }
        return result;
    } else {
        // We're rendering dynamically
        const renderResumeDataCache = renderOpts.renderResumeDataCache ?? (postponedState == null ? void 0 : postponedState.renderResumeDataCache) ?? null;
        const rootParams = (0, _createcomponenttree.getRootParams)(loaderTree, ctx.getDynamicParamFromSegment);
        const fallbackParams = (0, _requestmeta.getRequestMeta)(req, 'fallbackParams') || null;
        const createRequestStore = _requeststore.createRequestStoreForRender.bind(null, req, res, url, rootParams, implicitTags, renderOpts.onUpdateCookies, renderOpts.previewProps, isHmrRefresh, serverComponentsHmrCache, renderResumeDataCache, fallbackParams);
        const requestStore = createRequestStore();
        if (process.env.__NEXT_DEV_SERVER && setIsrStatus && !cacheComponents && // Only pages using the Node runtime can use ISR, so we only need to
        // update the status for those.
        // The type check here ensures that `req` is correctly typed, and the
        // environment variable check provides dead code elimination.
        process.env.NEXT_RUNTIME !== 'edge' && (0, _helpers.isNodeNextRequest)(req)) {
            req.originalRequest.on('end', ()=>{
                const { pathname } = new URL(req.url || '/', 'http://n');
                const isStatic = !requestStore.usedDynamic && !workStore.forceDynamic;
                setIsrStatus(pathname, isStatic);
            });
        }
        if (isRSCRequest) {
            if (isRuntimePrefetchRequest) {
                return generateRuntimePrefetchResult(req, ctx, requestStore);
            } else {
                if (process.env.__NEXT_DEV_SERVER && process.env.NEXT_RUNTIME !== 'edge' && cacheComponents) {
                    return generateDynamicFlightRenderResultWithStagesInDev(req, ctx, requestStore, createRequestStore, fallbackParams);
                } else if (cacheComponents && cachedNavigations) {
                    return generateStagedDynamicFlightRenderResult(req, ctx, requestStore);
                } else {
                    return generateDynamicFlightRenderResult(req, ctx, requestStore);
                }
            }
        }
        let didExecuteServerAction = false;
        let formState = null;
        if (isPossibleActionRequest) {
            // For action requests, we handle them differently with a special render result.
            const actionRequestResult = await (0, _actionhandler.handleAction)({
                req,
                res,
                ComponentMod,
                generateFlight: generateDynamicFlightRenderResult,
                workStore,
                requestStore,
                serverActions,
                ctx,
                metadata
            });
            if (actionRequestResult) {
                if (actionRequestResult.type === 'not-found') {
                    const notFoundLoaderTree = createNotFoundLoaderTree(loaderTree);
                    res.statusCode = 404;
                    metadata.statusCode = 404;
                    const stream = await renderToStream(requestStore, req, res, ctx, notFoundLoaderTree, formState, postponedState, metadata, undefined, fallbackParams);
                    return new _renderresult.default(stream, {
                        metadata,
                        contentType: _constants1.HTML_CONTENT_TYPE_HEADER
                    });
                } else if (actionRequestResult.type === 'done') {
                    if (actionRequestResult.result) {
                        actionRequestResult.result.assignMetadata(metadata);
                        return actionRequestResult.result;
                    } else if (actionRequestResult.formState) {
                        formState = actionRequestResult.formState;
                    }
                }
            }
            didExecuteServerAction = true;
        }
        const options = {
            metadata,
            contentType: _constants1.HTML_CONTENT_TYPE_HEADER
        };
        const stream = await renderToStream(// NOTE: in Cache Components (dev), if the render is restarted, it will use a different requestStore
        // than the one that we're passing in here.
        requestStore, req, res, ctx, loaderTree, formState, postponedState, metadata, // If we're rendering HTML after an action, we don't want restartable-render behavior
        // because the result should be dynamic, like it is in prod.
        // Also, the request store might have been mutated by the action (e.g. enabling draftMode)
        // and we currently we don't copy changes over when creating a new store,
        // so the restarted render wouldn't be correct.
        didExecuteServerAction ? undefined : createRequestStore, fallbackParams);
        // Invalid dynamic usages should only error the request in development.
        // In production, it's better to produce a result.
        // (the dynamic error will still be thrown inside the component tree, but it's catchable by error boundaries)
        if (workStore.invalidDynamicUsageError && process.env.__NEXT_DEV_SERVER) {
            throw workStore.invalidDynamicUsageError;
        }
        // If we have pending revalidates, wait until they are all resolved.
        const maybeRevalidatesPromise = (0, _revalidationutils.executeRevalidates)(workStore);
        if (maybeRevalidatesPromise !== false) {
            const revalidatesPromise = maybeRevalidatesPromise.finally(()=>{
                if (process.env.NEXT_PRIVATE_DEBUG_CACHE) {
                    console.log('pending revalidates promise finished for:', url.href);
                }
            });
            if (renderOpts.waitUntil) {
                renderOpts.waitUntil(revalidatesPromise);
            } else {
                options.waitUntil = revalidatesPromise;
            }
        }
        // Create the new render result for the response.
        return new _renderresult.default(stream, options);
    }
}
const renderToHTMLOrFlight = (req, res, pagePath, query, fallbackRouteParams, renderOpts, serverComponentsHmrCache, sharedContext)=>{
    var _renderOpts_previewProps;
    if (!req.url) {
        throw Object.defineProperty(new Error('Invalid URL'), "__NEXT_ERROR_CODE", {
            value: "E182",
            enumerable: false,
            configurable: true
        });
    }
    const url = (0, _parserelativeurl.parseRelativeUrl)(req.url, undefined, false);
    // We read these values from the request object as, in certain cases,
    // base-server will strip them to opt into different rendering behavior.
    const parsedRequestHeaders = parseRequestHeaders(req.headers, {
        isRoutePPREnabled: renderOpts.experimental.isRoutePPREnabled === true,
        previewModeId: (_renderOpts_previewProps = renderOpts.previewProps) == null ? void 0 : _renderOpts_previewProps.previewModeId
    });
    const { isPrefetchRequest, previouslyRevalidatedTags, nonce } = parsedRequestHeaders;
    let interpolatedParams;
    let postponedState = null;
    // If provided, the postpone state should be parsed so it can be provided to
    // React.
    if (typeof renderOpts.postponed === 'string') {
        if (fallbackRouteParams) {
            throw Object.defineProperty(new _invarianterror.InvariantError('postponed state should not be provided when fallback params are provided'), "__NEXT_ERROR_CODE", {
                value: "E592",
                enumerable: false,
                configurable: true
            });
        }
        interpolatedParams = (0, _getdynamicparam.interpolateParallelRouteParams)(renderOpts.ComponentMod.routeModule.userland.loaderTree, renderOpts.params ?? {}, pagePath, fallbackRouteParams);
        postponedState = (0, _postponedstate.parsePostponedState)(renderOpts.postponed, interpolatedParams, renderOpts.experimental.maxPostponedStateSizeBytes);
    } else {
        interpolatedParams = (0, _getdynamicparam.interpolateParallelRouteParams)(renderOpts.ComponentMod.routeModule.userland.loaderTree, renderOpts.params ?? {}, pagePath, fallbackRouteParams);
    }
    if ((postponedState == null ? void 0 : postponedState.renderResumeDataCache) && renderOpts.renderResumeDataCache) {
        throw Object.defineProperty(new _invarianterror.InvariantError('postponed state and dev warmup immutable resume data cache should not be provided together'), "__NEXT_ERROR_CODE", {
            value: "E589",
            enumerable: false,
            configurable: true
        });
    }
    const workStore = (0, _workstore.createWorkStore)({
        page: renderOpts.routeModule.definition.page,
        renderOpts,
        // @TODO move to workUnitStore of type Request
        isPrefetchRequest,
        buildId: sharedContext.buildId,
        previouslyRevalidatedTags,
        nonce
    });
    return _workasyncstorageexternal.workAsyncStorage.run(workStore, // The function to run
    renderToHTMLOrFlightImpl, // all of it's args
    req, res, url, pagePath, query, renderOpts, workStore, parsedRequestHeaders, postponedState, serverComponentsHmrCache, sharedContext, interpolatedParams, fallbackRouteParams);
};
function applyMetadataFromPrerenderResult(response, metadata, workStore) {
    if (response.collectedTags) {
        metadata.fetchTags = response.collectedTags.join(',');
    }
    // Let the client router know how long to keep the cached entry around.
    const staleHeader = String(response.collectedStale);
    metadata.headers ??= {};
    metadata.headers[_approuterheaders.NEXT_ROUTER_STALE_TIME_HEADER] = staleHeader;
    // If force static is specifically set to false, we should not revalidate
    // the page.
    if (workStore.forceStatic === false || response.collectedRevalidate === 0) {
        metadata.cacheControl = {
            revalidate: 0,
            expire: undefined
        };
    } else {
        // Copy the cache control value onto the render result metadata.
        metadata.cacheControl = {
            revalidate: response.collectedRevalidate >= _constants1.INFINITE_CACHE ? false : response.collectedRevalidate,
            expire: response.collectedExpire >= _constants1.INFINITE_CACHE ? undefined : response.collectedExpire
        };
    }
    // provide bailout info for debugging
    if (metadata.cacheControl.revalidate === 0) {
        metadata.staticBailoutInfo = {
            description: workStore.dynamicUsageDescription,
            stack: workStore.dynamicUsageStack
        };
    }
}
async function renderToStream(requestStore, req, res, ctx, tree, formState, postponedState, metadata, createRequestStore, fallbackParams) {
    /* eslint-disable @next/internal/no-ambiguous-jsx -- React Client */ const { assetPrefix, htmlRequestId, nonce, pagePath, renderOpts, requestId, workStore } = ctx;
    const { basePath, buildManifest, ComponentMod: { createElement }, crossOrigin, experimental, isBuildTimePrerendering = false, onInstrumentationRequestError, page, reactMaxHeadersLength, setReactDebugChannel, shouldWaitOnAllReady, subresourceIntegrityManifest, supportsDynamicResponse, cacheComponents } = renderOpts;
    const { cachedNavigations } = renderOpts.experimental;
    const { ServerInsertedHTMLProvider, renderServerInsertedHTML } = (0, _serverinsertedhtml.createServerInsertedHTML)();
    const getServerInsertedMetadata = (0, _createserverinsertedmetadata.createServerInsertedMetadata)(nonce);
    const tracingMetadata = (0, _utils1.getTracedMetadata)((0, _tracer.getTracer)().getTracePropagationData(), experimental.clientTraceMetadata);
    const polyfills = buildManifest.polyfillFiles.filter((polyfill)=>polyfill.endsWith('.js') && !polyfill.endsWith('.module.js')).map((polyfill)=>({
            src: `${assetPrefix}/_next/${polyfill}${(0, _getassetquerystring.getAssetQueryString)(ctx, false)}`,
            integrity: subresourceIntegrityManifest == null ? void 0 : subresourceIntegrityManifest[polyfill],
            crossOrigin,
            noModule: true,
            nonce
        }));
    const [preinitScripts, bootstrapScript] = (0, _requiredscripts.getRequiredScripts)(buildManifest, // Why is assetPrefix optional on renderOpts?
    // @TODO make it default empty string on renderOpts and get rid of it from ctx
    assetPrefix, crossOrigin, subresourceIntegrityManifest, (0, _getassetquerystring.getAssetQueryString)(ctx, true), nonce, page);
    // In development mode, set the request ID as a global variable, before the
    // bootstrap script is executed, which depends on it during hydration.
    // For MPA navigations (page reload, direct URL entry), the request ID
    // header is not present, so we generate a random one.
    const bootstrapScriptContent = process.env.__NEXT_DEV_SERVER ? `self.__next_r=${JSON.stringify(requestId ?? crypto.randomUUID())}` : undefined;
    // Create the "render route (app)" span manually so we can keep it open during streaming.
    // This is necessary because errors inside Suspense boundaries are reported asynchronously
    // during stream consumption, after a typical wrapped function would have ended the span.
    // Note: We pass the full span name as the first argument since startSpan uses it directly.
    const renderSpan = (0, _tracer.getTracer)().startSpan(`render route (app) ${pagePath}`, {
        attributes: {
            'next.span_name': `render route (app) ${pagePath}`,
            'next.span_type': _constants.AppRenderSpan.getBodyResult,
            'next.route': pagePath
        }
    });
    // Helper to end the span with error status (used when throwing from catch blocks)
    const endSpanWithError = (err)=>{
        if (!renderSpan.isRecording()) return;
        if (err instanceof Error) {
            renderSpan.recordException(err);
            renderSpan.setAttribute('error.type', err.name);
        }
        renderSpan.setStatus({
            code: _tracer.SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : undefined
        });
        renderSpan.end();
    };
    // Run the rest of the function within the span's context so child spans
    // (like "build component tree", "generateMetadata") are properly parented.
    return (0, _tracer.getTracer)().withSpan(renderSpan, async ()=>{
        const { reactServerErrorsByDigest } = workStore;
        function onHTMLRenderRSCError(err, silenceLog) {
            return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'react-server-components'), silenceLog);
        }
        const serverComponentsErrorHandler = (0, _createerrorhandler.createReactServerErrorHandler)(process.env.NODE_ENV === 'development', isBuildTimePrerendering, reactServerErrorsByDigest, onHTMLRenderRSCError, renderSpan);
        function onHTMLRenderSSRError(err) {
            // We don't need to silence logs here. onHTMLRenderSSRError won't be called
            // at all if the error was logged before in the RSC error handler.
            const silenceLog = false;
            return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'server-rendering'), silenceLog);
        }
        const allCapturedErrors = [];
        const htmlRendererErrorHandler = (0, _createerrorhandler.createHTMLErrorHandler)(process.env.NODE_ENV === 'development', isBuildTimePrerendering, reactServerErrorsByDigest, allCapturedErrors, onHTMLRenderSSRError, renderSpan);
        let reactServerResult = null;
        let reactDebugStream;
        const setHeader = res.setHeader.bind(res);
        const appendHeader = res.appendHeader.bind(res);
        const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
        try {
            if (process.env.__NEXT_DEV_SERVER && // Edge routes never prerender so we don't have a Prerender environment for anything in edge runtime
            process.env.NEXT_RUNTIME !== 'edge' && // We only have a Prerender environment for projects opted into cacheComponents
            cacheComponents) {
                let debugChannel;
                // eslint-disable-next-line @typescript-eslint/no-shadow
                const getPayload = async (requestStore)=>{
                    const payload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, getRSCPayload, tree, ctx, {
                        is404: res.statusCode === 404
                    });
                    if (isBypassingCachesInDev(requestStore)) {
                        // Mark the RSC payload to indicate that caches were bypassed in dev.
                        // This lets the client know not to cache anything based on this render.
                        if (renderOpts.setCacheStatus) {
                            // we know this is available  when cacheComponents is enabled, but typeguard to be safe
                            renderOpts.setCacheStatus('bypass', htmlRequestId);
                        }
                        payload._bypassCachesInDev = createElement(WarnForBypassCachesInDev, {
                            route: workStore.route
                        });
                    }
                    return payload;
                };
                if (// We only do this flow if we can safely recreate the store from scratch
                // (which is not the case for renders after an action)
                createRequestStore && // We only do this flow if we're not bypassing caches in dev using
                // "disable cache" in devtools or a hard refresh (cache-control: "no-store")
                !isBypassingCachesInDev(requestStore)) {
                    const { stream: serverStream, accumulatedChunksPromise, syncInterruptReason, startTime, staticStageEndTime, runtimeStageEndTime, debugChannel: returnedDebugChannel, requestStore: finalRequestStore } = await renderWithRestartOnCacheMissInDev(ctx, requestStore, createRequestStore, getPayload, serverComponentsErrorHandler);
                    let validationDebugChannelClient = undefined;
                    if (returnedDebugChannel) {
                        const [t1, t2] = returnedDebugChannel.clientSide.readable.tee();
                        returnedDebugChannel.clientSide.readable = t1;
                        validationDebugChannelClient = nodeStreamFromReadableStream(t2);
                    }
                    _consoleasyncstorageexternal.consoleAsyncStorage.run({
                        dim: true
                    }, spawnStaticShellValidationInDev, accumulatedChunksPromise, syncInterruptReason, startTime, staticStageEndTime, runtimeStageEndTime, ctx, finalRequestStore, fallbackParams, validationDebugChannelClient);
                    reactServerResult = new _apprenderprerenderutils.ReactServerResult(serverStream);
                    requestStore = finalRequestStore;
                    debugChannel = returnedDebugChannel;
                } else {
                    logValidationSkipped(ctx);
                    // We're either bypassing caches or we can't restart the render.
                    // Do a dynamic render, but with (basic) environment labels.
                    debugChannel = setReactDebugChannel && (0, _debugchannelserver.createDebugChannel)();
                    const serverStream = await stagedRenderToReadableStreamWithoutCachesInDev(ctx, requestStore, getPayload, {
                        onError: serverComponentsErrorHandler,
                        filterStackFrame,
                        debugChannel: debugChannel == null ? void 0 : debugChannel.serverSide
                    });
                    reactServerResult = new _apprenderprerenderutils.ReactServerResult(serverStream);
                }
                if (debugChannel && setReactDebugChannel) {
                    const [readableSsr, readableBrowser] = debugChannel.clientSide.readable.tee();
                    reactDebugStream = readableSsr;
                    setReactDebugChannel({
                        readable: readableBrowser
                    }, htmlRequestId, requestId);
                }
            } else if (cacheComponents && cachedNavigations) {
                // Production Cache Components + Cached Navigations: use staged
                // rendering so the RSC payload includes the static stage byte length
                // (`l` field), enabling the client to cache the static subset during
                // hydration.
                const { renderToReadableStream } = ctx.componentMod;
                const selectStaleTime = (0, _staletime.createSelectStaleTime)(experimental);
                const staleTimeIterable = new _staletime.StaleTimeIterable();
                // TODO(cached-navs): this assumes that we checked during build that there's no sync IO.
                // but it can happen e.g. after a revalidation or conditionally for a param that wasn't prerendered.
                // we should change this to track sync IO, log an error and advance to dynamic.
                const shouldTrackSyncIO = false;
                const stageController = new _stagedrendering.StagedRenderingController(null, null, shouldTrackSyncIO);
                requestStore.stale = _constants1.INFINITE_CACHE;
                requestStore.stagedRendering = stageController;
                (0, _staletime.trackStaleTime)(requestStore, staleTimeIterable, selectStaleTime);
                let resolveStaticStageByteLength;
                const staticStageByteLengthPromise = new Promise((resolve)=>{
                    resolveStaticStageByteLength = resolve;
                });
                // If the route has runtime prefetching enabled, spawn a runtime
                // prerender after the resume render fills caches. The result is
                // embedded in the initial RSC payload so the client can cache
                // runtime-prefetchable content during hydration.
                const hasRuntimePrefetch = await (0, _instantconfig.anySegmentHasRuntimePrefetchEnabled)(tree);
                let runtimePrefetchStream;
                if (hasRuntimePrefetch) {
                    const prerenderResumeDataCache = (0, _resumedatacache.createPrerenderResumeDataCache)();
                    requestStore.prerenderResumeDataCache = prerenderResumeDataCache;
                    const cacheSignal = new _cachesignal.CacheSignal();
                    (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
                    requestStore.cacheSignal = cacheSignal;
                    const runtimePrefetchTransform = new TransformStream();
                    runtimePrefetchStream = runtimePrefetchTransform.readable;
                    void cacheSignal.cacheReady().then(()=>spawnRuntimePrefetchWithFilledCaches(runtimePrefetchTransform.writable, ctx, prerenderResumeDataCache, requestStore, serverComponentsErrorHandler));
                }
                const RSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, getRSCPayload, tree, ctx, {
                    is404: res.statusCode === 404,
                    staleTimeIterable,
                    staticStageByteLengthPromise,
                    runtimePrefetchStream
                });
                const flightStream = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
                    stageController.advanceStage(_stagedrendering.RenderStage.Static);
                    const stream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, renderToReadableStream, RSCPayload, clientModules, {
                        onError: serverComponentsErrorHandler,
                        filterStackFrame
                    });
                    const [dynamicStream, staticStream] = stream.tee();
                    countStaticStageBytes(staticStream, stageController).then(resolveStaticStageByteLength);
                    return dynamicStream;
                }, ()=>{
                    // This is a separate task that doesn't advance a stage. It forces
                    // draining the microtask queue so that the stale time iterable is
                    // closed before we advance to the dynamic stage.
                    void (0, _staletime.finishStaleTimeTracking)(staleTimeIterable);
                }, ()=>{
                    stageController.advanceStage(_stagedrendering.RenderStage.Dynamic);
                });
                reactServerResult = new _apprenderprerenderutils.ReactServerResult(flightStream);
            } else {
                // This is a dynamic render. We don't do dynamic tracking because we're not prerendering
                const RSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, getRSCPayload, tree, ctx, {
                    is404: res.statusCode === 404
                });
                const debugChannel = setReactDebugChannel && (0, _debugchannelserver.createDebugChannel)();
                if (debugChannel) {
                    const [readableSsr, readableBrowser] = debugChannel.clientSide.readable.tee();
                    reactDebugStream = readableSsr;
                    setReactDebugChannel({
                        readable: readableBrowser
                    }, htmlRequestId, requestId);
                }
                reactServerResult = new _apprenderprerenderutils.ReactServerResult(_workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ctx.componentMod, RSCPayload, clientModules, {
                    filterStackFrame,
                    onError: serverComponentsErrorHandler,
                    debugChannel: debugChannel == null ? void 0 : debugChannel.serverSide
                }));
            }
            // React doesn't start rendering synchronously but we want the RSC render to have a chance to start
            // before we begin SSR rendering because we want to capture any available preload headers so we tick
            // one task before continuing
            await (0, _scheduler.waitAtLeastOneReactRenderTask)();
            // If provided, the postpone state should be parsed as JSON so it can be
            // provided to React.
            if (typeof renderOpts.postponed === 'string') {
                if ((postponedState == null ? void 0 : postponedState.type) === _postponedstate.DynamicState.DATA) {
                    // We have a complete HTML Document in the prerender but we need to
                    // still include the new server component render because it was not included
                    // in the static prelude.
                    const inlinedDataStream = (0, _streamops.createInlinedDataStream)(reactServerResult.tee(), nonce, formState);
                    // End the span since there's no async rendering in this path
                    if (renderSpan.isRecording()) renderSpan.end();
                    return (0, _streamops.chainStreams)(inlinedDataStream, (0, _streamops.createDocumentClosingStream)());
                } else if (postponedState) {
                    // We assume we have dynamic HTML requiring a resume render to complete
                    const { postponed, preludeState } = (0, _postponedstate.getPostponedFromState)(postponedState);
                    const resumeAppElement = /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                        reactServerStream: reactServerResult.tee(),
                        reactDebugStream: reactDebugStream,
                        debugEndTime: undefined,
                        preinitScripts: preinitScripts,
                        ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                        nonce: nonce,
                        images: ctx.renderOpts.images
                    });
                    const getServerInsertedHTML = (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                        polyfills,
                        renderServerInsertedHTML,
                        serverCapturedErrors: allCapturedErrors,
                        basePath,
                        tracingMetadata: tracingMetadata
                    });
                    const { stream: htmlStream, allReady } = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.resumeToFizzStream, resumeAppElement, postponed, {
                        onError: htmlRendererErrorHandler,
                        nonce
                    });
                    // End the render span only after React completed rendering (including anything inside Suspense boundaries)
                    allReady.finally(()=>{
                        if (renderSpan.isRecording()) renderSpan.end();
                    });
                    return await (0, _streamops.continueDynamicHTMLResume)(htmlStream, {
                        delayDataUntilFirstHtmlChunk: preludeState === _postponedstate.DynamicHTMLPreludeState.Empty,
                        inlinedDataStream: (0, _streamops.createInlinedDataStream)(reactServerResult.consume(), nonce, formState),
                        getServerInsertedHTML,
                        getServerInsertedMetadata,
                        deploymentId: ctx.sharedContext.deploymentId
                    });
                }
            }
            // This is a regular dynamic render
            const getServerInsertedHTML = (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                polyfills,
                renderServerInsertedHTML,
                serverCapturedErrors: allCapturedErrors,
                basePath,
                tracingMetadata: tracingMetadata
            });
            const generateStaticHTML = supportsDynamicResponse !== true || !!shouldWaitOnAllReady;
            const appElement = /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                reactServerStream: reactServerResult.tee(),
                reactDebugStream: reactDebugStream,
                debugEndTime: undefined,
                preinitScripts: preinitScripts,
                ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                nonce: nonce,
                images: ctx.renderOpts.images
            });
            const fizzOptions = {
                onError: htmlRendererErrorHandler,
                nonce,
                onHeaders: (headers)=>{
                    headers.forEach((value, key)=>{
                        appendHeader(key, value);
                    });
                },
                maxHeadersLength: reactMaxHeadersLength,
                bootstrapScriptContent,
                bootstrapScripts: [
                    bootstrapScript
                ],
                formState
            };
            const { stream: htmlStream, allReady } = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFizzStream, appElement, fizzOptions);
            // End the render span only after React completed rendering (including anything inside Suspense boundaries)
            allReady.finally(()=>{
                if (renderSpan.isRecording()) renderSpan.end();
            });
            return await (0, _streamops.continueFizzStream)(htmlStream, {
                inlinedDataStream: (0, _streamops.createInlinedDataStream)(reactServerResult.consume(), nonce, formState),
                isStaticGeneration: generateStaticHTML,
                allReady,
                deploymentId: ctx.sharedContext.deploymentId,
                getServerInsertedHTML,
                getServerInsertedMetadata,
                validateRootLayout: !!process.env.__NEXT_DEV_SERVER
            });
        } catch (err) {
            if ((0, _staticgenerationbailout.isStaticGenBailoutError)(err) || typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string' && err.message.includes('https://nextjs.org/docs/advanced-features/static-html-export')) {
                // Ensure that "next dev" prints the red error overlay
                endSpanWithError(err);
                throw err;
            }
            // If a bailout made it to this point, it means it wasn't wrapped inside
            // a suspense boundary.
            const shouldBailoutToCSR = (0, _bailouttocsr.isBailoutToCSRError)(err);
            if (shouldBailoutToCSR) {
                const stack = (0, _formatservererror.getStackWithoutErrorMessage)(err);
                (0, _log.error)(`${err.reason} should be wrapped in a suspense boundary at page "${pagePath}". Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout\n${stack}`);
                endSpanWithError(err);
                throw err;
            }
            let errorType;
            if ((0, _httpaccessfallback.isHTTPAccessFallbackError)(err)) {
                res.statusCode = (0, _httpaccessfallback.getAccessFallbackHTTPStatus)(err);
                metadata.statusCode = res.statusCode;
                errorType = (0, _httpaccessfallback.getAccessFallbackErrorTypeByStatus)(res.statusCode);
            } else if ((0, _redirecterror.isRedirectError)(err)) {
                errorType = 'redirect';
                res.statusCode = (0, _redirect.getRedirectStatusCodeFromError)(err);
                metadata.statusCode = res.statusCode;
                const redirectUrl = (0, _addpathprefix.addPathPrefix)((0, _redirect.getURLFromRedirectError)(err), basePath);
                // If there were mutable cookies set, we need to set them on the
                // response.
                const headers = new Headers();
                if ((0, _requestcookies.appendMutableCookies)(headers, requestStore.mutableCookies)) {
                    setHeader('set-cookie', Array.from(headers.values()));
                }
                setHeader('location', redirectUrl);
            } else if (!shouldBailoutToCSR) {
                res.statusCode = 500;
                metadata.statusCode = res.statusCode;
            }
            const [errorPreinitScripts, errorBootstrapScript] = (0, _requiredscripts.getRequiredScripts)(buildManifest, assetPrefix, crossOrigin, subresourceIntegrityManifest, (0, _getassetquerystring.getAssetQueryString)(ctx, false), nonce, '/_not-found/page');
            let errorRSCPayload;
            let errorServerStream;
            try {
                errorRSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, getErrorRSCPayload, tree, ctx, reactServerErrorsByDigest.has(err.digest) ? null : err, errorType);
                errorServerStream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ctx.componentMod, errorRSCPayload, clientModules, {
                    filterStackFrame,
                    onError: serverComponentsErrorHandler
                });
                if (reactServerResult === null) {
                    // We errored when we did not have an RSC stream to read from. This is not just a render
                    // error, we need to throw early
                    endSpanWithError(err);
                    throw err;
                }
            } catch (setupErr) {
                endSpanWithError(setupErr);
                throw setupErr;
            }
            try {
                const generateStaticHTML = supportsDynamicResponse !== true || !!shouldWaitOnAllReady;
                const { stream: errorHtmlStream, allReady: errorAllReady } = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFizzStream, /*#__PURE__*/ (0, _jsxruntime.jsx)(ErrorApp, {
                    reactServerStream: errorServerStream,
                    ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                    preinitScripts: errorPreinitScripts,
                    nonce: nonce,
                    images: ctx.renderOpts.images
                }), {
                    nonce,
                    bootstrapScriptContent,
                    bootstrapScripts: [
                        errorBootstrapScript
                    ],
                    formState
                });
                // End the render span only after React completed rendering (including anything inside Suspense boundaries)
                errorAllReady.finally(()=>{
                    if (renderSpan.isRecording()) renderSpan.end();
                });
                return await (0, _streamops.continueFizzStream)(errorHtmlStream, {
                    inlinedDataStream: (0, _streamops.createInlinedDataStream)(// This is intentionally using the readable datastream from the
                    // main render rather than the flight data from the error page
                    // render
                    reactServerResult.consume(), nonce, formState),
                    isStaticGeneration: generateStaticHTML,
                    deploymentId: ctx.sharedContext.deploymentId,
                    getServerInsertedHTML: (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                        polyfills,
                        renderServerInsertedHTML,
                        serverCapturedErrors: [],
                        basePath,
                        tracingMetadata: tracingMetadata
                    }),
                    getServerInsertedMetadata,
                    validateRootLayout: !!process.env.__NEXT_DEV_SERVER
                });
            } catch (finalErr) {
                if (process.env.__NEXT_DEV_SERVER && (0, _httpaccessfallback.isHTTPAccessFallbackError)(finalErr)) {
                    const { bailOnRootNotFound } = require('../../client/components/dev-root-http-access-fallback-boundary');
                    bailOnRootNotFound();
                }
                endSpanWithError(finalErr);
                throw finalErr;
            }
        }
    });
/* eslint-enable @next/internal/no-ambiguous-jsx */ }
async function renderWithRestartOnCacheMissInDev(ctx, initialRequestStore, createRequestStore, getPayload, onError) {
    const { htmlRequestId, renderOpts } = ctx;
    const { ComponentMod, setCacheStatus, setReactDebugChannel } = renderOpts;
    let startTime = -Infinity;
    // If the render is restarted, we'll recreate a fresh request store
    let requestStore = initialRequestStore;
    const environmentName = ()=>{
        const currentStage = requestStore.stagedRendering.currentStage;
        switch(currentStage){
            case _stagedrendering.RenderStage.Before:
            case _stagedrendering.RenderStage.EarlyStatic:
            case _stagedrendering.RenderStage.Static:
                return 'Prerender';
            case _stagedrendering.RenderStage.EarlyRuntime:
                return 'Prefetch';
            case _stagedrendering.RenderStage.Runtime:
                return 'Prefetchable';
            case _stagedrendering.RenderStage.Dynamic:
            case _stagedrendering.RenderStage.Abandoned:
                return 'Server';
            default:
                currentStage;
                throw Object.defineProperty(new _invarianterror.InvariantError(`Invalid render stage: ${currentStage}`), "__NEXT_ERROR_CODE", {
                    value: "E881",
                    enumerable: false,
                    configurable: true
                });
        }
    };
    //===============================================
    // Initial render
    //===============================================
    // Try to render the page and see if there's any cache misses.
    // If there are, wait for caches to finish and restart the render.
    // This render might end up being used as a prospective render (if there's cache misses),
    // so we need to set it up for filling caches.
    const cacheSignal = new _cachesignal.CacheSignal();
    // If we encounter async modules that delay rendering, we'll also need to restart.
    // TODO(restart-on-cache-miss): technically, we only need to wait for pending *server* modules here,
    // but `trackPendingModules` doesn't distinguish between client and server.
    (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
    const prerenderResumeDataCache = (0, _resumedatacache.createPrerenderResumeDataCache)();
    const initialReactController = new AbortController();
    const initialDataController = new AbortController() // Controls hanging promises we create
    ;
    const initialAbandonController = new AbortController() // Controls whether this render is abandoned
    ;
    const initialStageController = new _stagedrendering.StagedRenderingController(initialDataController.signal, initialAbandonController, true // track sync IO
    );
    requestStore.prerenderResumeDataCache = prerenderResumeDataCache;
    // `getRenderResumeDataCache` will fall back to using `prerenderResumeDataCache` as `renderResumeDataCache`,
    // so not having a resume data cache won't break any expectations in case we don't need to restart.
    requestStore.renderResumeDataCache = null;
    requestStore.stagedRendering = initialStageController;
    requestStore.asyncApiPromises = createAsyncApiPromises(initialStageController, requestStore.cookies, requestStore.mutableCookies, requestStore.headers);
    requestStore.cacheSignal = cacheSignal;
    let debugChannel = setReactDebugChannel && (0, _debugchannelserver.createDebugChannel)();
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    // Note: The stage controller starts out in the `Before` stage,
    // where sync IO does not cause aborts, so it's okay if it happens before render.
    const initialRscPayload = await getPayload(requestStore);
    const initialStreamResult = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
        initialStageController.advanceStage(_stagedrendering.RenderStage.EarlyStatic);
        startTime = performance.now() + performance.timeOrigin;
        const streamPair = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ComponentMod, initialRscPayload, clientModules, {
            onError,
            environmentName,
            startTime,
            filterStackFrame,
            debugChannel: debugChannel == null ? void 0 : debugChannel.serverSide,
            signal: initialReactController.signal
        }).tee();
        // If we abort the render, we want to reject the stage-dependent promises as well.
        // Note that we want to install this listener after the render is started
        // so that it runs after react is finished running its abort code.
        initialReactController.signal.addEventListener('abort', ()=>{
            const { reason } = initialReactController.signal;
            initialDataController.abort(reason);
        }, {
            once: true
        });
        const stream = streamPair[0];
        const accumulatedChunksPromise = accumulateStreamChunks(streamPair[1], initialStageController, initialDataController.signal);
        initialDataController.signal.addEventListener('abort', ()=>{
            accumulatedChunksPromise.catch(()=>{});
            stream.cancel();
        }, {
            once: true
        });
        return {
            stream,
            accumulatedChunksPromise
        };
    }, ()=>{
        if (initialAbandonController.signal.aborted === true) {
            return;
        } else if (cacheSignal.hasPendingReads()) {
            initialAbandonController.abort();
        } else {
            initialStageController.advanceStage(_stagedrendering.RenderStage.Static);
        }
    }, ()=>{
        if (initialAbandonController.signal.aborted === true) {
            return;
        } else if (cacheSignal.hasPendingReads()) {
            initialAbandonController.abort();
        } else {
            initialStageController.advanceStage(_stagedrendering.RenderStage.EarlyRuntime);
        }
    }, ()=>{
        if (initialAbandonController.signal.aborted === true) {
            return;
        } else if (cacheSignal.hasPendingReads()) {
            initialAbandonController.abort();
        } else {
            initialStageController.advanceStage(_stagedrendering.RenderStage.Runtime);
        }
    }, ()=>{
        if (initialAbandonController.signal.aborted === true) {
            return;
        } else if (cacheSignal.hasPendingReads()) {
            initialAbandonController.abort();
        } else {
            initialStageController.advanceStage(_stagedrendering.RenderStage.Dynamic);
        }
    });
    if (initialStageController.currentStage !== _stagedrendering.RenderStage.Abandoned) {
        // No cache misses. We can use the result as-is.
        return {
            stream: initialStreamResult.stream,
            accumulatedChunksPromise: initialStreamResult.accumulatedChunksPromise,
            syncInterruptReason: initialStageController.getSyncInterruptReason(),
            startTime,
            staticStageEndTime: initialStageController.getStaticStageEndTime(),
            runtimeStageEndTime: initialStageController.getRuntimeStageEndTime(),
            debugChannel,
            requestStore
        };
    }
    if (process.env.__NEXT_DEV_SERVER && setCacheStatus) {
        setCacheStatus('filling', htmlRequestId);
    }
    // Cache miss. We will use the initial render to fill caches, and discard its result.
    // Then, we can render again with warm caches.
    // TODO(restart-on-cache-miss):
    // This might end up waiting for more caches than strictly necessary,
    // because we can't abort the render yet, and we'll let runtime/dynamic APIs resolve.
    // Ideally we'd only wait for caches that are needed in the static stage.
    // This will be optimized in the future by not allowing runtime/dynamic APIs to resolve.
    await cacheSignal.cacheReady();
    initialReactController.abort();
    //===============================================
    // Final render (restarted)
    //===============================================
    // The initial render acted as a prospective render to warm the caches.
    requestStore = createRequestStore();
    // We are going to render this pass all the way through because we've already
    // filled any caches so we won't be aborting this time.
    const abortSignal = null;
    const finalStageController = new _stagedrendering.StagedRenderingController(abortSignal, null, true // track sync IO
    );
    // We've filled the caches, so now we can render as usual,
    // without any cache-filling mechanics.
    requestStore.prerenderResumeDataCache = null;
    requestStore.renderResumeDataCache = (0, _resumedatacache.createRenderResumeDataCache)(prerenderResumeDataCache);
    requestStore.stagedRendering = finalStageController;
    requestStore.cacheSignal = null;
    requestStore.asyncApiPromises = createAsyncApiPromises(finalStageController, requestStore.cookies, requestStore.mutableCookies, requestStore.headers);
    // The initial render already wrote to its debug channel.
    // We're not using it, so we need to create a new one.
    debugChannel = setReactDebugChannel && (0, _debugchannelserver.createDebugChannel)();
    // Note: The stage controller starts out in the `Before` stage,
    // where sync IO does not cause aborts, so it's okay if it happens before render.
    const finalRscPayload = await getPayload(requestStore);
    const finalStreamResult = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
        finalStageController.advanceStage(_stagedrendering.RenderStage.EarlyStatic);
        startTime = performance.now() + performance.timeOrigin;
        const streamPair = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ComponentMod, finalRscPayload, clientModules, {
            onError,
            environmentName,
            startTime,
            filterStackFrame,
            debugChannel: debugChannel == null ? void 0 : debugChannel.serverSide
        }).tee();
        return {
            stream: streamPair[0],
            accumulatedChunksPromise: accumulateStreamChunks(streamPair[1], finalStageController, null)
        };
    }, ()=>{
        // Static stage
        finalStageController.advanceStage(_stagedrendering.RenderStage.Static);
    }, ()=>{
        // EarlyRuntime stage
        finalStageController.advanceStage(_stagedrendering.RenderStage.EarlyRuntime);
    }, ()=>{
        // Runtime stage
        finalStageController.advanceStage(_stagedrendering.RenderStage.Runtime);
    }, ()=>{
        // Dynamic stage
        finalStageController.advanceStage(_stagedrendering.RenderStage.Dynamic);
    });
    if (process.env.__NEXT_DEV_SERVER && setCacheStatus) {
        setCacheStatus('filled', htmlRequestId);
    }
    return {
        stream: finalStreamResult.stream,
        accumulatedChunksPromise: finalStreamResult.accumulatedChunksPromise,
        syncInterruptReason: finalStageController.getSyncInterruptReason(),
        startTime,
        staticStageEndTime: finalStageController.getStaticStageEndTime(),
        runtimeStageEndTime: finalStageController.getRuntimeStageEndTime(),
        debugChannel,
        requestStore
    };
}
async function accumulateStreamChunks(stream, stageController, signal) {
    const staticChunks = [];
    const runtimeChunks = [];
    const dynamicChunks = [];
    const reader = stream.getReader();
    let cancelled = false;
    function cancel() {
        if (!cancelled) {
            cancelled = true;
            reader.cancel();
        }
    }
    if (signal) {
        signal.addEventListener('abort', cancel, {
            once: true
        });
    }
    try {
        while(!cancelled){
            const { done, value } = await reader.read();
            if (done) {
                cancel();
                break;
            }
            switch(stageController.currentStage){
                case _stagedrendering.RenderStage.Before:
                    throw Object.defineProperty(new _invarianterror.InvariantError('Unexpected stream chunk while in Before stage'), "__NEXT_ERROR_CODE", {
                        value: "E942",
                        enumerable: false,
                        configurable: true
                    });
                case _stagedrendering.RenderStage.EarlyStatic:
                case _stagedrendering.RenderStage.Static:
                    staticChunks.push(value);
                // fall through
                case _stagedrendering.RenderStage.EarlyRuntime:
                case _stagedrendering.RenderStage.Runtime:
                    runtimeChunks.push(value);
                // fall through
                case _stagedrendering.RenderStage.Dynamic:
                    dynamicChunks.push(value);
                    break;
                case _stagedrendering.RenderStage.Abandoned:
                    break;
                default:
                    stageController.currentStage;
                    break;
            }
        }
    } catch (err) {
        // When we cancel the reader we may reject the read.
        // Only swallow errors caused by our intentional cancel();
        // re-throw unexpected errors to avoid silently returning partial data.
        if (!cancelled) {
            throw err;
        }
    }
    return {
        staticChunks,
        runtimeChunks,
        dynamicChunks
    };
}
async function countStaticStageBytes(stream, stageController) {
    let byteLength = 0;
    const reader = stream.getReader();
    stageController.onStage(_stagedrendering.RenderStage.EarlyRuntime, ()=>{
        reader.cancel();
    });
    while(true){
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (stageController.currentStage <= _stagedrendering.RenderStage.Static) {
            byteLength += value.byteLength;
        } else {
            reader.cancel();
            break;
        }
    }
    return byteLength;
}
function createAsyncApiPromises(stagedRendering, cookies, mutableCookies, headers) {
    return {
        // Runtime APIs (for prefetch segments)
        cookies: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.Runtime, 'cookies', cookies),
        earlyCookies: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.EarlyRuntime, 'cookies', cookies),
        mutableCookies: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.Runtime, 'cookies', mutableCookies),
        earlyMutableCookies: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.EarlyRuntime, 'cookies', mutableCookies),
        headers: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.Runtime, 'headers', headers),
        earlyHeaders: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.EarlyRuntime, 'headers', headers),
        // These are not used directly, but we chain other `params`/`searchParams` promises off of them.
        sharedParamsParent: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.Runtime, undefined, '<internal params>'),
        earlySharedParamsParent: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.EarlyRuntime, undefined, '<internal params>'),
        sharedSearchParamsParent: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.Runtime, undefined, '<internal searchParams>'),
        earlySharedSearchParamsParent: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.EarlyRuntime, undefined, '<internal searchParams>'),
        connection: stagedRendering.delayUntilStage(_stagedrendering.RenderStage.Dynamic, 'connection', undefined)
    };
}
/**
 * Logs the given messages, and sends the error instances to the browser as an
 * RSC stream, where they can be deserialized and logged (or otherwise presented
 * in the devtools), while leveraging React's capabilities to not only
 * source-map the stack frames (via findSourceMapURL), but also create virtual
 * server modules that allow users to inspect the server source code in the
 * browser.
 */ async function logMessagesAndSendErrorsToBrowser(messages, ctx) {
    const { htmlRequestId, renderOpts } = ctx;
    const { sendErrorsToBrowser } = renderOpts;
    const errors = [];
    for (const message of messages){
        // Log the error to the CLI. Prevent the logs from being dimmed, which we
        // apply for other logs during the spawned validation.
        _consoleasyncstorageexternal.consoleAsyncStorage.exit(()=>{
            console.error(message);
        });
        // Error instances are also sent to the browser. We're currently using a
        // non-Error message only in debug build mode as a message that is only
        // meant for the CLI. FIXME: This is a bit spooky action at a distance. We
        // should maybe have a more explicit way of determining which messages
        // should be sent to the browser. Regardless, only real errors with a proper
        // stack make sense to be "replayed" in the browser.
        if (message instanceof Error) {
            errors.push(message);
        }
    }
    if (errors.length > 0) {
        if (!sendErrorsToBrowser) {
            throw Object.defineProperty(new _invarianterror.InvariantError('Expected `sendErrorsToBrowser` to be defined in renderOpts.'), "__NEXT_ERROR_CODE", {
                value: "E947",
                enumerable: false,
                configurable: true
            });
        }
        // Build a Map of error → error code for errors that have one.
        // React doesn't revive __NEXT_ERROR_CODE during RSC deserialization, so we
        // send it as a side-channel Map. RSC preserves object identity, so the
        // deserialized Map keys will reference the same Error objects.
        const errorCodes = new Map();
        for (const err of errors){
            const code = (0, _errortelemetryutils.extractNextErrorCode)(err);
            if (code !== undefined) {
                errorCodes.set(err, code);
            }
        }
        const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
        const errorsFlightStream = (0, _streamops.renderToFlightStream)(ctx.componentMod, {
            errors,
            errorCodes
        }, clientModules, {
            filterStackFrame
        });
        sendErrorsToBrowser(errorsFlightStream, htmlRequestId);
    }
}
function logValidationSkipped(ctx) {
    if (process.env.__NEXT_TEST_MODE && process.env.NEXT_TEST_LOG_VALIDATION) {
        const requestId = ctx.requestId;
        const url = ctx.url.href;
        console.log('<VALIDATION_MESSAGE>' + JSON.stringify({
            type: 'validation_start',
            requestId,
            url
        }) + '</VALIDATION_MESSAGE>');
        console.log('<VALIDATION_MESSAGE>' + JSON.stringify({
            type: 'validation_end',
            requestId,
            url
        }) + '</VALIDATION_MESSAGE>');
    }
}
async function spawnStaticShellValidationInDev(...args) {
    if (process.env.__NEXT_TEST_MODE && process.env.NEXT_TEST_LOG_VALIDATION) {
        const ctx = args[5];
        const requestId = ctx.requestId;
        const url = ctx.url.href;
        console.log('<VALIDATION_MESSAGE>' + JSON.stringify({
            type: 'validation_start',
            requestId,
            url
        }) + '</VALIDATION_MESSAGE>');
        try {
            return await spawnStaticShellValidationInDevImpl(...args);
        } finally{
            console.log('<VALIDATION_MESSAGE>' + JSON.stringify({
                type: 'validation_end',
                requestId,
                url
            }) + '</VALIDATION_MESSAGE>');
        }
    } else {
        return await spawnStaticShellValidationInDevImpl(...args);
    }
}
/**
 * This function is a fork of prerenderToStream cacheComponents branch.
 * While it doesn't return a stream we want it to have identical
 * prerender semantics to prerenderToStream and should update it
 * in conjunction with any changes to that function.
 */ async function spawnStaticShellValidationInDevImpl(accumulatedChunksPromise, syncInterruptReason, startTime, staticStageEndTime, runtimeStageEndTime, ctx, requestStore, fallbackRouteParams, debugChannelClient) {
    const debug = process.env.NEXT_PRIVATE_DEBUG_VALIDATION === '1' ? console.log : undefined;
    const { componentMod: ComponentMod, getDynamicParamFromSegment, renderOpts, workStore } = ctx;
    const loaderTree = ComponentMod.routeModule.userland.loaderTree;
    const allowEmptyStaticShell = (renderOpts.allowEmptyStaticShell ?? false) || await (0, _instantconfig.isPageAllowedToBlock)(loaderTree);
    const rootParams = (0, _createcomponenttree.getRootParams)(loaderTree, getDynamicParamFromSegment);
    const hmrRefreshHash = (0, _workunitasyncstorageexternal.getHmrRefreshHash)(requestStore);
    // We don't need to continue the prerender process if we already
    // detected invalid dynamic usage in the initial prerender phase.
    const { invalidDynamicUsageError } = workStore;
    if (invalidDynamicUsageError) {
        return logMessagesAndSendErrorsToBrowser([
            invalidDynamicUsageError
        ], ctx);
    }
    if (syncInterruptReason) {
        return logMessagesAndSendErrorsToBrowser([
            syncInterruptReason
        ], ctx);
    }
    let debugChunks = null;
    if (debugChannelClient) {
        debugChunks = [];
        debugChannelClient.on('data', (c)=>{
            debugChunks.push(c);
        });
    }
    const accumulatedChunks = await accumulatedChunksPromise;
    const { staticChunks, runtimeChunks, dynamicChunks } = accumulatedChunks;
    const needsInstantValidation = await (0, _instantconfig.anySegmentNeedsInstantValidationInDev)(loaderTree);
    // `samples` from instant config are only used during build
    const validationSamples = null;
    const validationSampleTracking = null;
    // First we warmup SSR with the runtime chunks. This ensures that when we do
    // the full prerender pass with dynamic tracking module loading won't
    // interrupt the prerender and can properly observe the entire content
    await warmupClientModulesForStagedValidation(// if we're going to be validating prefetches, we'll be rendering some segments in the dynamic stage.
    // otherwise, for static shell validation, we only need to warm up to the runtime stage.
    // we also need to use a different store type, because instant validation allows more APIs to resolve.
    needsInstantValidation ? 'validation-client' : 'prerender-client', needsInstantValidation ? dynamicChunks : runtimeChunks, dynamicChunks, rootParams, fallbackRouteParams, allowEmptyStaticShell, ctx, validationSamples, validationSampleTracking);
    debug == null ? void 0 : debug(`Starting static shell validation...`);
    const runtimeResult = await validateStagedShell(runtimeChunks, dynamicChunks, debugChunks, runtimeStageEndTime, rootParams, fallbackRouteParams, allowEmptyStaticShell, ctx, hmrRefreshHash, _dynamicrendering.trackDynamicHoleInRuntimeShell);
    if (runtimeResult.length > 0) {
        debug == null ? void 0 : debug(`❌ Failed - ${runtimeResult.length} errors from runtime stage`);
        // We have something to report from the runtime validation
        // We can skip the rest
        return logMessagesAndSendErrorsToBrowser(runtimeResult, ctx);
    }
    const staticResult = await validateStagedShell(staticChunks, dynamicChunks, debugChunks, staticStageEndTime, rootParams, fallbackRouteParams, allowEmptyStaticShell, ctx, hmrRefreshHash, _dynamicrendering.trackDynamicHoleInStaticShell);
    if (staticResult.length > 0) {
        debug == null ? void 0 : debug(`❌ Failed - ${staticResult.length} errors from static stage`);
        // We have something to report from the static validation
        // We can skip the rest
        return logMessagesAndSendErrorsToBrowser(staticResult, ctx);
    }
    debug == null ? void 0 : debug(`✅ Passed`);
    if (needsInstantValidation) {
        const instantConfigsResult = await validateInstantConfigs(accumulatedChunks, debugChunks, startTime, rootParams, fallbackRouteParams, ctx, hmrRefreshHash, validationSamples);
        if (instantConfigsResult.length > 0) {
            return logMessagesAndSendErrorsToBrowser(instantConfigsResult, ctx);
        }
    }
}
async function warmupClientModulesForStagedValidation(storeType, partialServerChunks, allServerChunks, rootParams, fallbackRouteParams, allowEmptyStaticShell, ctx, validationSamples, validationSampleTracking) {
    const { implicitTags, nonce, workStore } = ctx;
    // Warmup SSR
    const initialClientPrerenderController = new AbortController();
    const initialClientReactController = new AbortController();
    const initialClientRenderController = new AbortController();
    const preinitScripts = ()=>{};
    const { ServerInsertedHTMLProvider } = (0, _serverinsertedhtml.createServerInsertedHTML)();
    let initialClientPrerenderStore;
    if (storeType === 'prerender-client') {
        const store = {
            type: 'prerender-client',
            phase: 'render',
            rootParams,
            fallbackRouteParams,
            implicitTags,
            renderSignal: initialClientRenderController.signal,
            controller: initialClientPrerenderController,
            // For HTML Generation the only cache tracked activity
            // is module loading, which has it's own cache signal
            cacheSignal: null,
            dynamicTracking: null,
            allowEmptyStaticShell,
            revalidate: _constants1.INFINITE_CACHE,
            expire: _constants1.INFINITE_CACHE,
            stale: _constants1.INFINITE_CACHE,
            tags: [
                ...implicitTags.tags
            ],
            // TODO should this be removed from client stores?
            prerenderResumeDataCache: null,
            renderResumeDataCache: null,
            hmrRefreshHash: undefined,
            // Client prerenders don't track server param access
            varyParamsAccumulator: null
        };
        initialClientPrerenderStore = store;
    } else {
        const store = {
            type: 'validation-client',
            phase: 'render',
            rootParams,
            implicitTags,
            renderSignal: initialClientRenderController.signal,
            controller: initialClientPrerenderController,
            // For HTML Generation the only cache tracked activity
            // is module loading, which has it's own cache signal
            cacheSignal: null,
            dynamicTracking: null,
            revalidate: _constants1.INFINITE_CACHE,
            expire: _constants1.INFINITE_CACHE,
            stale: _constants1.INFINITE_CACHE,
            tags: [
                ...implicitTags.tags
            ],
            // TODO should this be removed from client stores?
            prerenderResumeDataCache: null,
            renderResumeDataCache: null,
            hmrRefreshHash: undefined,
            // Client prerenders don't track server param access
            varyParamsAccumulator: null,
            // We're not rendering any validation boundaries yet.
            boundaryState: null,
            validationSamples,
            validationSampleTracking,
            fallbackRouteParams
        };
        initialClientPrerenderStore = store;
    }
    // TODO: maybe conditionally switch between runtime chunks and all chunks?
    // but warming too much should always be fine, just not always necessary
    const serverStream = (0, _streamutils.createNodeStreamWithLateRelease)(partialServerChunks, allServerChunks, initialClientReactController.signal);
    const pendingInitialClientResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(initialClientPrerenderStore, _streamops.getClientPrerender, // eslint-disable-next-line @next/internal/no-ambiguous-jsx -- React Client
    /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
        reactServerStream: serverStream,
        reactDebugStream: undefined,
        debugEndTime: undefined,
        preinitScripts: preinitScripts,
        ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
        nonce: nonce,
        images: ctx.renderOpts.images
    }), {
        signal: initialClientReactController.signal,
        onError: (err)=>{
            const digest = (0, _createerrorhandler.getDigestForWellKnownError)(err);
            if (digest) {
                return digest;
            }
            if ((0, _reactlargeshellerror.isReactLargeShellError)(err)) {
                // TODO: Aggregate
                console.error(err);
                return undefined;
            }
            if (initialClientReactController.signal.aborted) {
            // These are expected errors that might error the prerender. we ignore them.
            } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
                // We don't normally log these errors because we are going to retry anyway but
                // it can be useful for debugging Next.js itself to get visibility here when needed
                (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
            }
        }
    });
    // The listener to abort our own render controller must be added after React
    // has added its listener, to ensure that pending I/O is not
    // aborted/rejected too early.
    initialClientReactController.signal.addEventListener('abort', ()=>{
        initialClientRenderController.abort();
    }, {
        once: true
    });
    pendingInitialClientResult.catch((err)=>{
        if (initialClientReactController.signal.aborted || (0, _dynamicrendering.isPrerenderInterruptedError)(err)) {
        // These are expected errors that might error the prerender. we ignore them.
        } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
            // We don't normally log these errors because we are going to retry anyway but
            // it can be useful for debugging Next.js itself to get visibility here when needed
            (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
        }
    });
    // This is mostly needed for dynamic `import()`s in client components.
    // Promises passed to client were already awaited above (assuming that they came from cached functions)
    const cacheSignal = new _cachesignal.CacheSignal();
    (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
    await cacheSignal.cacheReady();
    initialClientReactController.abort();
}
async function validateStagedShell(stageChunks, allServerChunks, debugChunks, debugEndTime, rootParams, fallbackRouteParams, allowEmptyStaticShell, ctx, hmrRefreshHash, trackDynamicHole) {
    const { implicitTags, nonce, workStore } = ctx;
    const clientDynamicTracking = (0, _dynamicrendering.createDynamicTrackingState)(false //isDebugDynamicAccesses
    );
    const clientReactController = new AbortController();
    const clientRenderController = new AbortController();
    const preinitScripts = ()=>{};
    const { ServerInsertedHTMLProvider } = (0, _serverinsertedhtml.createServerInsertedHTML)();
    const finalClientPrerenderStore = {
        type: 'prerender-client',
        phase: 'render',
        rootParams,
        fallbackRouteParams,
        implicitTags,
        renderSignal: clientRenderController.signal,
        controller: clientReactController,
        // No APIs require a cacheSignal through the workUnitStore during the HTML prerender
        cacheSignal: null,
        dynamicTracking: clientDynamicTracking,
        allowEmptyStaticShell,
        revalidate: _constants1.INFINITE_CACHE,
        expire: _constants1.INFINITE_CACHE,
        stale: _constants1.INFINITE_CACHE,
        tags: [
            ...implicitTags.tags
        ],
        // TODO should this be removed from client stores?
        prerenderResumeDataCache: null,
        renderResumeDataCache: null,
        hmrRefreshHash,
        // Client prerenders don't track server param access
        varyParamsAccumulator: null
    };
    const dynamicValidation = (0, _dynamicrendering.createDynamicValidationState)();
    const serverStream = (0, _streamutils.createNodeStreamWithLateRelease)(stageChunks, allServerChunks, clientReactController.signal);
    const debugChannelClient = debugChunks ? (0, _streamutils.createNodeStreamWithLateRelease)(debugChunks, debugChunks, clientReactController.signal) : undefined;
    try {
        let { prelude: unprocessedPrelude } = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
            const pendingFinalClientResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(finalClientPrerenderStore, _streamops.getClientPrerender, // eslint-disable-next-line @next/internal/no-ambiguous-jsx -- React Client
            /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                reactServerStream: serverStream,
                reactDebugStream: debugChannelClient,
                debugEndTime: debugEndTime,
                preinitScripts: preinitScripts,
                ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                nonce: nonce,
                images: ctx.renderOpts.images
            }), {
                signal: clientReactController.signal,
                onError: (err, errorInfo)=>{
                    if ((0, _dynamicrendering.isPrerenderInterruptedError)(err) || clientReactController.signal.aborted) {
                        const componentStack = errorInfo.componentStack;
                        if (typeof componentStack === 'string') {
                            trackDynamicHole(workStore, componentStack, dynamicValidation, clientDynamicTracking);
                        }
                        return;
                    }
                    if ((0, _reactlargeshellerror.isReactLargeShellError)(err)) {
                        // TODO: Aggregate
                        console.error(err);
                        return undefined;
                    }
                    return (0, _createerrorhandler.getDigestForWellKnownError)(err);
                }
            });
            // The listener to abort our own render controller must be added after
            // React has added its listener, to ensure that pending I/O is not
            // aborted/rejected too early.
            clientReactController.signal.addEventListener('abort', ()=>{
                clientRenderController.abort();
            }, {
                once: true
            });
            return pendingFinalClientResult;
        }, ()=>{
            clientReactController.abort();
        });
        const { preludeIsEmpty } = await (0, _streamops.processPrelude)(unprocessedPrelude);
        return (0, _dynamicrendering.getStaticShellDisallowedDynamicReasons)(workStore, preludeIsEmpty ? _dynamicrendering.PreludeState.Empty : _dynamicrendering.PreludeState.Full, dynamicValidation, // TODO(instant-validation): if allowEmptyStaticShell is true (likely due to blocking configs),
        // we should probably just skip this altogether
        allowEmptyStaticShell);
    } catch (thrownValue) {
        // Even if the root errors we still want to report any cache components errors
        // that were discovered before the root errored.
        let errors = (0, _dynamicrendering.getStaticShellDisallowedDynamicReasons)(workStore, _dynamicrendering.PreludeState.Errored, dynamicValidation, // TODO(instant-validation): if allowEmptyStaticShell is true (likely due to blocking configs),
        // we should probably just skip this altogether
        allowEmptyStaticShell);
        if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
            errors.unshift('During dynamic validation the root of the page errored. The next logged error is the thrown value. It may be a duplicate of errors reported during the normal development mode render.', thrownValue);
        }
        return errors;
    }
}
/**
 * Validates instant configs by iterating URL depths from deepest to
 * shallowest. At each depth, builds a combined payload where segments
 * above the boundary use Dynamic stage (already mounted) and segments
 * below use Static/Runtime stage (being prefetched). If the new subtree
 * contains any `unstable_instant` configs, the payload is rendered to
 * detect dynamic holes without Suspense.
 */ async function validateInstantConfigs(accumulatedChunks, debugChunks, startTime, rootParams, fallbackRouteParams, ctx, hmrRefreshHash, validationSamples) {
    const debug = process.env.NEXT_PRIVATE_DEBUG_VALIDATION === '1' ? console.log : undefined;
    const { createCombinedPayloadAtDepth, createCombinedPayloadStream, collectStagedSegmentData, discoverValidationDepths } = ctx.componentMod.InstantValidation();
    const { createValidationSampleTracking } = require('./instant-validation/instant-samples');
    debug == null ? void 0 : debug('\nStarting depth-based instant validation...');
    const loaderTree = ctx.componentMod.routeModule.userland.loaderTree;
    // Only affects a debug environment name label, not functional behavior.
    const hasRuntimePrefetch = true;
    const clientReferenceManifest = (0, _manifestssingleton.getClientReferenceManifest)();
    const { cache, payload: initialRscPayload, stageEndTimes } = await collectStagedSegmentData({
        [_stagedrendering.RenderStage.Static]: accumulatedChunks.staticChunks,
        [_stagedrendering.RenderStage.Runtime]: accumulatedChunks.runtimeChunks,
        [_stagedrendering.RenderStage.Dynamic]: accumulatedChunks.dynamicChunks
    }, debugChunks, startTime, hasRuntimePrefetch, clientReferenceManifest);
    const { implicitTags, nonce, workStore } = ctx;
    const isDebugChannelEnabled = !!ctx.renderOpts.setReactDebugChannel;
    /**
   * Build and validate a combined payload at the given URL depth.
   *
   * Returns null if no instant config exists at this depth.
   * Returns an empty array if validation passed.
   * Returns a non-empty array of errors if validation failed.
   *
   * When the initial validation uses static segments and finds errors,
   * automatically retries with runtime stages to discriminate between
   * runtime and dynamic errors, returning the more specific result.
   */ async function validateAtDepth(depth, groupDepthForValidation) {
        return validateAtDepthImpl(depth, groupDepthForValidation, null);
    }
    async function validateAtDepthImpl(depth, groupDepthForValidation, previousBoundaryState) {
        const extraChunksController = new AbortController();
        const boundaryState = (0, _boundarytracking.createValidationBoundaryTracking)();
        let useRuntimeStageForPartialSegments = false;
        if (previousBoundaryState) {
            // We're doing a followup render to better discriminate error types
            useRuntimeStageForPartialSegments = true;
            for (const id of previousBoundaryState.expectedIds){
                boundaryState.expectedIds.add(id);
            }
        }
        const payloadResult = await createCombinedPayloadAtDepth(initialRscPayload, cache, loaderTree, ctx.getDynamicParamFromSegment, ctx.query, depth, groupDepthForValidation, extraChunksController.signal, boundaryState, clientReferenceManifest, stageEndTimes, useRuntimeStageForPartialSegments);
        if (payloadResult === null) {
            return null;
        }
        const reactController = new AbortController();
        const renderController = new AbortController();
        const preinitScripts = ()=>{};
        const { ServerInsertedHTMLProvider } = (0, _serverinsertedhtml.createServerInsertedHTML)();
        const { stream: serverStream, debugStream } = await createCombinedPayloadStream(payloadResult.payload, extraChunksController, reactController.signal, clientReferenceManifest, startTime, isDebugChannelEnabled);
        const instantValidationState = (0, _dynamicrendering.createInstantValidationState)(payloadResult.createInstantStack);
        const validationSampleTracking = validationSamples !== null ? createValidationSampleTracking() : null;
        const clientDynamicTracking = (0, _dynamicrendering.createDynamicTrackingState)(false);
        const prerenderStore = {
            type: 'validation-client',
            phase: 'render',
            rootParams,
            implicitTags,
            renderSignal: renderController.signal,
            controller: reactController,
            cacheSignal: null,
            dynamicTracking: clientDynamicTracking,
            revalidate: _constants1.INFINITE_CACHE,
            expire: _constants1.INFINITE_CACHE,
            stale: _constants1.INFINITE_CACHE,
            tags: [
                ...implicitTags.tags
            ],
            prerenderResumeDataCache: null,
            renderResumeDataCache: null,
            hmrRefreshHash,
            varyParamsAccumulator: null,
            boundaryState,
            fallbackRouteParams,
            validationSamples,
            validationSampleTracking
        };
        let errors;
        try {
            const { prelude: unprocessedPrelude } = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
                const pendingResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderStore, _streamops.getClientPrerender, // eslint-disable-next-line @next/internal/no-ambiguous-jsx -- React Client
                /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                    reactServerStream: serverStream,
                    reactDebugStream: debugStream ?? undefined,
                    debugEndTime: undefined,
                    preinitScripts: preinitScripts,
                    ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                    nonce: nonce,
                    images: ctx.renderOpts.images
                }), {
                    signal: reactController.signal,
                    onError: (err, errorInfo)=>{
                        if ((0, _dynamicrendering.isPrerenderInterruptedError)(err) || reactController.signal.aborted) {
                            const componentStack = errorInfo.componentStack;
                            if (typeof componentStack === 'string') {
                                (0, _dynamicrendering.trackDynamicHoleInNavigation)(workStore, componentStack, instantValidationState, clientDynamicTracking, payloadResult.hasAmbiguousErrors ? _dynamicrendering.DynamicHoleKind.Runtime : _dynamicrendering.DynamicHoleKind.Dynamic, boundaryState);
                            }
                            return;
                        } else if (!reactController.signal.aborted) {
                            const componentStack = errorInfo.componentStack;
                            if (typeof componentStack === 'string') {
                                let errorForDisplay = err;
                                if (process.env.NODE_ENV === 'production') {
                                    // In production (i.e. build validation), Flight omits everything except the digest
                                    // when serializing errors, which makes them very unfriendly for debugging.
                                    // Map the deserialized errors back to their original error object to make it more useful.
                                    if (err && typeof err === 'object' && 'digest' in err && typeof err.digest === 'string') {
                                        const serverError = workStore.reactServerErrorsByDigest.get(err.digest);
                                        if (serverError !== undefined) {
                                            errorForDisplay = serverError;
                                        }
                                    }
                                }
                                (0, _dynamicrendering.trackThrownErrorInNavigation)(workStore, instantValidationState, errorForDisplay, componentStack);
                            }
                        }
                        if ((0, _reactlargeshellerror.isReactLargeShellError)(err)) {
                            console.error(err);
                            return undefined;
                        }
                        return (0, _createerrorhandler.getDigestForWellKnownError)(err);
                    }
                });
                reactController.signal.addEventListener('abort', ()=>{
                    renderController.abort();
                }, {
                    once: true
                });
                return pendingResult;
            }, ()=>{
                reactController.abort();
            });
            const { preludeIsEmpty } = await (0, _streamops.processPrelude)(unprocessedPrelude);
            errors = (0, _dynamicrendering.getNavigationDisallowedDynamicReasons)(workStore, preludeIsEmpty ? _dynamicrendering.PreludeState.Empty : _dynamicrendering.PreludeState.Full, instantValidationState, validationSampleTracking, boundaryState);
        } catch (thrownValue) {
            errors = (0, _dynamicrendering.getNavigationDisallowedDynamicReasons)(workStore, _dynamicrendering.PreludeState.Errored, instantValidationState, validationSampleTracking, boundaryState);
        }
        // This prerender did not produce any errors
        if (errors.length === 0) {
            return [];
        }
        if (previousBoundaryState === null && payloadResult.hasAmbiguousErrors) {
            // This is the first validation attempt. we prepared a payload where dynamic holes might be runtime data dependencies
            // or dynamic data dependencies. We do a followup validation using a payload with only Runtime segments to discriminate
            const dynamicOnlyErrors = await validateAtDepthImpl(depth, groupDepthForValidation, boundaryState);
            if (dynamicOnlyErrors !== null && dynamicOnlyErrors.length > 0) {
                // The dynamic errors only validation found errors to report so we favor those
                return dynamicOnlyErrors;
            }
        }
        // If we didn't return some other errors at this point the only thing to return is this validation's errors
        return errors;
    }
    // Discover validation depth bounds from the LoaderTree. The array
    // length is the max URL depth; each entry is the max group depth
    // (route group segments) between that URL depth and the next.
    const groupDepthsByUrlDepth = discoverValidationDepths(loaderTree);
    const maxDepth = groupDepthsByUrlDepth.length;
    for(let depth = maxDepth - 1; depth >= 0; depth--){
        const maxGroupDepth = groupDepthsByUrlDepth[depth];
        for(let currentGroupDepth = maxGroupDepth; currentGroupDepth >= 0; currentGroupDepth--){
            debug == null ? void 0 : debug(`Trying depth ${depth}` + (currentGroupDepth > 0 ? ` + groupDepth ${currentGroupDepth}...` : '...'));
            const errors = await validateAtDepth(depth, currentGroupDepth);
            if (errors === null) {
                debug == null ? void 0 : debug(`  No config at depth ${depth}+${currentGroupDepth}, skipping.`);
                continue;
            }
            if (errors.length > 0) {
                debug == null ? void 0 : debug(`  Depth ${depth}+${currentGroupDepth}: ❌ Failed (${errors.length} errors)`);
                return errors;
            }
            debug == null ? void 0 : debug(`  Depth ${depth}+${currentGroupDepth}: ✅ Passed`);
        }
    }
    debug == null ? void 0 : debug(`✅ All depths passed`);
    return [];
}
/**
 * Two-pass render for build-time instant validation.
 * The flow is similar to `renderWithRestartOnCacheMissInDev`: pass 1 warms caches,
 * pass 2 renders with warm caches. If pass 1 has no cache misses,
 * its result is returned directly.
 *
 * Differences from `renderWithRestartOnCacheMissInDev`:
 * - both renders are abortable: if we know that we can't use a stream, we can just
 *   throw it away, we don't have to render a complete result.
 * - We don't need to tee the stream, we only care about accumulating chunks.
 */ async function renderWithRestartOnCacheMissInValidation(ctx, initialRequestStore, createRequestStore, getPayload, createOnError, prefilledDataCache) {
    const { componentMod: ComponentMod } = ctx;
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    let startTime = -Infinity;
    let requestStore = initialRequestStore;
    //===============================================
    // Initial render (prospective — may warm caches)
    //===============================================
    const cacheSignal = new _cachesignal.CacheSignal();
    (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
    // The prerender we rean before the validation probably already filled some caches,
    // so we want to save work and re-use them.
    const prerenderResumeDataCache = prefilledDataCache ? (0, _resumedatacache.createPrerenderResumeDataCache)(prefilledDataCache) : (0, _resumedatacache.createPrerenderResumeDataCache)();
    const initialReactController = new AbortController();
    const initialDataController = new AbortController();
    const initialAbandonController = new AbortController();
    const initialStageController = new _stagedrendering.StagedRenderingController(initialDataController.signal, initialAbandonController, true // track sync IO
    );
    requestStore.prerenderResumeDataCache = prerenderResumeDataCache;
    requestStore.renderResumeDataCache = null;
    requestStore.stagedRendering = initialStageController;
    requestStore.cacheSignal = cacheSignal;
    requestStore.asyncApiPromises = createAsyncApiPromises(initialStageController, requestStore.cookies, requestStore.mutableCookies, requestStore.headers);
    // We don't set `requestStore.controller and requestStore.renderSignal here.
    // Right now, we only abort for sync IO, and in the first render, that's just a restart
    // (after waiting for caches)
    requestStore.controller = undefined;
    requestStore.renderSignal = undefined;
    const initialRscPayload = await getPayload(requestStore);
    const advanceStageIfNoCacheMiss = (stage)=>{
        if (initialAbandonController.signal.aborted === true) {
            return;
        } else if (cacheSignal.hasPendingReads()) {
            initialAbandonController.abort();
        } else {
            initialStageController.advanceStage(stage);
        }
    };
    const initialResult = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
        initialStageController.advanceStage(_stagedrendering.RenderStage.EarlyStatic);
        startTime = performance.now() + performance.timeOrigin;
        const stream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ComponentMod, initialRscPayload, clientModules, {
            onError: createOnError(initialReactController.signal, false),
            startTime,
            filterStackFrame,
            signal: initialReactController.signal
        });
        initialReactController.signal.addEventListener('abort', ()=>{
            const { reason } = initialReactController.signal;
            initialDataController.abort(reason);
        }, {
            once: true
        });
        const accumulatedChunksPromise = accumulateStreamChunks(stream, initialStageController, initialDataController.signal);
        accumulatedChunksPromise.catch(()=>{});
        return {
            accumulatedChunksPromise
        };
    }, ()=>{
        advanceStageIfNoCacheMiss(_stagedrendering.RenderStage.Static);
    }, ()=>{
        advanceStageIfNoCacheMiss(_stagedrendering.RenderStage.EarlyRuntime);
    }, ()=>{
        advanceStageIfNoCacheMiss(_stagedrendering.RenderStage.Runtime);
    }, ()=>{
        advanceStageIfNoCacheMiss(_stagedrendering.RenderStage.Dynamic);
    });
    if (initialStageController.currentStage !== _stagedrendering.RenderStage.Abandoned) {
        // No cache misses. Use the result as-is.
        return {
            accumulatedChunksPromise: initialResult.accumulatedChunksPromise,
            startTime,
            stageController: initialStageController,
            requestStore
        };
    }
    // Cache miss. Wait for caches to fill, then re-render with warm caches.
    await cacheSignal.cacheReady();
    initialReactController.abort();
    //===============================================
    // Final render (restarted, with warm caches)
    //===============================================
    requestStore = createRequestStore();
    // Unlike dev, where we're re-using the render that'll be visible in the browser,
    // we *can* abort the validation render.
    const finalReactController = new AbortController();
    const finalDataController = new AbortController();
    const finalStageController = new _stagedrendering.StagedRenderingController(finalDataController.signal, null, true // track sync IO
    );
    requestStore.prerenderResumeDataCache = null;
    requestStore.renderResumeDataCache = (0, _resumedatacache.createRenderResumeDataCache)(prerenderResumeDataCache);
    requestStore.stagedRendering = finalStageController;
    requestStore.cacheSignal = null;
    requestStore.asyncApiPromises = createAsyncApiPromises(finalStageController, requestStore.cookies, requestStore.mutableCookies, requestStore.headers);
    // Right now, we only abort for sync IO.
    // If sync IO occurs in a place where it's not allowed, then we have to fail validation,
    // and we can abort the render immediately, without waiting for anything else..
    requestStore.controller = finalReactController;
    requestStore.renderSignal = finalDataController.signal;
    const finalRscPayload = await getPayload(requestStore);
    const finalResult = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
        finalStageController.advanceStage(_stagedrendering.RenderStage.EarlyStatic);
        startTime = performance.now() + performance.timeOrigin;
        const stream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, _streamops.renderToFlightStream, ComponentMod, finalRscPayload, clientModules, {
            onError: createOnError(finalReactController.signal, true),
            startTime,
            filterStackFrame,
            signal: finalReactController.signal
        });
        finalReactController.signal.addEventListener('abort', ()=>{
            finalDataController.abort(finalReactController.signal.reason);
        }, {
            once: true
        });
        const accumulatedChunksPromise = accumulateStreamChunks(stream, finalStageController, null);
        accumulatedChunksPromise.catch(()=>{});
        return {
            accumulatedChunksPromise
        };
    }, ()=>{
        finalStageController.advanceStage(_stagedrendering.RenderStage.Static);
    }, ()=>{
        finalStageController.advanceStage(_stagedrendering.RenderStage.EarlyRuntime);
    }, ()=>{
        finalStageController.advanceStage(_stagedrendering.RenderStage.Runtime);
    }, ()=>{
        finalStageController.advanceStage(_stagedrendering.RenderStage.Dynamic);
    });
    return {
        accumulatedChunksPromise: finalResult.accumulatedChunksPromise,
        startTime,
        stageController: finalStageController,
        requestStore
    };
}
async function validateInstantConfigsInBuild(ctx, prefilledDataCache) {
    const run = async ()=>{
        let success;
        try {
            // The validation renders are separate renders, and use a separate WorkStore.
            // However, we defensively exit the existing workStore to avoid relying on something from there
            // before we shadow it.
            success = await _workasyncstorageexternal.workAsyncStorage.exit(async ()=>validateInstantConfigsInBuildImpl(ctx, prefilledDataCache));
        } catch (err) {
            console.error(Object.defineProperty(new _invarianterror.InvariantError('An unexpected error occcured during instant validation', {
                cause: err
            }), "__NEXT_ERROR_CODE", {
                value: "E1097",
                enumerable: false,
                configurable: true
            }));
            success = false;
        }
        if (!success) {
            console.error('Stopping prerender due to instant validation errors.');
            throw new _staticgenerationbailout.StaticGenBailoutError();
        }
    };
    if (process.env.__NEXT_TEST_MODE && process.env.NEXT_TEST_LOG_VALIDATION) {
        // In tests, we use these markers to extract the relevant portion of the CLI logs.
        // We want consistent ordering of these messages and other console.error calls,
        // so we use console.error here as well. Using console.log leads to non-deterministic
        // log order, likely stdout/stderr can interleave in non-deterministic ways.
        const requestId = Date.now();
        const route = ctx.workStore.route;
        console.error('<VALIDATION_MESSAGE>' + JSON.stringify({
            type: 'validation_start',
            requestId,
            url: route
        }) + '</VALIDATION_MESSAGE>');
        try {
            return await run();
        } finally{
            console.error('<VALIDATION_MESSAGE>' + JSON.stringify({
                type: 'validation_end',
                requestId,
                url: route
            }) + '</VALIDATION_MESSAGE>');
        }
    } else {
        return await run();
    }
}
/**
 * Runs instant validation at build time using the `samples` from `unstable_instant`.
 *
 * For each sample, this creates a staged RSC render with a synthetic `RequestStore`
 * populated from sample data, then feeds the accumulated chunks to
 * `validateInstantConfigs` which handles the actual validation.
 */ async function validateInstantConfigsInBuildImpl(ctx, prefilledDataCache) {
    const debug = process.env.NEXT_PRIVATE_DEBUG_VALIDATION === '1' ? console.log : undefined;
    const { workStore: outerWorkStore } = ctx;
    const route = outerWorkStore.route;
    const loaderTree = ctx.componentMod.routeModule.userland.loaderTree;
    let samples = await (0, _instantconfig.resolveInstantConfigSamplesForPage)(loaderTree);
    if (!samples || samples.length === 0) {
        // No samples defined; use a single empty sample to still run validation
        samples = [
            {}
        ];
    }
    debug == null ? void 0 : debug('Resolved samples:', samples);
    const allPossibleFallbackRouteParams = (0, _fallbackparams.getFallbackRouteParams)(route, ctx.componentMod.routeModule);
    for(let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++){
        const sample = samples[sampleIndex];
        debug == null ? void 0 : debug(`Validating sample (${sampleIndex + 1}/${samples.length}):`, sample);
        let errors;
        try {
            errors = await _consoleasyncstorageexternal.consoleAsyncStorage.run({
                dim: true
            }, ()=>validateInstantConfigInBuildWithSample(ctx, sample, allPossibleFallbackRouteParams, prefilledDataCache));
        } catch (err) {
            if ((0, _instantvalidationerror.isInstantValidationError)(err)) {
                errors = [
                    err
                ];
            } else {
                throw err;
            }
        }
        if (errors.length > 0) {
            debug == null ? void 0 : debug(`❌ Sample failed validation (${errors.length} errors)`);
            const sampleDesc = samples.length > 1 ? ` (sample ${sampleIndex + 1} of ${samples.length})` : '';
            for (const err of errors){
                console.error(err);
            }
            console.error(`Build-time instant validation failed for route "${route}"${sampleDesc}.`);
            return false;
        } else {
            debug == null ? void 0 : debug('✅ Sample validated successfully');
        }
    }
    return true;
}
async function validateInstantConfigInBuildWithSample(outerCtx, sample, allPossibleFallbackRouteParams, prefilledDataCache) {
    // The flow for build mirrors what we do when validating in dev.
    // We have to perform a full dynamic render to get the RSC chunks for each stage.
    // In order to do that, we have to set up a mock AppRenderContext, workStore, and requestStore
    // based on the `sample` we're using.
    const { workStore: outerWorkStore } = outerCtx;
    const loaderTree = outerCtx.componentMod.routeModule.userland.loaderTree;
    const route = outerWorkStore.route;
    const { createCookiesFromSample, createHeadersFromSample, createDraftModeForValidation, createRelativeURLFromSamples, createValidationSampleTracking } = require('./instant-validation/instant-samples');
    // TODO(instant-validation-build): it feels like this should happen higher up
    // and go through existing URL parsing/generation logic?
    const sampleUrl = createRelativeURLFromSamples(route, sample.params, sample.searchParams);
    const sampleParams = sample.params ?? {};
    let fallbackRouteParams = null;
    if (allPossibleFallbackRouteParams) {
        const fallbackRouteParamsMut = new Map();
        for (const [paramKey, value] of allPossibleFallbackRouteParams){
            if (!(paramKey in sampleParams)) {
                fallbackRouteParamsMut.set(paramKey, value);
            }
        }
        fallbackRouteParams = fallbackRouteParamsMut;
    }
    const getDynamicParamFromSegment = makeGetDynamicParamFromSegment(sampleParams, fallbackRouteParams, false);
    const sampleRootParams = (0, _createcomponenttree.getRootParams)(loaderTree, getDynamicParamFromSegment);
    let sampleUrlWithoutQuery;
    let sampleQuery;
    ({ query: sampleQuery, ...sampleUrlWithoutQuery } = sampleUrl);
    const { AfterContext } = require('../after/after-context');
    // NOTE: Matching the field order in `createWorkStore` to avoid deopting.
    const workStore = {
        isStaticGeneration: false,
        page: outerWorkStore.page,
        route: outerWorkStore.route,
        incrementalCache: outerWorkStore.incrementalCache,
        cacheLifeProfiles: outerWorkStore.cacheLifeProfiles,
        isBuildTimePrerendering: false,
        fetchCache: outerWorkStore.fetchCache,
        isOnDemandRevalidate: false,
        isDraftMode: false,
        isPrefetchRequest: false,
        buildId: outerWorkStore.buildId,
        reactLoadableManifest: outerWorkStore.reactLoadableManifest,
        assetPrefix: outerWorkStore.assetPrefix,
        nonce: outerWorkStore.nonce,
        // Never run `after()` for this validation render. by definition, `after` can't affect the rendered output.
        afterContext: new AfterContext({
            waitUntil (promise) {
                promise.catch(()=>{});
            },
            onClose () {},
            onTaskError () {}
        }),
        cacheComponentsEnabled: outerWorkStore.cacheComponentsEnabled,
        previouslyRevalidatedTags: [],
        refreshTagsByCacheKind: new Map(),
        runInCleanSnapshot: outerWorkStore.runInCleanSnapshot,
        shouldTrackFetchMetrics: false,
        reactServerErrorsByDigest: new Map()
    };
    return _workasyncstorageexternal.workAsyncStorage.run(workStore, async ()=>{
        // NOTE: match field order in renderToHTMLOrFlightImpl to avoid deopts
        const validationCtx = {
            componentMod: outerCtx.componentMod,
            url: sampleUrlWithoutQuery,
            renderOpts: outerCtx.renderOpts,
            workStore,
            parsedRequestHeaders: outerCtx.parsedRequestHeaders,
            getDynamicParamFromSegment,
            interpolatedParams: sampleParams,
            query: sampleQuery,
            isPrefetch: false,
            isPossibleServerAction: false,
            requestTimestamp: outerCtx.requestTimestamp,
            appUsingSizeAdjustment: outerCtx.appUsingSizeAdjustment,
            flightRouterState: undefined,
            requestId: outerCtx.requestId,
            htmlRequestId: outerCtx.htmlRequestId,
            pagePath: outerCtx.pagePath,
            assetPrefix: outerCtx.assetPrefix,
            isNotFoundPath: outerCtx.isNotFoundPath,
            nonce: outerCtx.nonce,
            res: outerCtx.res,
            sharedContext: outerCtx.sharedContext,
            implicitTags: outerCtx.implicitTags
        };
        const validationSamples = {
            params: sample.params,
            searchParams: sample.searchParams
        };
        const createRequestStore = ()=>{
            // Create exhaustive request data from sample
            const sampleCookies = createCookiesFromSample(sample.cookies, route);
            // We don't have to bother initializing these, pages can't access them anyway,
            // we just need them because RequestStore requires them.
            const unusedMutableCookies = new _cookies.ResponseCookies(new Headers());
            // Create headers.
            const sampleHeaders = createHeadersFromSample(sample.headers, sample.cookies, route);
            const draftMode = createDraftModeForValidation();
            return {
                type: 'request',
                phase: 'render',
                implicitTags: outerCtx.implicitTags,
                url: {
                    pathname: sampleUrl.pathname,
                    search: sampleUrl.search
                },
                headers: sampleHeaders,
                cookies: sampleCookies,
                mutableCookies: unusedMutableCookies,
                userspaceMutableCookies: unusedMutableCookies,
                draftMode,
                rootParams: sampleRootParams,
                validationSamples,
                validationSampleTracking: createValidationSampleTracking(),
                // These will be set when rendering
                renderResumeDataCache: null,
                prerenderResumeDataCache: null,
                stagedRendering: null,
                asyncApiPromises: undefined
            };
        };
        // Track server errors. If one of them surfaces during the client render
        // in the deserialized form (with no message/stack) we'll use this to map it
        // back to the original.
        const onServerError = (0, _createerrorhandler.createReactServerErrorHandler)(true, true, workStore.reactServerErrorsByDigest, ()=>{} // Don't report anything here. If needed, it will be reported in the client render.
        );
        const { accumulatedChunksPromise, startTime, stageController, requestStore: finalServerStore } = await renderWithRestartOnCacheMissInValidation(validationCtx, createRequestStore(), createRequestStore, (requestStore)=>_workunitasyncstorageexternal.workUnitAsyncStorage.run(requestStore, getRSCPayload, loaderTree, validationCtx, {
                is404: false
            }), (signal)=>function onError(err) {
                const digest = (0, _createerrorhandler.getDigestForWellKnownError)(err);
                if (digest) {
                    return digest;
                }
                if (signal.aborted) {
                    return;
                }
                return onServerError(err);
            }, prefilledDataCache);
        const accumulatedChunks = await accumulatedChunksPromise;
        const debugChunks = null // TODO(instant-validation-build): support debugChannel
        ;
        // Missing sample errors take priority over everything else,
        // because they prevent us from rendering everything we need to validate.
        const serverValidationSampleTracking = finalServerStore.validationSampleTracking;
        if (serverValidationSampleTracking.missingSampleErrors.length > 0) {
            return serverValidationSampleTracking.missingSampleErrors;
        }
        // We also error for sync IO. This runs after the prerender,
        // so if we get sync IO errors here, they're likely from the runtime stage --
        // the prerender probably discovered sync IO in the static stage
        if (stageController.currentStage === _stagedrendering.RenderStage.Abandoned && stageController.syncInterruptReason) {
            return [
                stageController.syncInterruptReason
            ];
        }
        const allowEmptyStaticShell = (validationCtx.renderOpts.allowEmptyStaticShell ?? false) || await (0, _instantconfig.isPageAllowedToBlock)(loaderTree);
        // Now we the chunks of a fully rendered page, just like in dev.
        // We can use them to validate all the navigations required by `instant` configs.
        // Note that we're not performing static shell validation here -- that happens
        // implicitly as part of the static prerender.
        // The static prerender has warmed some client modules already,
        // but we'll be reaching Runtime/Dynamic stages and thus rendering more content,
        // so we need to warm again.
        // TODO(instant-validation-build): This might warm too much, possibly hitting errors on code that didn't expect
        // to run at build time. For example, we generally don't need to render leaf segments (e.g. __PAGE__) in
        // the Dynamic stage, they're Runtime at best.
        const warmupValidationSamplesTracking = createValidationSampleTracking();
        await warmupClientModulesForStagedValidation('validation-client', accumulatedChunks.dynamicChunks, accumulatedChunks.dynamicChunks, sampleRootParams, fallbackRouteParams, allowEmptyStaticShell, validationCtx, validationSamples, warmupValidationSamplesTracking);
        if (warmupValidationSamplesTracking.missingSampleErrors.length > 0) {
            return warmupValidationSamplesTracking.missingSampleErrors;
        }
        return await validateInstantConfigs(accumulatedChunks, debugChunks, startTime, sampleRootParams, fallbackRouteParams, validationCtx, undefined, validationSamples);
    });
}
/**
 * Determines whether we should generate static flight data.
 */ function shouldGenerateStaticFlightData(workStore) {
    const { isStaticGeneration } = workStore;
    if (!isStaticGeneration) return false;
    return true;
}
async function prerenderToStream(req, res, ctx, metadata, tree, fallbackRouteParams) {
    // When prerendering formState is always null. We still include it
    // because some shared APIs expect a formState value and this is slightly
    // more explicit than making it an optional function argument
    const formState = null;
    const { assetPrefix, getDynamicParamFromSegment, implicitTags, nonce, pagePath, renderOpts, workStore } = ctx;
    const { basePath, buildManifest, ComponentMod, crossOrigin, experimental, isDebugDynamicAccesses, isBuildTimePrerendering = false, onInstrumentationRequestError, page, reactMaxHeadersLength, subresourceIntegrityManifest, cacheComponents } = renderOpts;
    const { cachedNavigations } = renderOpts.experimental;
    const allowEmptyStaticShell = (renderOpts.allowEmptyStaticShell ?? false) || await (0, _instantconfig.isPageAllowedToBlock)(tree);
    const rootParams = (0, _createcomponenttree.getRootParams)(tree, getDynamicParamFromSegment);
    const { ServerInsertedHTMLProvider, renderServerInsertedHTML } = (0, _serverinsertedhtml.createServerInsertedHTML)();
    const getServerInsertedMetadata = (0, _createserverinsertedmetadata.createServerInsertedMetadata)(nonce);
    const tracingMetadata = (0, _utils1.getTracedMetadata)((0, _tracer.getTracer)().getTracePropagationData(), experimental.clientTraceMetadata);
    const polyfills = buildManifest.polyfillFiles.filter((polyfill)=>polyfill.endsWith('.js') && !polyfill.endsWith('.module.js')).map((polyfill)=>({
            src: `${assetPrefix}/_next/${polyfill}${(0, _getassetquerystring.getAssetQueryString)(ctx, false)}`,
            integrity: subresourceIntegrityManifest == null ? void 0 : subresourceIntegrityManifest[polyfill],
            crossOrigin,
            noModule: true,
            nonce
        }));
    const [preinitScripts, bootstrapScript] = (0, _requiredscripts.getRequiredScripts)(buildManifest, // Why is assetPrefix optional on renderOpts?
    // @TODO make it default empty string on renderOpts and get rid of it from ctx
    assetPrefix, crossOrigin, subresourceIntegrityManifest, (0, _getassetquerystring.getAssetQueryString)(ctx, true), nonce, page);
    const { reactServerErrorsByDigest } = workStore;
    // We don't report errors during prerendering through our instrumentation hooks
    const reportErrors = !experimental.isRoutePPREnabled;
    function onHTMLRenderRSCError(err, silenceLog) {
        if (reportErrors) {
            return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'react-server-components'), silenceLog);
        }
    }
    const serverComponentsErrorHandler = (0, _createerrorhandler.createReactServerErrorHandler)(process.env.NODE_ENV === 'development', isBuildTimePrerendering, reactServerErrorsByDigest, onHTMLRenderRSCError);
    function onHTMLRenderSSRError(err) {
        if (reportErrors) {
            // We don't need to silence logs here. onHTMLRenderSSRError won't be
            // called at all if the error was logged before in the RSC error handler.
            const silenceLog = false;
            return onInstrumentationRequestError == null ? void 0 : onInstrumentationRequestError(err, req, createErrorContext(ctx, 'server-rendering'), silenceLog);
        }
    }
    const allCapturedErrors = [];
    const htmlRendererErrorHandler = (0, _createerrorhandler.createHTMLErrorHandler)(process.env.NODE_ENV === 'development', isBuildTimePrerendering, reactServerErrorsByDigest, allCapturedErrors, onHTMLRenderSSRError);
    let reactServerPrerenderResult = null;
    const setMetadataHeader = (name)=>{
        metadata.headers ??= {};
        metadata.headers[name] = res.getHeader(name);
    };
    const setHeader = (name, value)=>{
        res.setHeader(name, value);
        setMetadataHeader(name);
        return res;
    };
    const appendHeader = (name, value)=>{
        if (Array.isArray(value)) {
            value.forEach((item)=>{
                res.appendHeader(name, item);
            });
        } else {
            res.appendHeader(name, value);
        }
        setMetadataHeader(name);
    };
    const selectStaleTime = (0, _staletime.createSelectStaleTime)(experimental);
    const { clientModules } = (0, _manifestssingleton.getClientReferenceManifest)();
    let prerenderStore = null;
    try {
        if (cacheComponents) {
            /**
       * cacheComponents with PPR
       *
       * The general approach is to render the RSC stream first allowing any cache reads to resolve.
       * Once we have settled all cache reads we restart the render and abort after a single Task.
       *
       * Unlike with the non PPR case we can't synchronously abort the render when a dynamic API is used
       * during the initial render because we need to ensure all caches can be filled as part of the initial Task
       * and a synchronous abort might prevent us from filling all caches.
       *
       * Once the render is complete we allow the SSR render to finish and use a combination of the postponed state
       * and the reactServerIsDynamic value to determine how to treat the resulting render
       */ // The prerender controller represents the lifetime of the prerender. It
            // will be aborted when a task is complete or a synchronously aborting API
            // is called. Notably, during prospective prerenders, this does not
            // actually terminate the prerender itself, which will continue until all
            // caches are filled.
            const initialServerPrerenderController = new AbortController();
            // This controller is used to abort the React prerender.
            const initialServerReactController = new AbortController();
            // This controller represents the lifetime of the React prerender. Its
            // signal can be used for any I/O operation to abort the I/O and/or to
            // reject, when prerendering aborts. This includes our own hanging
            // promises for accessing request data, and for fetch calls. It might be
            // replaced in the future by React.cacheSignal(). It's aborted after the
            // React controller, so that no pending I/O can register abort listeners
            // that are called before React's abort listener is called. This ensures
            // that pending I/O is not rejected too early when aborting the prerender.
            // Notably, during the prospective prerender, it is different from the
            // prerender controller because we don't want to end the React prerender
            // until all caches are filled.
            const initialServerRenderController = new AbortController();
            // The cacheSignal helps us track whether caches are still filling or we are ready
            // to cut the render off.
            const cacheSignal = new _cachesignal.CacheSignal();
            // Always start with a fresh prerender RDC so warmup can fill misses,
            // even when we have a prefilled render RDC to seed from.
            const prerenderResumeDataCache = (0, _resumedatacache.createPrerenderResumeDataCache)();
            let renderResumeDataCache = renderOpts.renderResumeDataCache ?? null;
            const initialServerPayloadPrerenderStore = {
                type: 'prerender',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                // While this render signal isn't going to be used to abort a React render while getting the RSC payload
                // various request data APIs bind to this controller to reject after completion.
                renderSignal: initialServerRenderController.signal,
                // When we generate the RSC payload we might abort this controller due to sync IO
                // but we don't actually care about sync IO in this phase so we use a throw away controller
                // that isn't connected to anything
                controller: new AbortController(),
                // During the initial prerender we need to track all cache reads to ensure
                // we render long enough to fill every cache it is possible to visit during
                // the final prerender.
                cacheSignal,
                dynamicTracking: null,
                allowEmptyStaticShell,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache,
                renderResumeDataCache,
                hmrRefreshHash: undefined,
                // We don't track vary params during initial prerender, only the final one
                varyParamsAccumulator: null
            };
            // We're not going to use the result of this render because the only time it could be used
            // is if it completes in a microtask and that's likely very rare for any non-trivial app
            const initialServerPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(initialServerPayloadPrerenderStore, getRSCPayload, tree, ctx, {
                is404: res.statusCode === 404
            });
            const initialServerPrerenderStore = prerenderStore = {
                type: 'prerender',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                renderSignal: initialServerRenderController.signal,
                controller: initialServerPrerenderController,
                // During the initial prerender we need to track all cache reads to ensure
                // we render long enough to fill every cache it is possible to visit during
                // the final prerender.
                cacheSignal,
                dynamicTracking: null,
                allowEmptyStaticShell,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache,
                renderResumeDataCache,
                hmrRefreshHash: undefined,
                // We don't track vary params during initial prerender, only the final one
                varyParamsAccumulator: null
            };
            const initialPrerenderOptions = {
                filterStackFrame,
                onError: (err)=>{
                    const digest = (0, _createerrorhandler.getDigestForWellKnownError)(err);
                    if (digest) {
                        return digest;
                    }
                    if ((0, _reactlargeshellerror.isReactLargeShellError)(err)) {
                        // TODO: Aggregate
                        console.error(err);
                        return undefined;
                    }
                    if (initialServerPrerenderController.signal.aborted) {
                        // The render aborted before this error was handled which indicates
                        // the error is caused by unfinished components within the render
                        return;
                    } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
                        (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
                    }
                },
                // We don't want to stop rendering until the cacheSignal is complete so we pass
                // a different signal to this render call than is used by dynamic APIs to signify
                // transitioning out of the prerender environment
                signal: initialServerReactController.signal
            };
            const pendingInitialServerResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(initialServerPrerenderStore, (0, _streamops.getServerPrerender)(ComponentMod), initialServerPayload, clientModules, initialPrerenderOptions);
            // The listener to abort our own render controller must be added after
            // React has added its listener, to ensure that pending I/O is not
            // aborted/rejected too early.
            initialServerReactController.signal.addEventListener('abort', ()=>{
                initialServerRenderController.abort();
                initialServerPrerenderController.abort();
            }, {
                once: true
            });
            // Wait for all caches to be finished filling and for async imports to resolve
            (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
            await cacheSignal.cacheReady();
            initialServerReactController.abort();
            // We don't need to continue the prerender process if we already
            // detected invalid dynamic usage in the initial prerender phase.
            if (workStore.invalidDynamicUsageError) {
                (0, _dynamicrendering.logDisallowedDynamicError)(workStore, workStore.invalidDynamicUsageError);
                throw new _staticgenerationbailout.StaticGenBailoutError();
            }
            let initialServerResult;
            try {
                initialServerResult = await (0, _apprenderprerenderutils.createReactServerPrerenderResult)(pendingInitialServerResult);
            } catch (err) {
                if (initialServerReactController.signal.aborted || initialServerPrerenderController.signal.aborted) {
                // These are expected errors that might error the prerender. we ignore them.
                } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
                    // We don't normally log these errors because we are going to retry anyway but
                    // it can be useful for debugging Next.js itself to get visibility here when needed
                    (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
                }
            }
            if (initialServerResult) {
                const initialClientPrerenderController = new AbortController();
                const initialClientReactController = new AbortController();
                const initialClientRenderController = new AbortController();
                const initialClientPrerenderStore = {
                    type: 'prerender-client',
                    phase: 'render',
                    rootParams,
                    fallbackRouteParams,
                    implicitTags,
                    renderSignal: initialClientRenderController.signal,
                    controller: initialClientPrerenderController,
                    // For HTML Generation the only cache tracked activity
                    // is module loading, which has it's own cache signal
                    cacheSignal: null,
                    dynamicTracking: null,
                    allowEmptyStaticShell,
                    revalidate: _constants1.INFINITE_CACHE,
                    expire: _constants1.INFINITE_CACHE,
                    stale: _constants1.INFINITE_CACHE,
                    tags: [
                        ...implicitTags.tags
                    ],
                    prerenderResumeDataCache,
                    renderResumeDataCache,
                    hmrRefreshHash: undefined,
                    // Client prerenders don't track server param access
                    varyParamsAccumulator: null
                };
                const pendingInitialClientResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(initialClientPrerenderStore, _streamops.getClientPrerender, // eslint-disable-next-line @next/internal/no-ambiguous-jsx
                /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                    reactServerStream: initialServerResult.asUnclosingStream(),
                    reactDebugStream: undefined,
                    debugEndTime: undefined,
                    preinitScripts: preinitScripts,
                    ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                    nonce: nonce,
                    images: ctx.renderOpts.images
                }), {
                    signal: initialClientReactController.signal,
                    onError: (err)=>{
                        const digest = (0, _createerrorhandler.getDigestForWellKnownError)(err);
                        if (digest) {
                            return digest;
                        }
                        if ((0, _reactlargeshellerror.isReactLargeShellError)(err)) {
                            // TODO: Aggregate
                            console.error(err);
                            return undefined;
                        }
                        if (initialClientReactController.signal.aborted) {
                        // These are expected errors that might error the prerender. we ignore them.
                        } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
                            // We don't normally log these errors because we are going to retry anyway but
                            // it can be useful for debugging Next.js itself to get visibility here when needed
                            (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
                        }
                    },
                    bootstrapScripts: [
                        bootstrapScript
                    ]
                });
                // The listener to abort our own render controller must be added after
                // React has added its listener, to ensure that pending I/O is not
                // aborted/rejected too early.
                initialClientReactController.signal.addEventListener('abort', ()=>{
                    initialClientRenderController.abort();
                }, {
                    once: true
                });
                pendingInitialClientResult.catch((err)=>{
                    if (initialClientReactController.signal.aborted || (0, _dynamicrendering.isPrerenderInterruptedError)(err)) {
                    // These are expected errors that might error the prerender. we ignore them.
                    } else if (process.env.NEXT_DEBUG_BUILD || process.env.__NEXT_VERBOSE_LOGGING) {
                        // We don't normally log these errors because we are going to retry anyway but
                        // it can be useful for debugging Next.js itself to get visibility here when needed
                        (0, _prospectiverenderutils.printDebugThrownValueForProspectiveRender)(err, workStore.route, _prospectiverenderutils.Phase.ProspectiveRender);
                    }
                });
                // This is mostly needed for dynamic `import()`s in client components.
                // Promises passed to client were already awaited above (assuming that they came from cached functions)
                (0, _trackmoduleloadingexternal.trackPendingModules)(cacheSignal);
                await cacheSignal.cacheReady();
                initialClientReactController.abort();
            }
            if (renderOpts.renderResumeDataCache) {
                // Swap to the warmed cache so the final render uses entries produced during warmup.
                renderResumeDataCache = (0, _resumedatacache.createRenderResumeDataCache)(prerenderResumeDataCache);
            }
            const finalServerReactController = new AbortController();
            const finalServerRenderController = new AbortController();
            const varyParamsAccumulator = (0, _varyparams.createResponseVaryParamsAccumulator)();
            const finalServerPayloadPrerenderStore = {
                type: 'prerender',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                // While this render signal isn't going to be used to abort a React render while getting the RSC payload
                // various request data APIs bind to this controller to reject after completion.
                renderSignal: finalServerRenderController.signal,
                // When we generate the RSC payload we might abort this controller due to sync IO
                // but we don't actually care about sync IO in this phase so we use a throw away controller
                // that isn't connected to anything
                controller: new AbortController(),
                // All caches we could read must already be filled so no tracking is necessary
                cacheSignal: null,
                dynamicTracking: null,
                allowEmptyStaticShell,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache,
                renderResumeDataCache,
                hmrRefreshHash: undefined,
                varyParamsAccumulator
            };
            const finalAttemptRSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(finalServerPayloadPrerenderStore, getRSCPayload, tree, ctx, {
                is404: res.statusCode === 404
            });
            let staleTimeIterable;
            if (cachedNavigations) {
                staleTimeIterable = new _staletime.StaleTimeIterable();
                finalAttemptRSCPayload.s = staleTimeIterable;
            }
            const serverDynamicTracking = (0, _dynamicrendering.createDynamicTrackingState)(isDebugDynamicAccesses);
            let serverIsDynamic = false;
            const finalServerPrerenderStore = prerenderStore = {
                type: 'prerender',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                renderSignal: finalServerRenderController.signal,
                controller: finalServerReactController,
                // All caches we could read must already be filled so no tracking is necessary
                cacheSignal: null,
                dynamicTracking: serverDynamicTracking,
                allowEmptyStaticShell,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache,
                renderResumeDataCache,
                hmrRefreshHash: undefined,
                varyParamsAccumulator
            };
            if (staleTimeIterable !== undefined) {
                (0, _staletime.trackStaleTime)(finalServerPrerenderStore, staleTimeIterable, selectStaleTime);
            }
            let prerenderIsPending = true;
            const finalRSCPrerenderOptions = {
                filterStackFrame,
                onError: (err)=>{
                    return serverComponentsErrorHandler(err);
                },
                signal: finalServerReactController.signal
            };
            const finalRSCAbortCallback = async ()=>{
                // Now that the prerendering is complete, we know the final stale
                // time and vary params. Close the stale time iterable and resolve
                // the vary params thenable so Flight can serialize their values
                // into the stream. The timing here is important: both were
                // included in the Flight payload, but they can only be serialized
                // at the very end, after all the components have finished.
                //
                // We resolve these directly here instead of reading from the work
                // unit store because this callback runs in a separate task (via
                // setTimeout) and may not have access to the async storage context.
                const pendingFinishes = [
                    (0, _varyparams.finishAccumulatingVaryParams)(varyParamsAccumulator)
                ];
                if (staleTimeIterable !== undefined) {
                    pendingFinishes.push((0, _staletime.finishStaleTimeTracking)(staleTimeIterable));
                }
                await Promise.all(pendingFinishes);
                if (finalServerReactController.signal.aborted) {
                    // If the server controller is already aborted we must have called something
                    // that required aborting the prerender synchronously such as with new Date()
                    serverIsDynamic = true;
                    return;
                }
                if (prerenderIsPending) {
                    // If prerenderIsPending then we have blocked for longer than a Task and we assume
                    // there is something unfinished.
                    serverIsDynamic = true;
                }
                finalServerReactController.abort();
            };
            const finalRSCPrerenderFn = async ()=>{
                const pendingPrerenderResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(// The store to scope
                finalServerPrerenderStore, // The function to run
                (0, _streamops.getServerPrerender)(ComponentMod), // ... the arguments for the function to run
                finalAttemptRSCPayload, clientModules, finalRSCPrerenderOptions);
                // The listener to abort our own render controller must be added
                // after React has added its listener, to ensure that pending I/O
                // is not aborted/rejected too early.
                finalServerReactController.signal.addEventListener('abort', ()=>{
                    finalServerRenderController.abort();
                }, {
                    once: true
                });
                const prerenderResult = await pendingPrerenderResult;
                prerenderIsPending = false;
                return prerenderResult;
            };
            const reactServerResult = reactServerPrerenderResult = await (0, _apprenderprerenderutils.createReactServerPrerenderResult)((0, _apprenderrenderutils.runInSequentialTasks)(finalRSCPrerenderFn, finalRSCAbortCallback));
            const clientDynamicTracking = (0, _dynamicrendering.createDynamicTrackingState)(isDebugDynamicAccesses);
            const finalClientReactController = new AbortController();
            const finalClientRenderController = new AbortController();
            const finalClientPrerenderStore = {
                type: 'prerender-client',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                renderSignal: finalClientRenderController.signal,
                controller: finalClientReactController,
                // No APIs require a cacheSignal through the workUnitStore during the HTML prerender
                cacheSignal: null,
                dynamicTracking: clientDynamicTracking,
                allowEmptyStaticShell,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache,
                renderResumeDataCache,
                hmrRefreshHash: undefined,
                // Client prerenders don't track server param access
                varyParamsAccumulator: null
            };
            let dynamicValidation = (0, _dynamicrendering.createDynamicValidationState)();
            const finalClientOnHeaders = (0, _streamops.createOnHeadersCallback)(appendHeader);
            let { prelude: unprocessedPrelude, postponed } = await (0, _apprenderrenderutils.runInSequentialTasks)(()=>{
                const pendingFinalClientResult = _workunitasyncstorageexternal.workUnitAsyncStorage.run(finalClientPrerenderStore, _streamops.getClientPrerender, // eslint-disable-next-line @next/internal/no-ambiguous-jsx
                /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                    reactServerStream: reactServerResult.asUnclosingStream(),
                    reactDebugStream: undefined,
                    debugEndTime: undefined,
                    preinitScripts: preinitScripts,
                    ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                    nonce: nonce,
                    images: ctx.renderOpts.images
                }), {
                    signal: finalClientReactController.signal,
                    onError: (err, errorInfo)=>{
                        if ((0, _dynamicrendering.isPrerenderInterruptedError)(err) || finalClientReactController.signal.aborted) {
                            const componentStack = errorInfo.componentStack;
                            if (typeof componentStack === 'string') {
                                (0, _dynamicrendering.trackAllowedDynamicAccess)(workStore, componentStack, dynamicValidation, clientDynamicTracking);
                            }
                            return;
                        }
                        return htmlRendererErrorHandler(err, errorInfo);
                    },
                    onHeaders: finalClientOnHeaders,
                    maxHeadersLength: reactMaxHeadersLength,
                    bootstrapScripts: [
                        bootstrapScript
                    ]
                });
                // The listener to abort our own render controller must be added
                // after React has added its listener, to ensure that pending I/O is
                // not aborted/rejected too early.
                finalClientReactController.signal.addEventListener('abort', ()=>{
                    finalClientRenderController.abort();
                }, {
                    once: true
                });
                return pendingFinalClientResult;
            }, ()=>{
                finalClientReactController.abort();
            });
            const { prelude, preludeIsEmpty } = await (0, _streamops.processPrelude)(unprocessedPrelude);
            // If we've disabled throwing on empty static shell, then we don't need to
            // track any dynamic access that occurs above the suspense boundary because
            // we'll do so in the route shell.
            if (!allowEmptyStaticShell) {
                (0, _dynamicrendering.throwIfDisallowedDynamic)(workStore, preludeIsEmpty ? _dynamicrendering.PreludeState.Empty : _dynamicrendering.PreludeState.Full, dynamicValidation, serverDynamicTracking);
            }
            const getServerInsertedHTML = (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                polyfills,
                renderServerInsertedHTML,
                serverCapturedErrors: allCapturedErrors,
                basePath,
                tracingMetadata: tracingMetadata
            });
            metadata.flightData = await (0, _streamops.streamToBuffer)(cachedNavigations ? prependIsPartialByte(reactServerResult.asStream(), serverIsDynamic) : reactServerResult.asStream());
            // collectSegmentData needs the raw flight data without the marker byte.
            const flightData = cachedNavigations ? metadata.flightData.subarray(1) : metadata.flightData;
            await collectSegmentData(flightData, finalServerPrerenderStore, ComponentMod, renderOpts, ctx.pagePath, metadata);
            if (serverIsDynamic) {
                // Dynamic case
                // We will always need to perform a "resume" render of some kind when this route is accessed
                // because the RSC data itself is dynamic. We determine if there are any HTML holes or not
                // but generally this is a "partial" prerender in that there will be a per-request compute
                // concatenated to the static shell.
                if (postponed != null) {
                    // Dynamic HTML case
                    metadata.postponed = await (0, _postponedstate.getDynamicHTMLPostponedState)(postponed, preludeIsEmpty ? _postponedstate.DynamicHTMLPreludeState.Empty : _postponedstate.DynamicHTMLPreludeState.Full, fallbackRouteParams, prerenderResumeDataCache, cacheComponents);
                } else {
                    // Dynamic Data case
                    metadata.postponed = await (0, _postponedstate.getDynamicDataPostponedState)(prerenderResumeDataCache, cacheComponents);
                }
                reactServerResult.consume();
                const continueDynamicPrerenderOpts = {
                    getServerInsertedHTML,
                    getServerInsertedMetadata,
                    deploymentId: ctx.sharedContext.deploymentId
                };
                return {
                    digestErrorsMap: reactServerErrorsByDigest,
                    ssrErrors: allCapturedErrors,
                    stream: await (0, _streamops.continueDynamicPrerender)(prelude, continueDynamicPrerenderOpts),
                    dynamicAccess: (0, _dynamicrendering.consumeDynamicAccess)(serverDynamicTracking, clientDynamicTracking),
                    // TODO: Should this include the SSR pass?
                    collectedRevalidate: finalServerPrerenderStore.revalidate,
                    collectedExpire: finalServerPrerenderStore.expire,
                    collectedStale: selectStaleTime(finalServerPrerenderStore.stale),
                    collectedTags: finalServerPrerenderStore.tags,
                    renderResumeDataCache: (0, _resumedatacache.createRenderResumeDataCache)(prerenderResumeDataCache)
                };
            } else {
                // Static case
                // We will not perform resumption per request. The result can be served statically to the requestor
                // and if there was anything dynamic it will only be rendered in the browser.
                if (workStore.forceDynamic) {
                    throw Object.defineProperty(new _staticgenerationbailout.StaticGenBailoutError('Invariant: a Page with `dynamic = "force-dynamic"` did not trigger the dynamic pathway. This is a bug in Next.js'), "__NEXT_ERROR_CODE", {
                        value: "E598",
                        enumerable: false,
                        configurable: true
                    });
                }
                let htmlStream = prelude;
                if (postponed != null) {
                    // We postponed but nothing dynamic was used. We resume the render now and immediately abort it
                    // so we can set all the postponed boundaries to client render mode before we store the HTML response
                    const foreverStream = (0, _streamops.createPendingStream)();
                    const resumePrelude = await (0, _streamops.resumeAndAbort)(// eslint-disable-next-line @next/internal/no-ambiguous-jsx
                    /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                        reactServerStream: foreverStream,
                        reactDebugStream: undefined,
                        debugEndTime: undefined,
                        preinitScripts: ()=>{},
                        ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                        nonce: nonce,
                        images: ctx.renderOpts.images
                    }), JSON.parse(JSON.stringify(postponed)), {
                        signal: (0, _dynamicrendering.createRenderInBrowserAbortSignal)(),
                        onError: htmlRendererErrorHandler,
                        nonce
                    });
                    // First we write everything from the prerender, then we write everything from the aborted resume render
                    htmlStream = (0, _streamops.chainStreams)(prelude, resumePrelude);
                }
                let finalStream;
                const hasFallbackRouteParams = fallbackRouteParams && fallbackRouteParams.size > 0;
                if (hasFallbackRouteParams) {
                    // This is a "static fallback" prerender: although the page didn't
                    // access any runtime params in a Server Component, it may have
                    // accessed a runtime param in a client segment.
                    //
                    // TODO: If there were no client segments, we can use the fully static
                    // path instead.
                    //
                    // Rather than use a dynamic server resume to fill in the params,
                    // we can rely on the client to parse the params from the URL and use
                    // that to hydrate the page.
                    //
                    // Send an empty InitialRSCPayload to the server component renderer
                    // The data will be fetched by the client instead.
                    // TODO: In the future, rather than defer the entire hydration payload
                    // to be fetched by the client, we should only defer the client
                    // segments, since those are the only ones whose data is not complete.
                    const emptyReactServerResult = await (0, _apprenderprerenderutils.createReactServerPrerenderResultFromRender)((0, _streamops.renderToFlightStream)(ComponentMod, [], clientModules, {
                        filterStackFrame,
                        onError: serverComponentsErrorHandler
                    }));
                    finalStream = await (0, _streamops.continueStaticFallbackPrerender)(htmlStream, {
                        inlinedDataStream: (0, _streamops.createInlinedDataStream)(emptyReactServerResult.consumeAsStream(), nonce, formState),
                        getServerInsertedHTML,
                        getServerInsertedMetadata,
                        deploymentId: ctx.sharedContext.deploymentId
                    });
                } else {
                    // Normal static prerender case, no fallback param handling needed
                    finalStream = await (0, _streamops.continueStaticPrerender)(htmlStream, {
                        inlinedDataStream: (0, _streamops.createInlinedDataStream)(reactServerResult.consumeAsStream(), nonce, formState),
                        getServerInsertedHTML,
                        getServerInsertedMetadata,
                        deploymentId: ctx.sharedContext.deploymentId
                    });
                }
                return {
                    digestErrorsMap: reactServerErrorsByDigest,
                    ssrErrors: allCapturedErrors,
                    stream: finalStream,
                    dynamicAccess: (0, _dynamicrendering.consumeDynamicAccess)(serverDynamicTracking, clientDynamicTracking),
                    // TODO: Should this include the SSR pass?
                    collectedRevalidate: finalServerPrerenderStore.revalidate,
                    collectedExpire: finalServerPrerenderStore.expire,
                    collectedStale: selectStaleTime(finalServerPrerenderStore.stale),
                    collectedTags: finalServerPrerenderStore.tags,
                    renderResumeDataCache: (0, _resumedatacache.createRenderResumeDataCache)(prerenderResumeDataCache)
                };
            }
        } else if (experimental.isRoutePPREnabled) {
            // We're statically generating with PPR and need to do dynamic tracking
            let dynamicTracking = (0, _dynamicrendering.createDynamicTrackingState)(isDebugDynamicAccesses);
            const prerenderResumeDataCache = (0, _resumedatacache.createPrerenderResumeDataCache)();
            const reactServerPrerenderStore = prerenderStore = {
                type: 'prerender-ppr',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                dynamicTracking,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache
            };
            const RSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(reactServerPrerenderStore, getRSCPayload, tree, ctx, {
                is404: res.statusCode === 404
            });
            let reactServerResult;
            reactServerResult = reactServerPrerenderResult = await (0, _apprenderprerenderutils.createReactServerPrerenderResultFromRender)(_workunitasyncstorageexternal.workUnitAsyncStorage.run(reactServerPrerenderStore, _streamops.renderToFlightStream, ComponentMod, RSCPayload, clientModules, {
                filterStackFrame,
                onError: serverComponentsErrorHandler
            }));
            const ssrPrerenderStore = {
                type: 'prerender-ppr',
                phase: 'render',
                rootParams,
                fallbackRouteParams,
                implicitTags,
                dynamicTracking,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ],
                prerenderResumeDataCache
            };
            const pprOnHeaders = (0, _streamops.createOnHeadersCallback)(appendHeader);
            const { prelude: unprocessedPrelude, postponed } = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(ssrPrerenderStore, _streamops.getClientPrerender, // eslint-disable-next-line @next/internal/no-ambiguous-jsx
            /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                reactServerStream: reactServerResult.asUnclosingStream(),
                reactDebugStream: undefined,
                debugEndTime: undefined,
                preinitScripts: preinitScripts,
                ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                nonce: nonce,
                images: ctx.renderOpts.images
            }), {
                onError: htmlRendererErrorHandler,
                onHeaders: pprOnHeaders,
                maxHeadersLength: reactMaxHeadersLength,
                bootstrapScripts: [
                    bootstrapScript
                ]
            });
            const getServerInsertedHTML = (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                polyfills,
                renderServerInsertedHTML,
                serverCapturedErrors: allCapturedErrors,
                basePath,
                tracingMetadata: tracingMetadata
            });
            // After awaiting here we've waited for the entire RSC render to complete. Crucially this means
            // that when we detect whether we've used dynamic APIs below we know we'll have picked up even
            // parts of the React Server render that might not be used in the SSR render.
            const flightData = await (0, _streamops.streamToBuffer)(reactServerResult.asStream());
            if (shouldGenerateStaticFlightData(workStore)) {
                metadata.flightData = flightData;
                await collectSegmentData(flightData, ssrPrerenderStore, ComponentMod, renderOpts, ctx.pagePath, metadata);
            }
            const { prelude, preludeIsEmpty } = await (0, _streamops.processPrelude)(unprocessedPrelude);
            /**
       * When prerendering there are three outcomes to consider
       *
       *   Dynamic HTML:      The prerender has dynamic holes (caused by using Next.js Dynamic Rendering APIs)
       *                      We will need to resume this result when requests are handled and we don't include
       *                      any server inserted HTML or inlined flight data in the static HTML
       *
       *   Dynamic Data:      The prerender has no dynamic holes but dynamic APIs were used. We will not
       *                      resume this render when requests are handled but we will generate new inlined
       *                      flight data since it is dynamic and differences may end up reconciling on the client
       *
       *   Static:            The prerender has no dynamic holes and no dynamic APIs were used. We statically encode
       *                      all server inserted HTML and flight data
       */ // First we check if we have any dynamic holes in our HTML prerender
            if ((0, _dynamicrendering.accessedDynamicData)(dynamicTracking.dynamicAccesses)) {
                if (postponed != null) {
                    // Dynamic HTML case.
                    metadata.postponed = await (0, _postponedstate.getDynamicHTMLPostponedState)(postponed, preludeIsEmpty ? _postponedstate.DynamicHTMLPreludeState.Empty : _postponedstate.DynamicHTMLPreludeState.Full, fallbackRouteParams, prerenderResumeDataCache, cacheComponents);
                } else {
                    // Dynamic Data case.
                    metadata.postponed = await (0, _postponedstate.getDynamicDataPostponedState)(prerenderResumeDataCache, cacheComponents);
                }
                // Regardless of whether this is the Dynamic HTML or Dynamic Data case we need to ensure we include
                // server inserted html in the static response because the html that is part of the prerender may depend on it
                // It is possible in the set of stream transforms for Dynamic HTML vs Dynamic Data may differ but currently both states
                // require the same set so we unify the code path here
                reactServerResult.consume();
                const pprDynamicOpts = {
                    getServerInsertedHTML,
                    getServerInsertedMetadata,
                    deploymentId: ctx.sharedContext.deploymentId
                };
                return {
                    digestErrorsMap: reactServerErrorsByDigest,
                    ssrErrors: allCapturedErrors,
                    stream: await (0, _streamops.continueDynamicPrerender)(prelude, pprDynamicOpts),
                    dynamicAccess: dynamicTracking.dynamicAccesses,
                    // TODO: Should this include the SSR pass?
                    collectedRevalidate: reactServerPrerenderStore.revalidate,
                    collectedExpire: reactServerPrerenderStore.expire,
                    collectedStale: selectStaleTime(reactServerPrerenderStore.stale),
                    collectedTags: reactServerPrerenderStore.tags
                };
            } else if (fallbackRouteParams && fallbackRouteParams.size > 0) {
                // Rendering the fallback case.
                metadata.postponed = await (0, _postponedstate.getDynamicDataPostponedState)(prerenderResumeDataCache, cacheComponents);
                const pprFallbackDynamicOpts = {
                    getServerInsertedHTML,
                    getServerInsertedMetadata,
                    deploymentId: ctx.sharedContext.deploymentId
                };
                return {
                    digestErrorsMap: reactServerErrorsByDigest,
                    ssrErrors: allCapturedErrors,
                    stream: await (0, _streamops.continueDynamicPrerender)(prelude, pprFallbackDynamicOpts),
                    dynamicAccess: dynamicTracking.dynamicAccesses,
                    // TODO: Should this include the SSR pass?
                    collectedRevalidate: reactServerPrerenderStore.revalidate,
                    collectedExpire: reactServerPrerenderStore.expire,
                    collectedStale: selectStaleTime(reactServerPrerenderStore.stale),
                    collectedTags: reactServerPrerenderStore.tags
                };
            } else {
                // Static case
                // We still have not used any dynamic APIs. At this point we can produce an entirely static prerender response
                if (workStore.forceDynamic) {
                    throw Object.defineProperty(new _staticgenerationbailout.StaticGenBailoutError('Invariant: a Page with `dynamic = "force-dynamic"` did not trigger the dynamic pathway. This is a bug in Next.js'), "__NEXT_ERROR_CODE", {
                        value: "E598",
                        enumerable: false,
                        configurable: true
                    });
                }
                let htmlStream = prelude;
                if (postponed != null) {
                    // We postponed but nothing dynamic was used. We resume the render now and immediately abort it
                    // so we can set all the postponed boundaries to client render mode before we store the HTML response
                    const foreverStream = (0, _streamops.createPendingStream)();
                    const resumePrelude = await (0, _streamops.resumeAndAbort)(// eslint-disable-next-line @next/internal/no-ambiguous-jsx
                    /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                        reactServerStream: foreverStream,
                        reactDebugStream: undefined,
                        debugEndTime: undefined,
                        preinitScripts: ()=>{},
                        ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                        nonce: nonce,
                        images: ctx.renderOpts.images
                    }), JSON.parse(JSON.stringify(postponed)), {
                        signal: (0, _dynamicrendering.createRenderInBrowserAbortSignal)(),
                        onError: htmlRendererErrorHandler,
                        nonce
                    });
                    // First we write everything from the prerender, then we write everything from the aborted resume render
                    htmlStream = (0, _streamops.chainStreams)(prelude, resumePrelude);
                }
                return {
                    digestErrorsMap: reactServerErrorsByDigest,
                    ssrErrors: allCapturedErrors,
                    stream: await (0, _streamops.continueStaticPrerender)(htmlStream, {
                        inlinedDataStream: (0, _streamops.createInlinedDataStream)(reactServerResult.consumeAsStream(), nonce, formState),
                        getServerInsertedHTML,
                        getServerInsertedMetadata,
                        deploymentId: ctx.sharedContext.deploymentId
                    }),
                    dynamicAccess: dynamicTracking.dynamicAccesses,
                    // TODO: Should this include the SSR pass?
                    collectedRevalidate: reactServerPrerenderStore.revalidate,
                    collectedExpire: reactServerPrerenderStore.expire,
                    collectedStale: selectStaleTime(reactServerPrerenderStore.stale),
                    collectedTags: reactServerPrerenderStore.tags
                };
            }
        } else {
            const prerenderLegacyStore = prerenderStore = {
                type: 'prerender-legacy',
                phase: 'render',
                rootParams,
                implicitTags,
                revalidate: _constants1.INFINITE_CACHE,
                expire: _constants1.INFINITE_CACHE,
                stale: _constants1.INFINITE_CACHE,
                tags: [
                    ...implicitTags.tags
                ]
            };
            // This is a regular static generation. We don't do dynamic tracking because we rely on
            // the old-school dynamic error handling to bail out of static generation
            const RSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderLegacyStore, getRSCPayload, tree, ctx, {
                is404: res.statusCode === 404
            });
            let reactServerResult;
            reactServerResult = reactServerPrerenderResult = await (0, _apprenderprerenderutils.createReactServerPrerenderResultFromRender)(_workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderLegacyStore, _streamops.renderToFlightStream, ComponentMod, RSCPayload, clientModules, {
                filterStackFrame,
                onError: serverComponentsErrorHandler
            }));
            const { stream: htmlStream } = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderLegacyStore, _streamops.renderToFizzStream, // eslint-disable-next-line @next/internal/no-ambiguous-jsx
            /*#__PURE__*/ (0, _jsxruntime.jsx)(App, {
                reactServerStream: reactServerResult.asUnclosingStream(),
                reactDebugStream: undefined,
                debugEndTime: undefined,
                preinitScripts: preinitScripts,
                ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                nonce: nonce,
                images: ctx.renderOpts.images
            }), {
                onError: htmlRendererErrorHandler,
                nonce,
                bootstrapScripts: [
                    bootstrapScript
                ]
            });
            if (shouldGenerateStaticFlightData(workStore)) {
                const flightData = await (0, _streamops.streamToBuffer)(reactServerResult.asStream());
                metadata.flightData = flightData;
                await collectSegmentData(flightData, prerenderLegacyStore, ComponentMod, renderOpts, ctx.pagePath, metadata);
            }
            const getServerInsertedHTML = (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                polyfills,
                renderServerInsertedHTML,
                serverCapturedErrors: allCapturedErrors,
                basePath,
                tracingMetadata: tracingMetadata
            });
            return {
                digestErrorsMap: reactServerErrorsByDigest,
                ssrErrors: allCapturedErrors,
                stream: await (0, _streamops.continueFizzStream)(htmlStream, {
                    inlinedDataStream: (0, _streamops.createInlinedDataStream)(reactServerResult.consumeAsStream(), nonce, formState),
                    isStaticGeneration: true,
                    getServerInsertedHTML,
                    getServerInsertedMetadata,
                    deploymentId: ctx.sharedContext.deploymentId
                }),
                // TODO: Should this include the SSR pass?
                collectedRevalidate: prerenderLegacyStore.revalidate,
                collectedExpire: prerenderLegacyStore.expire,
                collectedStale: selectStaleTime(prerenderLegacyStore.stale),
                collectedTags: prerenderLegacyStore.tags
            };
        }
    } catch (err) {
        if ((0, _staticgenerationbailout.isStaticGenBailoutError)(err) || typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string' && err.message.includes('https://nextjs.org/docs/advanced-features/static-html-export')) {
            // Ensure that "next dev" prints the red error overlay
            throw err;
        }
        // If this is a static generation error, we need to throw it so that it
        // can be handled by the caller if we're in static generation mode.
        if ((0, _hooksservercontext.isDynamicServerError)(err)) {
            throw err;
        }
        // If a bailout made it to this point, it means it wasn't wrapped inside
        // a suspense boundary.
        const shouldBailoutToCSR = (0, _bailouttocsr.isBailoutToCSRError)(err);
        if (shouldBailoutToCSR) {
            const stack = (0, _formatservererror.getStackWithoutErrorMessage)(err);
            (0, _log.error)(`${err.reason} should be wrapped in a suspense boundary at page "${pagePath}". Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout\n${stack}`);
            throw err;
        }
        // If we errored when we did not have an RSC stream to read from. This is
        // not just a render error, we need to throw early.
        if (reactServerPrerenderResult === null) {
            throw err;
        }
        let errorType;
        if ((0, _httpaccessfallback.isHTTPAccessFallbackError)(err)) {
            res.statusCode = (0, _httpaccessfallback.getAccessFallbackHTTPStatus)(err);
            metadata.statusCode = res.statusCode;
            errorType = (0, _httpaccessfallback.getAccessFallbackErrorTypeByStatus)(res.statusCode);
        } else if ((0, _redirecterror.isRedirectError)(err)) {
            errorType = 'redirect';
            res.statusCode = (0, _redirect.getRedirectStatusCodeFromError)(err);
            metadata.statusCode = res.statusCode;
            const redirectUrl = (0, _addpathprefix.addPathPrefix)((0, _redirect.getURLFromRedirectError)(err), basePath);
            setHeader('location', redirectUrl);
        } else if (!shouldBailoutToCSR) {
            res.statusCode = 500;
            metadata.statusCode = res.statusCode;
        }
        const [errorPreinitScripts, errorBootstrapScript] = (0, _requiredscripts.getRequiredScripts)(buildManifest, assetPrefix, crossOrigin, subresourceIntegrityManifest, (0, _getassetquerystring.getAssetQueryString)(ctx, false), nonce, '/_not-found/page');
        const prerenderLegacyStore = prerenderStore = {
            type: 'prerender-legacy',
            phase: 'render',
            rootParams,
            implicitTags: implicitTags,
            revalidate: typeof (prerenderStore == null ? void 0 : prerenderStore.revalidate) !== 'undefined' ? prerenderStore.revalidate : _constants1.INFINITE_CACHE,
            expire: typeof (prerenderStore == null ? void 0 : prerenderStore.expire) !== 'undefined' ? prerenderStore.expire : _constants1.INFINITE_CACHE,
            stale: typeof (prerenderStore == null ? void 0 : prerenderStore.stale) !== 'undefined' ? prerenderStore.stale : _constants1.INFINITE_CACHE,
            tags: [
                ...(prerenderStore == null ? void 0 : prerenderStore.tags) || implicitTags.tags
            ]
        };
        const errorRSCPayload = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderLegacyStore, getErrorRSCPayload, tree, ctx, reactServerErrorsByDigest.has(err.digest) ? undefined : err, errorType);
        const errorServerStream = _workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderLegacyStore, _streamops.renderToFlightStream, ComponentMod, errorRSCPayload, clientModules, {
            filterStackFrame,
            onError: serverComponentsErrorHandler
        });
        try {
            const { stream: errorHtmlStream } = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(prerenderLegacyStore, _streamops.renderToFizzStream, // eslint-disable-next-line @next/internal/no-ambiguous-jsx
            /*#__PURE__*/ (0, _jsxruntime.jsx)(ErrorApp, {
                reactServerStream: errorServerStream,
                ServerInsertedHTMLProvider: ServerInsertedHTMLProvider,
                preinitScripts: errorPreinitScripts,
                nonce: nonce,
                images: ctx.renderOpts.images
            }), {
                nonce,
                bootstrapScripts: [
                    errorBootstrapScript
                ],
                formState
            });
            if (shouldGenerateStaticFlightData(workStore)) {
                const flightData = await (0, _streamops.streamToBuffer)(reactServerPrerenderResult.asStream());
                metadata.flightData = flightData;
                await collectSegmentData(flightData, prerenderLegacyStore, ComponentMod, renderOpts, ctx.pagePath, metadata);
            }
            // This is intentionally using the readable datastream from the main
            // render rather than the flight data from the error page render
            const flightStream = reactServerPrerenderResult.consumeAsStream();
            return {
                digestErrorsMap: reactServerErrorsByDigest,
                ssrErrors: allCapturedErrors,
                stream: await (0, _streamops.continueFizzStream)(errorHtmlStream, {
                    inlinedDataStream: (0, _streamops.createInlinedDataStream)(flightStream, nonce, formState),
                    isStaticGeneration: true,
                    getServerInsertedHTML: (0, _makegetserverinsertedhtml.makeGetServerInsertedHTML)({
                        polyfills,
                        renderServerInsertedHTML,
                        serverCapturedErrors: [],
                        basePath,
                        tracingMetadata: tracingMetadata
                    }),
                    getServerInsertedMetadata,
                    validateRootLayout: !!process.env.__NEXT_DEV_SERVER,
                    deploymentId: ctx.sharedContext.deploymentId
                }),
                dynamicAccess: null,
                collectedRevalidate: prerenderStore !== null ? prerenderStore.revalidate : _constants1.INFINITE_CACHE,
                collectedExpire: prerenderStore !== null ? prerenderStore.expire : _constants1.INFINITE_CACHE,
                collectedStale: selectStaleTime(prerenderStore !== null ? prerenderStore.stale : _constants1.INFINITE_CACHE),
                collectedTags: prerenderStore !== null ? prerenderStore.tags : null
            };
        } catch (finalErr) {
            if (process.env.__NEXT_DEV_SERVER && (0, _httpaccessfallback.isHTTPAccessFallbackError)(finalErr)) {
                const { bailOnRootNotFound } = require('../../client/components/dev-root-http-access-fallback-boundary');
                bailOnRootNotFound();
            }
            throw finalErr;
        }
    }
}
const getGlobalErrorStyles = async (tree, ctx)=>{
    const globalErrorModule = (0, _parseloadertree.parseLoaderTree)(tree).modules['global-error'];
    if (!globalErrorModule) {
        throw Object.defineProperty(new Error('Invariant: global-error module is required but not found in loader tree'), "__NEXT_ERROR_CODE", {
            value: "E983",
            enumerable: false,
            configurable: true
        });
    }
    const { componentMod: { createElement } } = ctx;
    // Get the GlobalError component and styles from the loader tree
    const [GlobalErrorComponent, styles] = await (0, _createcomponentstylesandscripts.createComponentStylesAndScripts)({
        ctx,
        filePath: globalErrorModule[1],
        getComponent: globalErrorModule[0],
        injectedCSS: new Set(),
        injectedJS: new Set()
    });
    let globalErrorStyles = styles;
    if (process.env.__NEXT_DEV_SERVER) {
        const dir = (process.env.NEXT_RUNTIME === 'edge' ? process.env.__NEXT_EDGE_PROJECT_DIR : ctx.renderOpts.dir) || '';
        const globalErrorModulePath = (0, _segmentexplorerpath.normalizeConventionFilePath)(dir, globalErrorModule[1]);
        if (globalErrorModulePath) {
            const SegmentViewNode = ctx.componentMod.SegmentViewNode;
            globalErrorStyles = // This will be rendered next to GlobalError component under ErrorBoundary,
            // it requires a key to avoid React warning about duplicate keys.
            createElement(SegmentViewNode, {
                key: 'ge-svn',
                type: 'global-error',
                pagePath: globalErrorModulePath
            }, globalErrorStyles);
        }
    }
    return {
        GlobalError: GlobalErrorComponent,
        styles: globalErrorStyles
    };
};
async function collectSegmentData(fullPageDataBuffer, prerenderStore, ComponentMod, renderOpts, pagePath, metadata) {
    // Per-segment prefetch data
    //
    // All of the segments for a page are generated simultaneously, including
    // during revalidations. This is to ensure consistency, because it's
    // possible for a mismatch between a layout and page segment can cause the
    // client to error during rendering. We want to preserve the ability of the
    // client to recover from such a mismatch by re-requesting all the segments
    // to get a consistent view of the page.
    //
    // For performance, we reuse the Flight output that was created when
    // generating the initial page HTML. The Flight stream for the whole page is
    // decomposed into a separate stream per segment.
    const { clientModules, edgeRscModuleMapping, rscModuleMapping } = (0, _manifestssingleton.getClientReferenceManifest)();
    // Manifest passed to the Flight client for reading the full-page Flight
    // stream. Based off similar code in use-cache-wrapper.ts.
    const isEdgeRuntime = process.env.NEXT_RUNTIME === 'edge';
    const serverConsumerManifest = {
        // moduleLoading must be null because we don't want to trigger preloads of ClientReferences
        // to be added to the consumer. Instead, we'll wait for any ClientReference to be emitted
        // which themselves will handle the preloading.
        moduleLoading: null,
        moduleMap: isEdgeRuntime ? edgeRscModuleMapping : rscModuleMapping,
        serverModuleMap: (0, _manifestssingleton.getServerModuleMap)()
    };
    const selectStaleTime = (0, _staletime.createSelectStaleTime)(renderOpts.experimental);
    const staleTime = selectStaleTime(prerenderStore.stale);
    // Resolve prefetch hints. At runtime (next start / ISR), the precomputed
    // hints are already loaded from the prefetch-hints.json manifest. During
    // build, compute them by measuring segment gzip sizes and write them to
    // metadata so the build pipeline can persist them to the manifest.
    let hints;
    const prefetchInlining = renderOpts.experimental.prefetchInlining;
    if (!prefetchInlining) {
        hints = null;
    } else if (renderOpts.isBuildTimePrerendering) {
        // Build time: compute fresh hints and store in metadata for the manifest.
        hints = await ComponentMod.collectPrefetchHints(fullPageDataBuffer, staleTime, clientModules, serverConsumerManifest, prefetchInlining.maxSize, prefetchInlining.maxBundleSize);
        metadata.prefetchHints = hints;
    } else {
        var _renderOpts_prefetchHints;
        // Runtime: use hints from the manifest. Never compute fresh hints
        // during ISR/revalidation.
        hints = ((_renderOpts_prefetchHints = renderOpts.prefetchHints) == null ? void 0 : _renderOpts_prefetchHints[pagePath]) ?? null;
    }
    // Pass the resolved hints so collectSegmentData can union them into
    // the TreePrefetch. During the initial build the FlightRouterState in
    // the buffer doesn't have inlining hints yet (they were just computed
    // above), so we need to merge them in here. At runtime/ISR the hints
    // are already embedded in the FlightRouterState, so this is null.
    metadata.segmentData = await ComponentMod.collectSegmentData(renderOpts.cacheComponents, fullPageDataBuffer, staleTime, clientModules, serverConsumerManifest, Boolean(renderOpts.experimental.prefetchInlining), hints);
}
function isBypassingCachesInDev(requestStore) {
    return !!process.env.__NEXT_DEV_SERVER && requestStore.headers.get('cache-control') === 'no-cache';
}
function WarnForBypassCachesInDev({ route }) {
    (0, _warnonce.warnOnce)(`Route ${route} is rendering with server caches disabled. For this navigation, Component Metadata in React DevTools will not accurately reflect what is statically prerenderable and runtime prefetchable. See more info here: https://nextjs.org/docs/messages/cache-bypass-in-dev`);
    return null;
}
function nodeStreamFromReadableStream(stream) {
    if (process.env.NEXT_RUNTIME === 'edge') {
        throw Object.defineProperty(new _invarianterror.InvariantError('nodeStreamFromReadableStream cannot be used in the edge runtime'), "__NEXT_ERROR_CODE", {
            value: "E944",
            enumerable: false,
            configurable: true
        });
    } else {
        const reader = stream.getReader();
        const { Readable } = require('node:stream');
        return new Readable({
            read () {
                reader.read().then(({ done, value })=>{
                    if (done) {
                        this.push(null);
                    } else {
                        this.push(value);
                    }
                }).catch((err)=>this.destroy(err));
            }
        });
    }
}

//# sourceMappingURL=app-render.js.map