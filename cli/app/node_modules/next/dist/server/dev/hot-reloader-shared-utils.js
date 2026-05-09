"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getVersionInfo: null,
    matchNextPageBundleRequest: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getVersionInfo: function() {
        return getVersionInfo;
    },
    matchNextPageBundleRequest: function() {
        return matchNextPageBundleRequest;
    }
});
const _pathmatch = require("../../shared/lib/router/utils/path-match");
const _parseversioninfo = require("./parse-version-info");
const matchNextPageBundleRequest = (0, _pathmatch.getPathMatch)('/_next/static/chunks/pages/:path*.js(\\.map|)');
async function getVersionInfo() {
    let installed = '0.0.0';
    try {
        installed = require('next/package.json').version;
        let res;
        try {
            // use NPM registry regardless user using Yarn
            res = await fetch('https://registry.npmjs.org/-/package/next/dist-tags');
        } catch  {
        // ignore fetch errors
        }
        if (!res || !res.ok) return {
            installed,
            staleness: 'unknown'
        };
        const { latest, canary } = await res.json();
        return (0, _parseversioninfo.parseVersionInfo)({
            installed,
            latest,
            canary
        });
    } catch (e) {
        console.error(e);
        return {
            installed,
            staleness: 'unknown'
        };
    }
}

//# sourceMappingURL=hot-reloader-shared-utils.js.map