"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    isFullStringUrl: null,
    parseReqUrl: null,
    parseUrl: null,
    stripNextRscUnionQuery: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    isFullStringUrl: function() {
        return isFullStringUrl;
    },
    parseReqUrl: function() {
        return parseReqUrl;
    },
    parseUrl: function() {
        return parseUrl;
    },
    stripNextRscUnionQuery: function() {
        return stripNextRscUnionQuery;
    }
});
const _approuterheaders = require("../client/components/app-router-headers");
const DUMMY_ORIGIN = 'http://n';
function isFullStringUrl(url) {
    return /https?:\/\//.test(url);
}
function parseUrl(url) {
    let parsed = undefined;
    try {
        parsed = new URL(url, DUMMY_ORIGIN);
    } catch  {}
    return parsed;
}
function parseReqUrl(url) {
    const parsedUrl = parseUrl(url);
    if (!parsedUrl) {
        return;
    }
    const query = {};
    for (const key of parsedUrl.searchParams.keys()){
        const values = parsedUrl.searchParams.getAll(key);
        query[key] = values.length > 1 ? values : values[0];
    }
    const legacyUrl = {
        query,
        hash: parsedUrl.hash,
        search: parsedUrl.search,
        path: parsedUrl.pathname,
        pathname: parsedUrl.pathname,
        href: `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`,
        host: '',
        hostname: '',
        auth: '',
        protocol: '',
        slashes: null,
        port: ''
    };
    return legacyUrl;
}
function stripNextRscUnionQuery(relativeUrl) {
    const urlInstance = new URL(relativeUrl, DUMMY_ORIGIN);
    urlInstance.searchParams.delete(_approuterheaders.NEXT_RSC_UNION_QUERY);
    return urlInstance.pathname + urlInstance.search;
}

//# sourceMappingURL=url.js.map