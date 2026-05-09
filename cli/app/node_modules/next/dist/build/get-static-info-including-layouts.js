"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getStaticInfoIncludingLayouts", {
    enumerable: true,
    get: function() {
        return getStaticInfoIncludingLayouts;
    }
});
const _path = require("path");
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _utils = require("./utils");
const _getpagestaticinfo = require("./analysis/get-page-static-info");
const _pagetypes = require("../lib/page-types");
const _isapppageroute = require("../lib/is-app-page-route");
const _entryconstants = require("../shared/lib/entry-constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function getStaticInfoIncludingLayouts({ isInsideAppDir, pageExtensions, pageFilePath, appDir, config: nextConfig, isDev, page }) {
    // TODO: sync types for pages: PAGE_TYPES, ROUTER_TYPE, 'app' | 'pages', etc.
    const pageType = isInsideAppDir ? _pagetypes.PAGE_TYPES.APP : _pagetypes.PAGE_TYPES.PAGES;
    const pageStaticInfo = await (0, _getpagestaticinfo.getPageStaticInfo)({
        nextConfig,
        pageFilePath,
        isDev,
        page,
        pageType
    });
    if (pageStaticInfo.type === _pagetypes.PAGE_TYPES.PAGES || !appDir) {
        return pageStaticInfo;
    }
    // Skip inheritance for global-error pages - always use default config
    if (page === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY) {
        return pageStaticInfo;
    }
    const segments = [
        pageStaticInfo
    ];
    // inherit from layout files only if it's a page route and not a builtin page
    if ((0, _isapppageroute.isAppPageRoute)(page) && !(0, _utils.isAppBuiltinPage)(pageFilePath)) {
        const layoutFiles = [];
        const potentialLayoutFiles = pageExtensions.map((ext)=>'layout.' + ext);
        let dir = (0, _path.dirname)(pageFilePath);
        // Uses startsWith to not include directories further up.
        while(dir.startsWith(appDir)){
            for (const potentialLayoutFile of potentialLayoutFiles){
                const layoutFile = (0, _path.join)(dir, potentialLayoutFile);
                if (!_fs.default.existsSync(layoutFile)) {
                    continue;
                }
                layoutFiles.push(layoutFile);
            }
            // Walk up the directory tree
            dir = (0, _path.join)(dir, '..');
        }
        for (const layoutFile of layoutFiles){
            const layoutStaticInfo = await (0, _getpagestaticinfo.getAppPageStaticInfo)({
                nextConfig,
                pageFilePath: layoutFile,
                isDev,
                page,
                pageType: isInsideAppDir ? _pagetypes.PAGE_TYPES.APP : _pagetypes.PAGE_TYPES.PAGES
            });
            segments.unshift(layoutStaticInfo);
        }
    }
    const config = (0, _utils.reduceAppConfig)(segments);
    return {
        ...pageStaticInfo,
        config,
        runtime: config.runtime,
        preferredRegion: config.preferredRegion,
        maxDuration: config.maxDuration
    };
}

//# sourceMappingURL=get-static-info-including-layouts.js.map