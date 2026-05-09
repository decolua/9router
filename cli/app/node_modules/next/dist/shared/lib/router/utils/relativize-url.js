/**
 * The result of parsing a URL relative to a base URL.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getRelativeURL: null,
    parseRelativeURL: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getRelativeURL: function() {
        return getRelativeURL;
    },
    parseRelativeURL: function() {
        return parseRelativeURL;
    }
});
function parseRelativeURL(url, base) {
    const baseURL = typeof base === 'string' ? new URL(base) : base;
    const relative = new URL(url, base);
    // The URL is relative if the origin is the same as the base URL.
    const isRelative = relative.origin === baseURL.origin;
    return {
        url: isRelative ? relative.toString().slice(baseURL.origin.length) : relative.toString(),
        isRelative
    };
}
function getRelativeURL(url, base) {
    const relative = parseRelativeURL(url, base);
    return relative.url;
}

//# sourceMappingURL=relativize-url.js.map