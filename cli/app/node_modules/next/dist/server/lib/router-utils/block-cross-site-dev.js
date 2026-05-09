"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "blockCrossSiteDEV", {
    enumerable: true,
    get: function() {
        return blockCrossSiteDEV;
    }
});
const _url = require("../../../lib/url");
const _log = require("../../../build/output/log");
const _csrfprotection = require("../../app-render/csrf-protection");
const allowedDevOriginsDocs = 'https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins';
function getBlockedResourcePath(req) {
    var _parseUrl;
    return ((_parseUrl = (0, _url.parseUrl)(req.url ?? '')) == null ? void 0 : _parseUrl.pathname) ?? req.url ?? '/_next/*';
}
function formatBlockedCrossSiteMessage(source, resourcePath) {
    const lines = [
        `Blocked cross-origin request to Next.js dev resource ${resourcePath}${getBlockedSourceDescription(source)}.`,
        'Cross-origin access to Next.js dev resources is blocked by default for safety.'
    ];
    // `source` has 3 meanings here:
    // - `'null'`: browser explicitly sent `Origin: null` for an opaque/sandboxed origin
    // - hostname string: we parsed an allowlistable host from Origin/Referer
    // - `undefined` (and effectively empty string): the request did not include a usable host
    if (source === 'null') {
        lines.push('', 'This request came from a privacy-sensitive or opaque origin, so Next.js cannot determine which host to allow.', 'If you need it to succeed, load the dev server from a normal origin and add that host to "allowedDevOrigins".');
    } else if (source) {
        lines.push('', 'To allow this host in development, add it to "allowedDevOrigins" in next.config.js and restart the dev server:', '', '// next.config.js', 'module.exports = {', `  allowedDevOrigins: ['${source}'],`, '}');
    } else {
        lines.push('', 'This request did not include an allowlistable source host.', 'If you need it to succeed, make sure the browser sends an Origin or Referer from a host listed in "allowedDevOrigins".');
    }
    lines.push('', `Read more: ${allowedDevOriginsDocs}`);
    return lines.join('\n');
}
function getBlockedSourceDescription(source) {
    if (source === 'null') {
        return ' from a privacy-sensitive or opaque origin';
    }
    if (source) {
        return ` from "${source}"`;
    }
    return ' from an unknown source';
}
function blockRequest(req, res, source) {
    (0, _log.warnOnce)(formatBlockedCrossSiteMessage(source, getBlockedResourcePath(req)));
    if ('statusCode' in res) {
        res.statusCode = 403;
    }
    res.end('Unauthorized');
    return true;
}
function parseHostnameFromHeader(header) {
    const headerValue = Array.isArray(header) ? header[0] : header;
    if (!headerValue || headerValue === 'null') {
        return;
    }
    const parsedHeader = (0, _url.parseUrl)(headerValue);
    return parsedHeader == null ? void 0 : parsedHeader.hostname.toLowerCase();
}
function isInternalEndpoint(req) {
    if (!req.url) return false;
    try {
        // TODO: We should standardize on a single prefix for this
        const isMiddlewareRequest = req.url.includes('/__nextjs');
        const isInternalAsset = req.url.includes('/_next');
        // Static media requests are excluded, as they might be loaded via CSS and would fail
        // CORS checks.
        const isIgnoredRequest = req.url.includes('/_next/image') || req.url.includes('/_next/static/media');
        return !isIgnoredRequest && (isInternalAsset || isMiddlewareRequest);
    } catch (err) {
        return false;
    }
}
const blockCrossSiteDEV = (req, res, allowedDevOrigins, hostname)=>{
    const allowedOrigins = [
        '*.localhost',
        'localhost',
        ...allowedDevOrigins ?? []
    ];
    if (hostname) {
        allowedOrigins.push(hostname);
    }
    // only process internal URLs/middleware
    if (!isInternalEndpoint(req)) {
        return false;
    }
    // block non-cors request from cross-site e.g. script tag on
    // different host
    if (req.headers['sec-fetch-mode'] === 'no-cors' && req.headers['sec-fetch-site'] === 'cross-site') {
        // no-cors requests do not send an Origin header, so fall back to Referer
        // when validating configured cross-site script loads.
        const refererHostname = parseHostnameFromHeader(req.headers['referer']);
        if (refererHostname && (0, _csrfprotection.isCsrfOriginAllowed)(refererHostname, allowedOrigins)) {
            return false;
        }
        return blockRequest(req, res, refererHostname);
    }
    // ensure websocket requests are only fulfilled from allowed origin
    const rawOrigin = req.headers['origin'];
    const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    const parsedOrigin = originHeader && originHeader !== 'null' ? (0, _url.parseUrl)(originHeader) : originHeader;
    const originLowerCase = parsedOrigin === undefined || typeof parsedOrigin === 'string' ? parsedOrigin : parsedOrigin.hostname.toLowerCase();
    // Allow requests with no origin since those are just GET requests from same-site
    return originLowerCase !== undefined && !(0, _csrfprotection.isCsrfOriginAllowed)(originLowerCase, allowedOrigins) && blockRequest(req, res, originLowerCase);
};

//# sourceMappingURL=block-cross-site-dev.js.map