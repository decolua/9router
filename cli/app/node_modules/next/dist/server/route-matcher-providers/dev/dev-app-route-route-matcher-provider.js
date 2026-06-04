"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DevAppRouteRouteMatcherProvider", {
    enumerable: true,
    get: function() {
        return DevAppRouteRouteMatcherProvider;
    }
});
const _approuteroutematcher = require("../../route-matchers/app-route-route-matcher");
const _routekind = require("../../route-kind");
const _filecacheroutematcherprovider = require("./file-cache-route-matcher-provider");
const _isapprouteroute = require("../../../lib/is-app-route-route");
const _app = require("../../normalizers/built/app");
const _ismetadataroute = require("../../../lib/metadata/is-metadata-route");
const _getmetadataroute = require("../../../lib/metadata/get-metadata-route");
const _path = /*#__PURE__*/ _interop_require_default(require("../../../shared/lib/isomorphic/path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class DevAppRouteRouteMatcherProvider extends _filecacheroutematcherprovider.FileCacheRouteMatcherProvider {
    constructor(appDir, extensions, reader, isTurbopack){
        super(appDir, reader);
        this.appDir = appDir;
        this.isTurbopack = isTurbopack;
        this.normalizers = new _app.DevAppNormalizers(appDir, extensions, isTurbopack);
    }
    async transform(files) {
        const matchers = [];
        for (const filename of files){
            // Skip static metadata files as they are served from filesystem.
            if ((0, _ismetadataroute.isStaticMetadataFile)(filename.replace(this.appDir, ''))) {
                continue;
            }
            let page = this.normalizers.page.normalize(filename);
            // If the file isn't a match for this matcher, then skip it.
            if (!(0, _isapprouteroute.isAppRouteRoute)(page)) continue;
            // Validate that this is not an ignored page.
            if (page.includes('/_')) continue;
            // Turbopack uses the correct page name with the underscore normalized.
            // TODO: Move implementation to packages/next/src/server/normalizers/built/app/app-page-normalizer.ts.
            // The `includes('/_')` check above needs to be moved for that to work as otherwise `%5Fsegmentname`
            // will result in `_segmentname` which hits that includes check and be skipped.
            if (this.isTurbopack) {
                page = page.replace(/%5F/g, '_');
            }
            const pathname = this.normalizers.pathname.normalize(filename);
            const bundlePath = this.normalizers.bundlePath.normalize(filename);
            const ext = _path.default.extname(filename).slice(1);
            const isEntryMetadataRouteFile = (0, _ismetadataroute.isMetadataRouteFile)(filename.replace(this.appDir, ''), [
                ext
            ], true);
            if (isEntryMetadataRouteFile && !(0, _ismetadataroute.isStaticMetadataRoute)(page)) {
                // Matching dynamic metadata routes.
                // Add 2 possibilities for both single and multiple routes:
                {
                    // single:
                    // /sitemap.ts -> /sitemap.xml/route
                    // /icon.ts -> /icon/route
                    // We'll map the filename before normalization:
                    // sitemap.ts -> sitemap.xml/route.ts
                    // icon.ts -> icon/route.ts
                    const metadataPage = (0, _getmetadataroute.normalizeMetadataPageToRoute)(page, false);
                    const metadataPathname = (0, _getmetadataroute.normalizeMetadataPageToRoute)(pathname, false);
                    const metadataBundlePath = (0, _getmetadataroute.normalizeMetadataPageToRoute)(bundlePath, false);
                    const matcher = new _approuteroutematcher.AppRouteRouteMatcher({
                        kind: _routekind.RouteKind.APP_ROUTE,
                        page: metadataPage,
                        pathname: metadataPathname,
                        bundlePath: metadataBundlePath,
                        filename
                    });
                    matchers.push(matcher);
                }
                {
                    // multiple:
                    // /sitemap.ts -> /sitemap/[__metadata_id__]/route
                    // /icon.ts -> /icon/[__metadata_id__]/route
                    // We'll map the filename before normalization:
                    // sitemap.ts -> sitemap.xml/[__metadata_id__].ts
                    // icon.ts -> icon/[__metadata_id__].ts
                    const metadataPage = (0, _getmetadataroute.normalizeMetadataPageToRoute)(page, true);
                    const metadataPathname = (0, _getmetadataroute.normalizeMetadataPageToRoute)(pathname, true);
                    const metadataBundlePath = (0, _getmetadataroute.normalizeMetadataPageToRoute)(bundlePath, true);
                    const matcher = new _approuteroutematcher.AppRouteRouteMatcher({
                        kind: _routekind.RouteKind.APP_ROUTE,
                        page: metadataPage,
                        pathname: metadataPathname,
                        bundlePath: metadataBundlePath,
                        filename
                    });
                    matchers.push(matcher);
                }
            } else {
                // Normal app routes.
                matchers.push(new _approuteroutematcher.AppRouteRouteMatcher({
                    kind: _routekind.RouteKind.APP_ROUTE,
                    page,
                    pathname,
                    bundlePath,
                    filename
                }));
            }
        }
        return matchers;
    }
}

//# sourceMappingURL=dev-app-route-route-matcher-provider.js.map