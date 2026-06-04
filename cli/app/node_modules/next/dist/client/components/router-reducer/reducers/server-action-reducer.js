"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "serverActionReducer", {
    enumerable: true,
    get: function() {
        return serverActionReducer;
    }
});
const _appcallserver = require("../../../app-call-server");
const _appfindsourcemapurl = require("../../../app-find-source-map-url");
const _approuterheaders = require("../../app-router-headers");
const _unrecognizedactionerror = require("../../unrecognized-action-error");
const _client = require("react-server-dom-webpack/client");
const _routerreducertypes = require("../router-reducer-types");
const _assignlocation = require("../../../assign-location");
const _createhreffromurl = require("../create-href-from-url");
const _hasinterceptionrouteincurrenttree = require("./has-interception-route-in-current-tree");
const _flightdatahelpers = require("../../../flight-data-helpers");
const _redirect = require("../../redirect");
const _removebasepath = require("../../../remove-base-path");
const _hasbasepath = require("../../../has-base-path");
const _serverreferenceinfo = require("../../../../shared/lib/server-reference-info");
const _cache = require("../../segment-cache/cache");
const _scheduler = require("../../segment-cache/scheduler");
const _deploymentid = require("../../../../shared/lib/deployment-id");
const _navigationbuildid = require("../../../navigation-build-id");
const _constants = require("../../../../lib/constants");
const _navigation = require("../../segment-cache/navigation");
const _optimisticroutes = require("../../segment-cache/optimistic-routes");
const _actionrevalidationkind = require("../../../../shared/lib/action-revalidation-kind");
const _approuterutils = require("../../app-router-utils");
const _pprnavigations = require("../ppr-navigations");
const _fetchserverresponse = require("../fetch-server-response");
const _bfcache = require("../../segment-cache/bfcache");
const createFromFetch = _client.createFromFetch;
let createDebugChannel;
if (process.env.__NEXT_DEV_SERVER && process.env.__NEXT_REACT_DEBUG_CHANNEL) {
    createDebugChannel = require('../../../dev/debug-channel').createDebugChannel;
}
async function fetchServerAction(state, nextUrl, { actionId, actionArgs }) {
    const temporaryReferences = (0, _client.createTemporaryReferenceSet)();
    const info = (0, _serverreferenceinfo.extractInfoFromServerReferenceId)(actionId);
    const usedArgs = (0, _serverreferenceinfo.omitUnusedArgs)(actionArgs, info);
    const body = await (0, _client.encodeReply)(usedArgs, {
        temporaryReferences
    });
    const headers = {
        Accept: _approuterheaders.RSC_CONTENT_TYPE_HEADER,
        [_approuterheaders.ACTION_HEADER]: actionId,
        [_approuterheaders.NEXT_ROUTER_STATE_TREE_HEADER]: (0, _flightdatahelpers.prepareFlightRouterStateForRequest)(state.tree)
    };
    const deploymentId = (0, _deploymentid.getDeploymentId)();
    if (deploymentId) {
        headers['x-deployment-id'] = deploymentId;
    }
    if (nextUrl) {
        headers[_approuterheaders.NEXT_URL] = nextUrl;
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
    const res = await fetch(state.canonicalUrl, {
        method: 'POST',
        headers,
        body
    });
    // Handle server actions that the server didn't recognize.
    const unrecognizedActionHeader = res.headers.get(_approuterheaders.NEXT_ACTION_NOT_FOUND_HEADER);
    if (unrecognizedActionHeader === '1') {
        throw Object.defineProperty(new _unrecognizedactionerror.UnrecognizedActionError(`Server Action "${actionId}" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action`), "__NEXT_ERROR_CODE", {
            value: "E715",
            enumerable: false,
            configurable: true
        });
    }
    const redirectHeader = res.headers.get('x-action-redirect');
    const [location1, _redirectType] = redirectHeader?.split(';') || [];
    let redirectType;
    switch(_redirectType){
        case 'push':
            redirectType = 'push';
            break;
        case 'replace':
            redirectType = 'replace';
            break;
        default:
            redirectType = undefined;
    }
    const isPrerender = !!res.headers.get(_approuterheaders.NEXT_IS_PRERENDER_HEADER);
    let revalidationKind = _actionrevalidationkind.ActionDidNotRevalidate;
    try {
        const revalidationHeader = res.headers.get('x-action-revalidated');
        if (revalidationHeader) {
            const parsedKind = JSON.parse(revalidationHeader);
            if (parsedKind === _actionrevalidationkind.ActionDidRevalidateStaticAndDynamic || parsedKind === _actionrevalidationkind.ActionDidRevalidateDynamicOnly) {
                revalidationKind = parsedKind;
            }
        }
    } catch  {}
    const redirectLocation = location1 ? (0, _assignlocation.assignLocation)(location1, new URL(state.canonicalUrl, window.location.href)) : undefined;
    const contentType = res.headers.get('content-type');
    const isRscResponse = !!(contentType && contentType.startsWith(_approuterheaders.RSC_CONTENT_TYPE_HEADER));
    // Handle invalid server action responses.
    // A valid response must have `content-type: text/x-component`, unless it's an external redirect.
    // (external redirects have an 'x-action-redirect' header, but the body is an empty 'text/plain')
    if (!isRscResponse && !redirectLocation) {
        // The server can respond with a text/plain error message, but we'll fallback to something generic
        // if there isn't one.
        const message = res.status >= 400 && contentType === 'text/plain' ? await res.text() : 'An unexpected response was received from the server.';
        throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    let actionResult;
    let actionFlightData;
    let actionFlightDataRenderedSearch;
    let couldBeIntercepted = false;
    if (isRscResponse) {
        // Server action redirect responses carry the Flight data of the redirect
        // target, which may be prerendered with a completeness marker byte
        // prepended. Strip it before passing to Flight.
        const responsePromise = redirectLocation ? (0, _fetchserverresponse.processFetch)(res).then(({ response: r })=>r) : Promise.resolve(res);
        const response = await createFromFetch(responsePromise, {
            callServer: _appcallserver.callServer,
            findSourceMapURL: _appfindsourcemapurl.findSourceMapURL,
            temporaryReferences,
            debugChannel: createDebugChannel && createDebugChannel(headers)
        });
        // An internal redirect can send an RSC response, but does not have a useful `actionResult`.
        actionResult = redirectLocation ? undefined : response.a;
        couldBeIntercepted = response.i;
        // Check if the response build ID matches the client build ID.
        // In a multi-zone setup, when a server action triggers a redirect,
        // the server pre-fetches the redirect target as RSC. If the redirect
        // target is served by a different Next.js zone (different build), the
        // pre-fetched RSC data will have a foreign build ID. We must discard
        // the flight data in that case so the redirect triggers an MPA
        // navigation (full page load) instead of trying to apply the foreign
        // RSC payload — which would result in a blank page.
        const responseBuildId = res.headers.get(_constants.NEXT_NAV_DEPLOYMENT_ID_HEADER) ?? response.b;
        if (responseBuildId !== undefined && responseBuildId !== (0, _navigationbuildid.getNavigationBuildId)()) {
        // Build ID mismatch — discard the flight data. The redirect will
        // still be processed, and the absence of flight data will cause an
        // MPA navigation via completeHardNavigation().
        } else {
            const maybeFlightData = (0, _flightdatahelpers.normalizeFlightData)(response.f);
            if (maybeFlightData !== '') {
                actionFlightData = maybeFlightData;
                actionFlightDataRenderedSearch = response.q;
            }
        }
    } else {
        // An external redirect doesn't contain RSC data.
        actionResult = undefined;
        actionFlightData = undefined;
        actionFlightDataRenderedSearch = undefined;
    }
    return {
        actionResult,
        actionFlightData,
        actionFlightDataRenderedSearch,
        redirectLocation,
        redirectType,
        revalidationKind,
        isPrerender,
        couldBeIntercepted
    };
}
function serverActionReducer(state, action) {
    const { resolve, reject } = action;
    // only pass along the `nextUrl` param (used for interception routes) if the current route was intercepted.
    // If the route has been intercepted, the action should be as well.
    // Otherwise the server action might be intercepted with the wrong action id
    // (ie, one that corresponds with the intercepted route)
    const nextUrl = // We always send the last next-url, not the current when
    // performing a dynamic request. This is because we update
    // the next-url after a navigation, but we want the same
    // interception route to be matched that used the last
    // next-url.
    (state.previousNextUrl || state.nextUrl) && (0, _hasinterceptionrouteincurrenttree.hasInterceptionRouteInCurrentTree)(state.tree) ? state.previousNextUrl || state.nextUrl : null;
    return fetchServerAction(state, nextUrl, action).then(async ({ revalidationKind, actionResult, actionFlightData: flightData, actionFlightDataRenderedSearch: flightDataRenderedSearch, redirectLocation, redirectType, isPrerender, couldBeIntercepted })=>{
        if (revalidationKind !== _actionrevalidationkind.ActionDidNotRevalidate) {
            // There was either a revalidation or a refresh, or maybe both.
            // Evict the BFCache, which may contain dynamic data.
            (0, _bfcache.invalidateBfCache)();
            // Store whether this action triggered any revalidation
            // The action queue will use this information to potentially
            // trigger a refresh action if the action was discarded
            // (ie, due to a navigation, before the action completed)
            action.didRevalidate = true;
            // If there was a revalidation, evict the prefetch cache.
            // TODO: Evict only segments with matching tags and/or paths.
            // TODO: We should only invalidate the route cache if cookies were
            // mutated, since route trees may vary based on cookies. For now we
            // invalidate both caches until we have a way to detect cookie
            // mutations on the client.
            if (revalidationKind === _actionrevalidationkind.ActionDidRevalidateStaticAndDynamic) {
                (0, _cache.invalidateEntirePrefetchCache)(nextUrl, state.tree);
            }
            // Start a cooldown before re-prefetching to allow CDN cache
            // propagation.
            (0, _scheduler.startRevalidationCooldown)();
        }
        const navigateType = redirectType || 'push';
        if (redirectLocation !== undefined) {
            // If the action triggered a redirect, the action promise will be rejected with
            // a redirect so that it's handled by RedirectBoundary as we won't have a valid
            // action result to resolve the promise with. This will effectively reset the state of
            // the component that called the action as the error boundary will remount the tree.
            // The status code doesn't matter here as the action handler will have already sent
            // a response with the correct status code.
            if ((0, _approuterutils.isExternalURL)(redirectLocation)) {
                // External redirect. Triggers an MPA navigation.
                const redirectHref = redirectLocation.href;
                const redirectError = createRedirectErrorForAction(redirectHref, navigateType);
                reject(redirectError);
                return (0, _navigation.completeHardNavigation)(state, redirectLocation, navigateType);
            } else {
                // Internal redirect. Triggers an SPA navigation.
                const redirectWithBasepath = (0, _createhreffromurl.createHrefFromUrl)(redirectLocation, false);
                const redirectHref = (0, _hasbasepath.hasBasePath)(redirectWithBasepath) ? (0, _removebasepath.removeBasePath)(redirectWithBasepath) : redirectWithBasepath;
                const redirectError = createRedirectErrorForAction(redirectHref, navigateType);
                reject(redirectError);
            }
        } else {
            // If there's no redirect, resolve the action with the result.
            resolve(actionResult);
        }
        // Check if we can bail out without updating any state.
        if (// Did the action trigger a redirect?
        redirectLocation === undefined && // Did the action revalidate any data?
        revalidationKind === _actionrevalidationkind.ActionDidNotRevalidate && // Did the server render new data?
        flightData === undefined) {
            // The action did not trigger any revalidations or redirects. No
            // navigation is required.
            return state;
        }
        if (flightData === undefined && redirectLocation !== undefined) {
            // The server redirected, but did not send any Flight data. This implies
            // an external redirect.
            // TODO: We should refactor the action response type to be more explicit
            // about the various response types.
            return (0, _navigation.completeHardNavigation)(state, redirectLocation, navigateType);
        }
        if (typeof flightData === 'string') {
            // If the flight data is just a string, something earlier in the
            // response handling triggered an external redirect.
            return (0, _navigation.completeHardNavigation)(state, new URL(flightData, location.origin), navigateType);
        }
        // The action triggered a navigation — either a redirect, a revalidation,
        // or both.
        // If there was no redirect, then the target URL is the same as the
        // current URL.
        const currentUrl = new URL(state.canonicalUrl, location.origin);
        const currentRenderedSearch = state.renderedSearch;
        const redirectUrl = redirectLocation !== undefined ? redirectLocation : currentUrl;
        const currentFlightRouterState = state.tree;
        const scrollBehavior = _routerreducertypes.ScrollBehavior.Default;
        // If the action triggered a revalidation of the cache, we should also
        // refresh all the dynamic data.
        const freshnessPolicy = revalidationKind === _actionrevalidationkind.ActionDidNotRevalidate ? _pprnavigations.FreshnessPolicy.Default : _pprnavigations.FreshnessPolicy.RefreshAll;
        // The server may have sent back new data. If so, we will perform a
        // "seeded" navigation that uses the data from the response.
        // TODO: Currently the server always renders from the root in
        // response to a Server Action. In the case of a normal redirect
        // with no revalidation, it should skip over the shared layouts.
        if (flightData !== undefined && flightDataRenderedSearch !== undefined) {
            // The server sent back new route data as part of the response. We
            // will use this to render the new page. If this happens to be only a
            // subset of the data needed to render the new page, we'll initiate a
            // new fetch, like we would for a normal navigation.
            const redirectCanonicalUrl = (0, _createhreffromurl.createHrefFromUrl)(redirectUrl);
            const now = Date.now();
            // TODO: Store the dynamic stale time on the top-level state so it's
            // known during restores and refreshes.
            const redirectSeed = (0, _navigation.convertServerPatchToFullTree)(now, currentFlightRouterState, flightData, flightDataRenderedSearch, _bfcache.UnknownDynamicStaleTime);
            // Learn the route pattern so we can predict it for future navigations.
            const metadataVaryPath = redirectSeed.metadataVaryPath;
            if (metadataVaryPath !== null) {
                (0, _optimisticroutes.discoverKnownRoute)(now, redirectUrl.pathname, nextUrl, null, redirectSeed.routeTree, metadataVaryPath, couldBeIntercepted, redirectCanonicalUrl, isPrerender, false // hasDynamicRewrite
                );
            }
            return (0, _navigation.navigateToKnownRoute)(now, state, redirectUrl, redirectCanonicalUrl, redirectSeed, currentUrl, currentRenderedSearch, state.cache, currentFlightRouterState, freshnessPolicy, nextUrl, scrollBehavior, navigateType, null, // Server action redirects don't use route prediction - we already
            // have the route tree from the server response. If a mismatch occurs
            // during dynamic data fetch, the retry handler will traverse the
            // known route tree to mark the entry as having a dynamic rewrite.
            null);
        }
        // The server did not send back new data. We'll perform a regular, non-
        // seeded navigation — effectively the same as <Link> or router.push().
        return (0, _navigation.navigate)(state, redirectUrl, currentUrl, currentRenderedSearch, state.cache, currentFlightRouterState, nextUrl, freshnessPolicy, scrollBehavior, navigateType);
    }, (e)=>{
        // When the server action is rejected we don't update the state and instead call the reject handler of the promise.
        reject(e);
        return state;
    });
}
function createRedirectErrorForAction(redirectHref, resolvedRedirectType) {
    const redirectError = (0, _redirect.getRedirectError)(redirectHref, resolvedRedirectType);
    redirectError.handled = true;
    return redirectError;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=server-action-reducer.js.map