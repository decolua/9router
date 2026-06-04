"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "parseUrl", {
    enumerable: true,
    get: function() {
        return parseUrl;
    }
});
const _querystring = require("./querystring");
const _parserelativeurl = require("./parse-relative-url");
function parseUrl(url) {
    if (url.startsWith('/')) {
        return (0, _parserelativeurl.parseRelativeUrl)(url);
    }
    const parsedURL = new URL(url);
    const username = parsedURL.username;
    const password = parsedURL.password;
    const auth = username ? password ? `${username}:${password}` : username : null;
    const pathname = parsedURL.pathname;
    const search = parsedURL.search;
    return {
        auth,
        hash: parsedURL.hash,
        hostname: parsedURL.hostname,
        href: parsedURL.href,
        pathname,
        port: parsedURL.port,
        protocol: parsedURL.protocol,
        query: (0, _querystring.searchParamsToUrlQuery)(parsedURL.searchParams),
        search,
        origin: parsedURL.origin,
        slashes: parsedURL.href.slice(parsedURL.protocol.length, parsedURL.protocol.length + 2) === '//'
    };
}

//# sourceMappingURL=parse-url.js.map