"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DevAppPageRouteMatcherProvider", {
    enumerable: true,
    get: function() {
        return DevAppPageRouteMatcherProvider;
    }
});
const _apppageroutematcher = require("../../route-matchers/app-page-route-matcher");
const _routekind = require("../../route-kind");
const _filecacheroutematcherprovider = require("./file-cache-route-matcher-provider");
const _app = require("../../normalizers/built/app");
const _normalizecatchallroutes = require("../../../build/normalize-catchall-routes");
const _apppaths = require("../../../shared/lib/router/utils/app-paths");
class DevAppPageRouteMatcherProvider extends _filecacheroutematcherprovider.FileCacheRouteMatcherProvider {
    constructor(appDir, extensions, reader, isTurbopack){
        super(appDir, reader);
        this.normalizers = new _app.DevAppNormalizers(appDir, extensions, isTurbopack);
        // Match any page file that ends with `/page.${extension}` or `/default.${extension}` under the app
        // directory.
        this.expression = new RegExp(`[/\\\\](page|default)\\.(?:${extensions.join('|')})$`);
        this.isTurbopack = isTurbopack;
    }
    async transform(files) {
        // Collect all the app paths for each page. This could include any parallel
        // routes.
        const cache = new Map();
        const routeFilenames = new Array();
        let appPaths = {};
        for (const filename of files){
            // If the file isn't a match for this matcher, then skip it.
            if (!this.expression.test(filename)) continue;
            let page = this.normalizers.page.normalize(filename);
            // Validate that this is not an ignored page.
            if (page.includes('/_')) continue;
            // Turbopack uses the correct page name with the underscore normalized.
            // TODO: Move implementation to packages/next/src/server/normalizers/built/app/app-page-normalizer.ts.
            // The `includes('/_')` check above needs to be moved for that to work as otherwise `%5Fsegmentname`
            // will result in `_segmentname` which hits that includes check and be skipped.
            if (this.isTurbopack) {
                page = page.replace(/%5F/g, '_');
            }
            // This is a valid file that we want to create a matcher for.
            routeFilenames.push(filename);
            const pathname = this.normalizers.pathname.normalize(filename);
            const bundlePath = this.normalizers.bundlePath.normalize(filename);
            // Save the normalization results.
            cache.set(filename, {
                page,
                pathname,
                bundlePath
            });
            if (pathname in appPaths) appPaths[pathname].push(page);
            else appPaths[pathname] = [
                page
            ];
        }
        (0, _normalizecatchallroutes.normalizeCatchAllRoutes)(appPaths);
        // Make sure to sort parallel routes to make the result deterministic.
        appPaths = Object.fromEntries(Object.entries(appPaths).map(([k, v])=>[
                k,
                v.sort(_apppaths.compareAppPaths)
            ]));
        const matchers = [];
        for (const filename of routeFilenames){
            // Grab the cached values (and the appPaths).
            const cached = cache.get(filename);
            if (!cached) {
                throw Object.defineProperty(new Error('Invariant: expected filename to exist in cache'), "__NEXT_ERROR_CODE", {
                    value: "E190",
                    enumerable: false,
                    configurable: true
                });
            }
            const { pathname, page, bundlePath } = cached;
            matchers.push(new _apppageroutematcher.AppPageRouteMatcher({
                kind: _routekind.RouteKind.APP_PAGE,
                pathname,
                page,
                bundlePath,
                filename,
                appPaths: appPaths[pathname]
            }));
        }
        return matchers;
    }
}

//# sourceMappingURL=dev-app-page-route-matcher-provider.js.map