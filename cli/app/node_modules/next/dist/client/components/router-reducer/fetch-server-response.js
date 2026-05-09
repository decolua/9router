'use client';
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createFetch: null,
    createFromNextReadableStream: null,
    decodeStaticStage: null,
    fetchServerResponse: null,
    processFetch: null,
    resolveStaticStageData: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createFetch: function() {
        return createFetch;
    },
    createFromNextReadableStream: function() {
        return createFromNextReadableStream;
    },
    decodeStaticStage: function() {
        return decodeStaticStage;
    },
    fetchServerResponse: function() {
        return fetchServerResponse;
    },
    processFetch: function() {
        return processFetch;
    },
    resolveStaticStageData: function() {
        return resolveStaticStageData;
    }
});
const _client = require("react-server-dom-webpack/client");
const _invarianterror = require("../../../shared/lib/invariant-error");
const _approuterheaders = require("../app-router-headers");
const _appcallserver = require("../../app-call-server");
const _appfindsourcemapurl = require("../../app-find-source-map-url");
const _flightdatahelpers = require("../../flight-data-helpers");
const _setcachebustingsearchparam = require("./set-cache-busting-search-param");
const _routeparams = require("../../route-params");
const _deploymentid = require("../../../shared/lib/deployment-id");
const _navigationbuildid = require("../../navigation-build-id");
const _constants = require("../../../lib/constants");
const _cache = require("../segment-cache/cache");
const _bfcache = require("../segment-cache/bfcache");
const createFromReadableStream = _client.createFromReadableStream;
const createFromFetch = _client.createFromFetch;
let createDebugChannel;
if (process.env.__NEXT_DEV_SERVER && process.env.__NEXT_REACT_DEBUG_CHANNEL) {
    createDebugChannel = require('../../dev/debug-channel').createDebugChannel;
}
function doMpaNavigation(url) {
    return (0, _routeparams.urlToUrlWithoutFlightMarker)(new URL(url, location.origin)).toString();
}
let isPageUnloading = false;
if (typeof window !== 'undefined') {
    // Track when the page is unloading, e.g. due to reloading the page or
    // performing hard navigations. This allows us to suppress error logging when
    // the browser cancels in-flight requests during page unload.
    window.addEventListener('pagehide', ()=>{
        isPageUnloading = true;
    });
    // Reset the flag on pageshow, e.g. when navigating back and the JavaScript
    // execution context is restored by the browser.
    window.addEventListener('pageshow', ()=>{
        isPageUnloading = false;
    });
}
async function fetchServerResponse(url, options) {
    const { flightRouterState, nextUrl } = options;
    const headers = {
        // Enable flight response
        [_approuterheaders.RSC_HEADER]: '1',
        // Provide the current router state
        [_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER]: (0, _flightdatahelpers.prepareFlightRouterStateForRequest)(flightRouterState, options.isHmrRefresh)
    };
    if (process.env.NODE_ENV === 'development' && options.isHmrRefresh) {
        headers[_approuterheaders.NEXT_HMR_REFRESH_HEADER] = '1';
    }
    if (nextUrl) {
        headers[_approuterheaders.NEXT_URL] = nextUrl;
    }
    // In static export mode, we need to modify the URL to request the .txt file,
    // but we should preserve the original URL for the canonical URL and error handling.
    const originalUrl = url;
    try {
        if (process.env.NODE_ENV === 'production') {
            if (process.env.__NEXT_CONFIG_OUTPUT === 'export') {
                // In "output: export" mode, we can't rely on headers to distinguish
                // between HTML and RSC requests. Instead, we append an extra prefix
                // to the request.
                url = new URL(url);
                if (url.pathname.endsWith('/')) {
                    url.pathname += 'index.txt';
                } else {
                    url.pathname += '.txt';
                }
            }
        }
        // Typically, during a navigation, we decode the response using Flight's
        // `createFromFetch` API, which accepts a `fetch` promise.
        // TODO: Remove this check once the old PPR flag is removed
        const isLegacyPPR = process.env.__NEXT_PPR && !process.env.__NEXT_CACHE_COMPONENTS;
        const shouldImmediatelyDecode = !isLegacyPPR;
        const res = await createFetch(url, headers, 'auto', shouldImmediatelyDecode);
        const responseUrl = (0, _routeparams.urlToUrlWithoutFlightMarker)(new URL(res.url));
        const canonicalUrl = res.redirected ? responseUrl : originalUrl;
        const contentType = res.headers.get('content-type') || '';
        const interception = !!res.headers.get('vary')?.includes(_approuterheaders.NEXT_URL);
        const postponed = !!res.headers.get(_approuterheaders.NEXT_DID_POSTPONE_HEADER);
        let isFlightResponse = contentType.startsWith(_approuterheaders.RSC_CONTENT_TYPE_HEADER);
        if (process.env.NODE_ENV === 'production') {
            if (process.env.__NEXT_CONFIG_OUTPUT === 'export') {
                if (!isFlightResponse) {
                    isFlightResponse = contentType.startsWith('text/plain');
                }
            }
        }
        // If fetch returns something different than flight response handle it like a mpa navigation
        // If the fetch was not 200, we also handle it like a mpa navigation
        if (!isFlightResponse || !res.ok || !res.body) {
            // in case the original URL came with a hash, preserve it before redirecting to the new URL
            if (url.hash) {
                responseUrl.hash = url.hash;
            }
            return doMpaNavigation(responseUrl.toString());
        }
        // We may navigate to a page that requires a different Webpack runtime.
        // In prod, every page will have the same Webpack runtime.
        // In dev, the Webpack runtime is minimal for each page.
        // We need to ensure the Webpack runtime is updated before executing client-side JS of the new page.
        // TODO: This needs to happen in the Flight Client.
        // Or Webpack needs to include the runtime update in the Flight response as
        // a blocking script.
        if (process.env.NODE_ENV !== 'production' && !process.env.TURBOPACK) {
            await require('../../dev/hot-reloader/app/hot-reloader-app').waitForWebpackRuntimeHotUpdate();
        }
        let flightResponsePromise = res.flightResponsePromise;
        if (flightResponsePromise === null) {
            // Typically, `createFetch` would have already started decoding the
            // Flight response. If it hasn't, though, we need to decode it now.
            // TODO: This should only be reachable if legacy PPR is enabled (i.e. PPR
            // without Cache Components). Remove this branch once legacy PPR
            // is deleted.
            flightResponsePromise = createFromNextReadableStream(res.body, headers, {
                allowPartialStream: postponed
            });
        }
        const [flightResponse, cacheData] = await Promise.all([
            flightResponsePromise,
            res.cacheData
        ]);
        if ((res.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? flightResponse.b) !== (0, _navigationbuildid.getNavigationBuildId)()) {
            // The server build does not match the client build.
            return doMpaNavigation(res.url);
        }
        const normalizedFlightData = (0, _flightdatahelpers.normalizeFlightData)(flightResponse.f);
        if (typeof normalizedFlightData === 'string') {
            return doMpaNavigation(normalizedFlightData);
        }
        const staticStageData = cacheData !== null ? await resolveStaticStageData(cacheData, flightResponse, headers) : null;
        return {
            flightData: normalizedFlightData,
            canonicalUrl: canonicalUrl,
            // TODO: We should be able to read this from the rewrite header, not the
            // Flight response. Theoretically they should always agree, but there are
            // currently some cases where it's incorrect for interception routes. We
            // can always trust the value in the response body. However, per-segment
            // prefetch responses don't embed the value in the body; they rely on the
            // header alone. So we need to investigate why the header is sometimes
            // wrong for interception routes.
            renderedSearch: flightResponse.q,
            couldBeIntercepted: interception,
            supportsPerSegmentPrefetching: flightResponse.S,
            postponed,
            // The dynamicStaleTime is only present in the response body when
            // a page exports unstable_dynamicStaleTime and this is a dynamic render.
            // When absent (UnknownDynamicStaleTime), the client falls back to the
            // global DYNAMIC_STALETIME_MS. The value is in seconds.
            dynamicStaleTime: flightResponse.d ?? _bfcache.UnknownDynamicStaleTime,
            staticStageData,
            runtimePrefetchStream: flightResponse.p ?? null,
            responseHeaders: res.headers,
            debugInfo: flightResponsePromise._debugInfo ?? null
        };
    } catch (err) {
        if (!isPageUnloading) {
            console.error(`Failed to fetch RSC payload for ${originalUrl}. Falling back to browser navigation.`, err);
        }
        // If fetch fails handle it like a mpa navigation
        // TODO-APP: Add a test for the case where a CORS request fails, e.g. external url redirect coming from the response.
        // See https://github.com/vercel/next.js/issues/43605#issuecomment-1451617521 for a reproduction.
        return originalUrl.toString();
    }
}
async function processFetch(response) {
    if (process.env.__NEXT_CACHE_COMPONENTS) {
        if (!response.body) {
            throw Object.defineProperty(new _invarianterror.InvariantError('Expected RSC navigation response to have a body'), "__NEXT_ERROR_CODE", {
                value: "E1088",
                enumerable: false,
                configurable: true
            });
        }
        const { stream, isPartial } = await (0, _cache.stripIsPartialByte)(response.body);
        let responseStream;
        let cacheData;
        if (process.env.__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS) {
            const [stream1, stream2] = stream.tee();
            responseStream = stream1;
            cacheData = {
                isResponsePartial: isPartial,
                responseBodyClone: stream2
            };
        } else {
            responseStream = stream;
            cacheData = {
                isResponsePartial: isPartial
            };
        }
        const strippedResponse = new Response(responseStream, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        });
        // The Response constructor doesn't preserve `url` or `redirected` from
        // the original. We need both: `url` for React DevTools and `redirected`
        // for the redirect replay logic below.
        Object.defineProperty(strippedResponse, 'url', {
            value: response.url
        });
        Object.defineProperty(strippedResponse, 'redirected', {
            value: response.redirected
        });
        return {
            response: strippedResponse,
            cacheData
        };
    }
    return {
        response,
        cacheData: null
    };
}
async function resolveStaticStageData(cacheData, flightResponse, headers) {
    const { isResponsePartial, responseBodyClone } = cacheData;
    if (responseBodyClone) {
        if (!isResponsePartial) {
            // Fully static — cache the entire decoded response as-is.
            responseBodyClone.cancel();
            return {
                response: flightResponse,
                isResponsePartial: false
            };
        }
        if (flightResponse.l !== undefined) {
            // Partially static — truncate the body clone at the byte boundary and
            // decode it.
            const response = await decodeStaticStage(responseBodyClone, flightResponse.l, headers);
            return {
                response,
                isResponsePartial: true
            };
        }
        // No caching — cancel the unused clone.
        responseBodyClone.cancel();
    }
    return null;
}
async function decodeStaticStage(responseBodyClone, staticStageByteLengthPromise, headers) {
    const staticStageByteLength = await staticStageByteLengthPromise;
    const truncatedStream = truncateStream(responseBodyClone, staticStageByteLength);
    return createFromNextReadableStream(truncatedStream, headers, {
        allowPartialStream: true
    });
}
async function createFetch(url, headers, fetchPriority, shouldImmediatelyDecode, signal) {
    // TODO: In output: "export" mode, the headers do nothing. Omit them (and the
    // cache busting search param) from the request so they're
    // maximally cacheable.
    if (process.env.__NEXT_TEST_MODE && fetchPriority !== null) {
        headers['Next-Test-Fetch-Priority'] = fetchPriority;
    }
    const deploymentId = (0, _deploymentid.getDeploymentId)();
    if (deploymentId) {
        headers['x-deployment-id'] = deploymentId;
    }
    if (process.env.__NEXT_DEV_SERVER) {
        if (self.__next_r) {
            headers[_approuterheaders.NEXT_HTML_REQUEST_ID_HEADER] = self.__next_r;
        }
        // Create a new request ID for the server action request. The server uses
        // this to tag debug information sent via WebSocket to the client, which
        // then routes those chunks to the debug channel associated with this ID.
        headers[_approuterheaders.NEXT_REQUEST_ID_HEADER] = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
    }
    const fetchOptions = {
        // Backwards compat for older browsers. `same-origin` is the default in modern browsers.
        credentials: 'same-origin',
        headers,
        priority: fetchPriority || undefined,
        signal
    };
    // `fetchUrl` is slightly different from `url` because we add a cache-busting
    // search param to it. This should not leak outside of this function, so we
    // track them separately.
    let fetchUrl = new URL(url);
    (0, _setcachebustingsearchparam.setCacheBustingSearchParam)(fetchUrl, headers);
    let processed = fetch(fetchUrl, fetchOptions).then(processFetch);
    let fetchPromise = processed.then(({ response })=>response);
    // Immediately pass the fetch promise to the Flight client so that the debug
    // info includes the latency from the client to the server. The internal timer
    // in React starts as soon as `createFromFetch` is called.
    //
    // The only case where we don't do this is during a prefetch, because a
    // top-level prefetch response never blocks a navigation; if it hasn't already
    // been written into the cache by the time the navigation happens, the router
    // will go straight to a dynamic request.
    let flightResponsePromise = shouldImmediatelyDecode ? createFromNextFetch(fetchPromise, headers) : null;
    let browserResponse = await fetchPromise;
    // If the server responds with a redirect (e.g. 307), and the redirected
    // location does not contain the cache busting search param set in the
    // original request, the response is likely invalid — when following the
    // redirect, the browser forwards the request headers, but since the cache
    // busting search param is missing, the server will reject the request due to
    // a mismatch.
    //
    // Ideally, we would be able to intercept the redirect response and perform it
    // manually, instead of letting the browser automatically follow it, but this
    // is not allowed by the fetch API.
    //
    // So instead, we must "replay" the redirect by fetching the new location
    // again, but this time we'll append the cache busting search param to prevent
    // a mismatch.
    //
    // TODO: We can optimize Next.js's built-in middleware APIs by returning a
    // custom status code, to prevent the browser from automatically following it.
    //
    // This does not affect Server Action-based redirects; those are encoded
    // differently, as part of the Flight body. It only affects redirects that
    // occur in a middleware or a third-party proxy.
    let redirected = browserResponse.redirected;
    if (process.env.__NEXT_CLIENT_VALIDATE_RSC_REQUEST_HEADERS) {
        // This is to prevent a redirect loop. Same limit used by Chrome.
        const MAX_REDIRECTS = 20;
        for(let n = 0; n < MAX_REDIRECTS; n++){
            if (!browserResponse.redirected) {
                break;
            }
            const responseUrl = new URL(browserResponse.url, fetchUrl);
            if (responseUrl.origin !== fetchUrl.origin) {
                break;
            }
            if (responseUrl.searchParams.get(_approuterheaders.NEXT_RSC_UNION_QUERY) === fetchUrl.searchParams.get(_approuterheaders.NEXT_RSC_UNION_QUERY)) {
                break;
            }
            // The RSC request was redirected. Assume the response is invalid.
            //
            // Append the cache busting search param to the redirected URL and
            // fetch again.
            // TODO: We should abort the previous request.
            fetchUrl = new URL(responseUrl);
            (0, _setcachebustingsearchparam.setCacheBustingSearchParam)(fetchUrl, headers);
            processed = fetch(fetchUrl, fetchOptions).then(processFetch);
            fetchPromise = processed.then(({ response })=>response);
            flightResponsePromise = shouldImmediatelyDecode ? createFromNextFetch(fetchPromise, headers) : null;
            browserResponse = await fetchPromise;
            // We just performed a manual redirect, so this is now true.
            redirected = true;
        }
    }
    // Remove the cache busting search param from the response URL, to prevent it
    // from leaking outside of this function.
    const responseUrl = new URL(browserResponse.url, fetchUrl);
    responseUrl.searchParams.delete(_approuterheaders.NEXT_RSC_UNION_QUERY);
    const rscResponse = {
        url: responseUrl.href,
        // This is true if any redirects occurred, either automatically by the
        // browser, or manually by us. So it's different from
        // `browserResponse.redirected`, which only tells us whether the browser
        // followed a redirect, and only for the last response in the chain.
        redirected,
        // These can be copied from the last browser response we received. We
        // intentionally only expose the subset of fields that are actually used
        // elsewhere in the codebase.
        ok: browserResponse.ok,
        headers: browserResponse.headers,
        body: browserResponse.body,
        status: browserResponse.status,
        // This is the exact promise returned by `createFromFetch`. It contains
        // debug information that we need to transfer to any derived promises that
        // are later rendered by React.
        flightResponsePromise: flightResponsePromise,
        cacheData: processed.then(({ cacheData })=>cacheData)
    };
    return rscResponse;
}
function createFromNextReadableStream(flightStream, requestHeaders, options) {
    return createFromReadableStream(flightStream, {
        callServer: _appcallserver.callServer,
        findSourceMapURL: _appfindsourcemapurl.findSourceMapURL,
        debugChannel: createDebugChannel && createDebugChannel(requestHeaders),
        unstable_allowPartialStream: options?.allowPartialStream
    });
}
function createFromNextFetch(promiseForResponse, requestHeaders) {
    return createFromFetch(promiseForResponse, {
        callServer: _appcallserver.callServer,
        findSourceMapURL: _appfindsourcemapurl.findSourceMapURL,
        debugChannel: createDebugChannel && createDebugChannel(requestHeaders)
    });
}
function truncateStream(stream, byteLength) {
    const reader = stream.getReader();
    let remaining = byteLength;
    return new ReadableStream({
        async pull (controller) {
            if (remaining <= 0) {
                reader.cancel();
                controller.close();
                return;
            }
            const { done, value } = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            if (value.byteLength <= remaining) {
                controller.enqueue(value);
                remaining -= value.byteLength;
            } else {
                controller.enqueue(value.subarray(0, remaining));
                remaining = 0;
                reader.cancel();
                controller.close();
            }
        },
        cancel () {
            reader.cancel();
        }
    });
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=fetch-server-response.js.map