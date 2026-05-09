"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createRequestStoreForAPI: null,
    createRequestStoreForRender: null,
    synchronizeMutableCookies: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createRequestStoreForAPI: function() {
        return createRequestStoreForAPI;
    },
    createRequestStoreForRender: function() {
        return createRequestStoreForRender;
    },
    synchronizeMutableCookies: function() {
        return synchronizeMutableCookies;
    }
});
const _approuterheaders = require("../../client/components/app-router-headers");
const _headers = require("../web/spec-extension/adapters/headers");
const _requestcookies = require("../web/spec-extension/adapters/request-cookies");
const _cookies = require("../web/spec-extension/cookies");
const _draftmodeprovider = require("./draft-mode-provider");
const _utils = require("../web/utils");
function getHeaders(headers) {
    const cleaned = _headers.HeadersAdapter.from(headers);
    for (const header of _approuterheaders.FLIGHT_HEADERS){
        cleaned.delete(header);
    }
    return _headers.HeadersAdapter.seal(cleaned);
}
function getMutableCookies(headers, onUpdateCookies) {
    const cookies = new _cookies.RequestCookies(_headers.HeadersAdapter.from(headers));
    return _requestcookies.MutableRequestCookiesAdapter.wrap(cookies, onUpdateCookies);
}
/**
 * If middleware set cookies in this request (indicated by `x-middleware-set-cookie`),
 * then merge those into the existing cookie object, so that when `cookies()` is accessed
 * it's able to read the newly set cookies.
 */ function mergeMiddlewareCookies(req, existingCookies) {
    if ('x-middleware-set-cookie' in req.headers && typeof req.headers['x-middleware-set-cookie'] === 'string') {
        const setCookieValue = req.headers['x-middleware-set-cookie'];
        const responseHeaders = new Headers();
        for (const cookie of (0, _utils.splitCookiesString)(setCookieValue)){
            responseHeaders.append('set-cookie', cookie);
        }
        const responseCookies = new _cookies.ResponseCookies(responseHeaders);
        // Transfer cookies from ResponseCookies to RequestCookies
        for (const cookie of responseCookies.getAll()){
            existingCookies.set(cookie);
        }
    }
}
function createRequestStoreForRender(req, res, url, rootParams, implicitTags, onUpdateCookies, previewProps, isHmrRefresh, serverComponentsHmrCache, renderResumeDataCache, fallbackParams) {
    return createRequestStoreImpl(// Pages start in render phase by default
    'render', req, res, url, rootParams, implicitTags, onUpdateCookies, renderResumeDataCache, previewProps, isHmrRefresh, serverComponentsHmrCache, fallbackParams);
}
function createRequestStoreForAPI(req, url, implicitTags, onUpdateCookies, previewProps) {
    return createRequestStoreImpl(// API routes start in action phase by default
    'action', req, undefined, url, {}, implicitTags, onUpdateCookies, null, previewProps, false, undefined, null);
}
function createRequestStoreImpl(phase, req, res, url, rootParams, implicitTags, onUpdateCookies, renderResumeDataCache, previewProps, isHmrRefresh, serverComponentsHmrCache, fallbackParams) {
    function defaultOnUpdateCookies(cookies) {
        if (res) {
            res.setHeader('Set-Cookie', cookies);
        }
    }
    const cache = {};
    return {
        type: 'request',
        phase,
        implicitTags,
        // Rather than just using the whole `url` here, we pull the parts we want
        // to ensure we don't use parts of the URL that we shouldn't. This also
        // lets us avoid requiring an empty string for `search` in the type.
        url: {
            pathname: url.pathname,
            search: url.search ?? ''
        },
        rootParams,
        get headers () {
            if (!cache.headers) {
                // Seal the headers object that'll freeze out any methods that could
                // mutate the underlying data.
                cache.headers = getHeaders(req.headers);
            }
            return cache.headers;
        },
        get cookies () {
            if (!cache.cookies) {
                // if middleware is setting cookie(s), then include those in
                // the initial cached cookies so they can be read in render
                const requestCookies = new _cookies.RequestCookies(_headers.HeadersAdapter.from(req.headers));
                mergeMiddlewareCookies(req, requestCookies);
                // Seal the cookies object that'll freeze out any methods that could
                // mutate the underlying data.
                cache.cookies = _requestcookies.RequestCookiesAdapter.seal(requestCookies);
            }
            return cache.cookies;
        },
        set cookies (value){
            cache.cookies = value;
        },
        get mutableCookies () {
            if (!cache.mutableCookies) {
                const mutableCookies = getMutableCookies(req.headers, onUpdateCookies || (res ? defaultOnUpdateCookies : undefined));
                mergeMiddlewareCookies(req, mutableCookies);
                cache.mutableCookies = mutableCookies;
            }
            return cache.mutableCookies;
        },
        get userspaceMutableCookies () {
            if (!cache.userspaceMutableCookies) {
                const userspaceMutableCookies = (0, _requestcookies.createCookiesWithMutableAccessCheck)(this);
                cache.userspaceMutableCookies = userspaceMutableCookies;
            }
            return cache.userspaceMutableCookies;
        },
        get draftMode () {
            if (!cache.draftMode) {
                cache.draftMode = new _draftmodeprovider.DraftModeProvider(previewProps, req, this.cookies, this.mutableCookies);
            }
            return cache.draftMode;
        },
        renderResumeDataCache: renderResumeDataCache ?? null,
        isHmrRefresh,
        serverComponentsHmrCache: serverComponentsHmrCache || globalThis.__serverComponentsHmrCache,
        fallbackParams
    };
}
function synchronizeMutableCookies(store) {
    // TODO: does this need to update headers as well?
    store.cookies = _requestcookies.RequestCookiesAdapter.seal((0, _requestcookies.responseCookiesToRequestCookies)(store.mutableCookies));
}

//# sourceMappingURL=request-store.js.map