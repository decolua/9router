"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "normalizeAppPageRequestUrl", {
    enumerable: true,
    get: function() {
        return normalizeAppPageRequestUrl;
    }
});
const _url = require("../../../lib/url");
const _formaturl = require("../../../shared/lib/router/utils/format-url");
function normalizeAppPageRequestUrl(req, pathname) {
    if (!req.url) {
        return;
    }
    const normalizedUrl = (0, _url.parseReqUrl)(req.url);
    if (!normalizedUrl) {
        return;
    }
    normalizedUrl.pathname = pathname;
    req.url = (0, _formaturl.formatUrl)(normalizedUrl);
}

//# sourceMappingURL=normalize-request-url.js.map