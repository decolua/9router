"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TurbopackManifestLoader", {
    enumerable: true,
    get: function() {
        return TurbopackManifestLoader;
    }
});
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _constants = require("../constants");
const _path = require("path");
const _fs = require("fs");
const _requirecache = require("../../../server/dev/require-cache");
const _writeatomic = require("../../../lib/fs/write-atomic");
const _getassetpathfromroute = /*#__PURE__*/ _interop_require_default._(require("../router/utils/get-asset-path-from-route"));
const _entrykey = require("./entry-key");
const _utils = require("../router/utils");
const _turbopackutils = require("../../../server/dev/turbopack-utils");
const _trytoparsepath = require("../../../lib/try-to-parse-path");
const _routematchutils = require("../router/utils/route-match-utils");
const _buildmanifestpluginutils = require("../../../build/webpack/plugins/build-manifest-plugin-utils");
const getManifestPath = (page, distDir, name, type, firstCall)=>{
    let manifestPath = _path.posix.join(distDir, `server`, type, type === 'middleware' || type === 'instrumentation' ? '' : type === 'app' ? page : (0, _getassetpathfromroute.default)(page), name);
    if (firstCall) {
        const isSitemapRoute = /[\\/]sitemap(.xml)?\/route$/.test(page);
        // Check the ambiguity of /sitemap and /sitemap.xml
        if (isSitemapRoute && !(0, _fs.existsSync)(manifestPath)) {
            manifestPath = getManifestPath(page.replace(/\/sitemap\/route$/, '/sitemap.xml/route'), distDir, name, type, false);
        }
        // existsSync is faster than using the async version
        if (!(0, _fs.existsSync)(manifestPath) && page.endsWith('/route')) {
            // TODO: Improve implementation of metadata routes, currently it requires this extra check for the variants of the files that can be written.
            let basePage = (0, _turbopackutils.removeRouteSuffix)(page);
            // For sitemap.xml routes with generateSitemaps, the manifest is at
            // /sitemap/[__metadata_id__]/route (without .xml), because the route
            // handler serves at /sitemap/[id] not /sitemap.xml/[id]
            if (basePage.endsWith('/sitemap.xml')) {
                basePage = basePage.slice(0, -'.xml'.length);
            }
            let metadataPage = (0, _turbopackutils.addRouteSuffix)((0, _turbopackutils.addMetadataIdToRoute)(basePage));
            manifestPath = getManifestPath(metadataPage, distDir, name, type, false);
        }
    }
    return manifestPath;
};
function readPartialManifestContent(distDir, name, pageName, type = 'pages') {
    const page = pageName;
    const manifestPath = getManifestPath(page, distDir, name, type, true);
    return (0, _fs.readFileSync)(_path.posix.join(manifestPath), 'utf-8');
}
/// Helper class that stores a map of manifests and tracks if they have changed
/// since the last time they were written to disk. This is used to avoid
/// unnecessary writes to disk.
class ManifestsMap {
    set(key, value) {
        if (this.rawMap.get(key) === value) return;
        this.changed = true;
        this.rawMap.set(key, value);
        this.map.set(key, JSON.parse(value));
    }
    delete(key) {
        if (this.map.has(key)) {
            this.changed = true;
            this.rawMap.delete(key);
            this.map.delete(key);
        }
    }
    get(key) {
        return this.map.get(key);
    }
    takeChanged(extraInvalidationKey) {
        let changed = this.changed;
        if (extraInvalidationKey !== undefined) {
            const stringified = JSON.stringify(extraInvalidationKey);
            if (this.extraInvalidationKey !== stringified) {
                this.extraInvalidationKey = stringified;
                changed = true;
            }
        }
        this.changed = false;
        return changed;
    }
    values() {
        return this.map.values();
    }
    constructor(){
        this.rawMap = new Map();
        this.map = new Map();
        this.extraInvalidationKey = undefined;
        this.changed = true;
    }
}
class TurbopackManifestLoader {
    constructor({ distDir, buildId, encryptionKey, dev, sriEnabled }){
        this.actionManifests = new ManifestsMap();
        this.appPathsManifests = new ManifestsMap();
        this.buildManifests = new ManifestsMap();
        this.clientBuildManifests = new ManifestsMap();
        this.fontManifests = new ManifestsMap();
        this.middlewareManifests = new ManifestsMap();
        this.pagesManifests = new ManifestsMap();
        this.sriManifests = new ManifestsMap();
        /// interceptionRewrites that have been written to disk
        /// This is used to avoid unnecessary writes if the rewrites haven't changed
        this.cachedInterceptionRewrites = undefined;
        this.pendingCacheDeletes = [];
        this.distDir = distDir;
        this.buildId = buildId;
        this.encryptionKey = encryptionKey;
        this.dev = dev;
        this.sriEnabled = sriEnabled;
    }
    delete(key) {
        this.actionManifests.delete(key);
        this.appPathsManifests.delete(key);
        this.buildManifests.delete(key);
        this.clientBuildManifests.delete(key);
        this.fontManifests.delete(key);
        this.middlewareManifests.delete(key);
        this.pagesManifests.delete(key);
    }
    loadActionManifest(pageName) {
        this.actionManifests.set((0, _entrykey.getEntryKey)('app', 'server', pageName), readPartialManifestContent(this.distDir, `${_constants.SERVER_REFERENCE_MANIFEST}.json`, pageName, 'app'));
    }
    mergeActionManifests(manifests) {
        const manifest = {
            node: {},
            edge: {},
            encryptionKey: this.encryptionKey
        };
        function mergeActionIds(actionEntries, other) {
            for(const key in other){
                const action = actionEntries[key] ??= {
                    workers: {}
                };
                action.filename = other[key].filename;
                action.exportedName = other[key].exportedName;
                Object.assign(action.workers, other[key].workers);
            }
        }
        for (const m of manifests){
            mergeActionIds(manifest.node, m.node);
            mergeActionIds(manifest.edge, m.edge);
        }
        for(const key in manifest.node){
            const entry = manifest.node[key];
            entry.workers = sortObjectByKey(entry.workers);
        }
        for(const key in manifest.edge){
            const entry = manifest.edge[key];
            entry.workers = sortObjectByKey(entry.workers);
        }
        return manifest;
    }
    writeActionManifest() {
        if (!this.actionManifests.takeChanged()) {
            return;
        }
        const actionManifest = this.mergeActionManifests(this.actionManifests.values());
        const actionManifestJsonPath = (0, _path.join)(this.distDir, 'server', `${_constants.SERVER_REFERENCE_MANIFEST}.json`);
        const actionManifestJsPath = (0, _path.join)(this.distDir, 'server', `${_constants.SERVER_REFERENCE_MANIFEST}.js`);
        const json = JSON.stringify(actionManifest, null, 2);
        this.pendingCacheDeletes.push(actionManifestJsonPath);
        this.pendingCacheDeletes.push(actionManifestJsPath);
        (0, _writeatomic.writeFileAtomic)(actionManifestJsonPath, json);
        (0, _writeatomic.writeFileAtomic)(actionManifestJsPath, `self.__RSC_SERVER_MANIFEST=${JSON.stringify(json)}`);
    }
    loadAppPathsManifest(pageName) {
        this.appPathsManifests.set((0, _entrykey.getEntryKey)('app', 'server', pageName), readPartialManifestContent(this.distDir, _constants.APP_PATHS_MANIFEST, pageName, 'app'));
    }
    writeAppPathsManifest() {
        if (!this.appPathsManifests.takeChanged()) {
            return;
        }
        const appPathsManifest = this.mergePagesManifests(this.appPathsManifests.values());
        const appPathsManifestPath = (0, _path.join)(this.distDir, 'server', _constants.APP_PATHS_MANIFEST);
        this.pendingCacheDeletes.push(appPathsManifestPath);
        (0, _writeatomic.writeFileAtomic)(appPathsManifestPath, JSON.stringify(appPathsManifest, null, 2));
    }
    writeSriManifest() {
        if (!this.sriEnabled || !this.sriManifests.takeChanged()) {
            return;
        }
        const sriManifest = this.mergeSriManifests(this.sriManifests.values());
        const pathJson = (0, _path.join)(this.distDir, 'server', `${_constants.SUBRESOURCE_INTEGRITY_MANIFEST}.json`);
        const pathJs = (0, _path.join)(this.distDir, 'server', `${_constants.SUBRESOURCE_INTEGRITY_MANIFEST}.js`);
        this.pendingCacheDeletes.push(pathJson);
        this.pendingCacheDeletes.push(pathJs);
        (0, _writeatomic.writeFileAtomic)(pathJson, JSON.stringify(sriManifest, null, 2));
        (0, _writeatomic.writeFileAtomic)(pathJs, `self.__SUBRESOURCE_INTEGRITY_MANIFEST=${JSON.stringify(JSON.stringify(sriManifest))}`);
    }
    loadBuildManifest(pageName, type = 'pages') {
        this.buildManifests.set((0, _entrykey.getEntryKey)(type, 'server', pageName), readPartialManifestContent(this.distDir, _constants.BUILD_MANIFEST, pageName, type));
    }
    loadClientBuildManifest(pageName, type = 'pages') {
        this.clientBuildManifests.set((0, _entrykey.getEntryKey)(type, 'server', pageName), readPartialManifestContent(this.distDir, _constants.TURBOPACK_CLIENT_BUILD_MANIFEST, pageName, type));
    }
    loadSriManifest(pageName, type = 'pages') {
        if (!this.sriEnabled) return;
        this.sriManifests.set((0, _entrykey.getEntryKey)(type, 'client', pageName), readPartialManifestContent(this.distDir, `${_constants.SUBRESOURCE_INTEGRITY_MANIFEST}.json`, pageName, type));
    }
    mergeBuildManifests(manifests, lowPriorityFiles) {
        const manifest = {
            pages: {
                '/_app': []
            },
            // Something in next.js depends on these to exist even for app dir rendering
            devFiles: [],
            polyfillFiles: [],
            lowPriorityFiles,
            rootMainFiles: []
        };
        for (const m of manifests){
            Object.assign(manifest.pages, m.pages);
            if (m.rootMainFiles.length) manifest.rootMainFiles = m.rootMainFiles;
            // polyfillFiles should always be the same, so we can overwrite instead of actually merging
            if (m.polyfillFiles.length) manifest.polyfillFiles = m.polyfillFiles;
        }
        manifest.pages = sortObjectByKey(manifest.pages);
        return manifest;
    }
    mergeClientBuildManifests(manifests, rewrites, sortedPageKeys) {
        const manifest = {
            __rewrites: rewrites,
            sortedPages: sortedPageKeys
        };
        for (const m of manifests){
            Object.assign(manifest, m);
        }
        return sortObjectByKey(manifest);
    }
    writeInterceptionRouteRewriteManifest(devRewrites, productionRewrites) {
        const rewrites = productionRewrites ?? {
            ...devRewrites,
            beforeFiles: (devRewrites?.beforeFiles ?? []).map(_buildmanifestpluginutils.processRoute),
            afterFiles: (devRewrites?.afterFiles ?? []).map(_buildmanifestpluginutils.processRoute),
            fallback: (devRewrites?.fallback ?? []).map(_buildmanifestpluginutils.processRoute)
        };
        const interceptionRewrites = JSON.stringify(rewrites.beforeFiles.filter(require('../../../lib/is-interception-route-rewrite').isInterceptionRouteRewrite));
        if (this.cachedInterceptionRewrites === interceptionRewrites) {
            return;
        }
        this.cachedInterceptionRewrites = interceptionRewrites;
        const interceptionRewriteManifestPath = (0, _path.join)(this.distDir, 'server', `${_constants.INTERCEPTION_ROUTE_REWRITE_MANIFEST}.js`);
        this.pendingCacheDeletes.push(interceptionRewriteManifestPath);
        (0, _writeatomic.writeFileAtomic)(interceptionRewriteManifestPath, `self.__INTERCEPTION_ROUTE_REWRITE_MANIFEST=${JSON.stringify(interceptionRewrites)};`);
    }
    writeBuildManifest(lowPriorityFiles) {
        if (!this.buildManifests.takeChanged()) {
            return;
        }
        const buildManifest = this.mergeBuildManifests(this.buildManifests.values(), lowPriorityFiles);
        const buildManifestPath = (0, _path.join)(this.distDir, _constants.BUILD_MANIFEST);
        const middlewareBuildManifestPath = (0, _path.join)(this.distDir, 'server', `${_constants.MIDDLEWARE_BUILD_MANIFEST}.js`);
        this.pendingCacheDeletes.push(buildManifestPath);
        this.pendingCacheDeletes.push(middlewareBuildManifestPath);
        (0, _writeatomic.writeFileAtomic)(buildManifestPath, JSON.stringify(buildManifest, null, 2));
        (0, _writeatomic.writeFileAtomic)(middlewareBuildManifestPath, (0, _buildmanifestpluginutils.createEdgeRuntimeManifest)(buildManifest));
        // Write fallback build manifest
        const fallbackBuildManifest = this.mergeBuildManifests([
            this.buildManifests.get((0, _entrykey.getEntryKey)('pages', 'server', '_app')),
            this.buildManifests.get((0, _entrykey.getEntryKey)('pages', 'server', '_error'))
        ].filter(Boolean), lowPriorityFiles);
        const fallbackBuildManifestPath = (0, _path.join)(this.distDir, `fallback-${_constants.BUILD_MANIFEST}`);
        this.pendingCacheDeletes.push(fallbackBuildManifestPath);
        (0, _writeatomic.writeFileAtomic)(fallbackBuildManifestPath, JSON.stringify(fallbackBuildManifest, null, 2));
    }
    writeClientBuildManifest(entrypoints, devRewrites, productionRewrites) {
        const rewrites = (0, _buildmanifestpluginutils.normalizeRewritesForBuildManifest)(productionRewrites ?? {
            ...devRewrites,
            beforeFiles: (devRewrites?.beforeFiles ?? []).map(_buildmanifestpluginutils.processRoute),
            afterFiles: (devRewrites?.afterFiles ?? []).map(_buildmanifestpluginutils.processRoute),
            fallback: (devRewrites?.fallback ?? []).map(_buildmanifestpluginutils.processRoute)
        });
        const pagesKeys = [
            ...entrypoints.page.keys()
        ];
        if (entrypoints.global.app) {
            pagesKeys.push('/_app');
        }
        if (entrypoints.global.error) {
            pagesKeys.push('/_error');
        }
        const sortedPageKeys = (0, _utils.getSortedRoutes)(pagesKeys);
        let buildManifestPath = _path.posix.join(_constants.CLIENT_STATIC_FILES_PATH, this.buildId, '_buildManifest.js');
        let ssgManifestPath = _path.posix.join(_constants.CLIENT_STATIC_FILES_PATH, this.buildId, '_ssgManifest.js');
        if (this.dev && !this.clientBuildManifests.takeChanged({
            rewrites,
            sortedPageKeys
        })) {
            return [
                buildManifestPath,
                ssgManifestPath
            ];
        }
        const clientBuildManifest = this.mergeClientBuildManifests(this.clientBuildManifests.values(), rewrites, sortedPageKeys);
        const clientBuildManifestJs = `self.__BUILD_MANIFEST = ${JSON.stringify(clientBuildManifest, null, 2)};self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()`;
        (0, _writeatomic.writeFileAtomic)((0, _path.join)(this.distDir, buildManifestPath), clientBuildManifestJs);
        // This is just an empty placeholder, the actual manifest is written after prerendering in
        // packages/next/src/build/index.ts
        (0, _writeatomic.writeFileAtomic)((0, _path.join)(this.distDir, ssgManifestPath), _buildmanifestpluginutils.srcEmptySsgManifest);
        return [
            buildManifestPath,
            ssgManifestPath
        ];
    }
    loadFontManifest(pageName, type = 'pages') {
        this.fontManifests.set((0, _entrykey.getEntryKey)(type, 'server', pageName), readPartialManifestContent(this.distDir, `${_constants.NEXT_FONT_MANIFEST}.json`, pageName, type));
    }
    mergeFontManifests(manifests) {
        const manifest = {
            app: {},
            appUsingSizeAdjust: false,
            pages: {},
            pagesUsingSizeAdjust: false
        };
        for (const m of manifests){
            Object.assign(manifest.app, m.app);
            Object.assign(manifest.pages, m.pages);
            manifest.appUsingSizeAdjust = manifest.appUsingSizeAdjust || m.appUsingSizeAdjust;
            manifest.pagesUsingSizeAdjust = manifest.pagesUsingSizeAdjust || m.pagesUsingSizeAdjust;
        }
        manifest.app = sortObjectByKey(manifest.app);
        manifest.pages = sortObjectByKey(manifest.pages);
        return manifest;
    }
    async writeNextFontManifest() {
        if (!this.fontManifests.takeChanged()) {
            return;
        }
        const fontManifest = this.mergeFontManifests(this.fontManifests.values());
        const json = JSON.stringify(fontManifest, null, 2);
        const fontManifestJsonPath = (0, _path.join)(this.distDir, 'server', `${_constants.NEXT_FONT_MANIFEST}.json`);
        const fontManifestJsPath = (0, _path.join)(this.distDir, 'server', `${_constants.NEXT_FONT_MANIFEST}.js`);
        this.pendingCacheDeletes.push(fontManifestJsonPath);
        this.pendingCacheDeletes.push(fontManifestJsPath);
        (0, _writeatomic.writeFileAtomic)(fontManifestJsonPath, json);
        (0, _writeatomic.writeFileAtomic)(fontManifestJsPath, `self.__NEXT_FONT_MANIFEST=${JSON.stringify(json)}`);
    }
    /**
   * @returns If the manifest was written or not
   */ loadMiddlewareManifest(pageName, type) {
        const middlewareManifestPath = getManifestPath(pageName, this.distDir, _constants.MIDDLEWARE_MANIFEST, type, true);
        // middlewareManifest is actually "edge manifest" and not all routes are edge runtime. If it is not written we skip it.
        if (!(0, _fs.existsSync)(middlewareManifestPath)) {
            return false;
        }
        this.middlewareManifests.set((0, _entrykey.getEntryKey)(type === 'middleware' || type === 'instrumentation' ? 'root' : type, 'server', pageName), readPartialManifestContent(this.distDir, _constants.MIDDLEWARE_MANIFEST, pageName, type));
        return true;
    }
    getMiddlewareManifest(key) {
        return this.middlewareManifests.get(key);
    }
    deleteMiddlewareManifest(key) {
        return this.middlewareManifests.delete(key);
    }
    mergeMiddlewareManifests(manifests) {
        const manifest = {
            version: 3,
            middleware: {},
            sortedMiddleware: [],
            functions: {}
        };
        let instrumentation = undefined;
        for (const m of manifests){
            Object.assign(manifest.functions, m.functions);
            Object.assign(manifest.middleware, m.middleware);
            if (m.instrumentation) {
                instrumentation = m.instrumentation;
            }
        }
        manifest.functions = sortObjectByKey(manifest.functions);
        manifest.middleware = sortObjectByKey(manifest.middleware);
        const updateFunctionDefinition = (fun)=>{
            return {
                ...fun,
                files: [
                    ...instrumentation?.files ?? [],
                    ...fun.files
                ]
            };
        };
        for (const key of Object.keys(manifest.middleware)){
            const value = manifest.middleware[key];
            manifest.middleware[key] = updateFunctionDefinition(value);
        }
        for (const key of Object.keys(manifest.functions)){
            const value = manifest.functions[key];
            manifest.functions[key] = updateFunctionDefinition(value);
        }
        for (const fun of Object.values(manifest.functions).concat(Object.values(manifest.middleware))){
            for (const matcher of fun.matchers){
                if (!matcher.regexp) {
                    matcher.regexp = (0, _routematchutils.safePathToRegexp)(matcher.originalSource, [], {
                        delimiter: '/',
                        sensitive: false,
                        strict: true
                    }).source.replaceAll('\\/', '/');
                }
            }
        }
        manifest.sortedMiddleware = Object.keys(manifest.middleware);
        return manifest;
    }
    writeMiddlewareManifest() {
        let clientMiddlewareManifestPath = _path.posix.join(_constants.CLIENT_STATIC_FILES_PATH, this.buildId, _constants.TURBOPACK_CLIENT_MIDDLEWARE_MANIFEST);
        if (this.dev && !this.middlewareManifests.takeChanged()) {
            return {
                clientMiddlewareManifestPath
            };
        }
        const middlewareManifest = this.mergeMiddlewareManifests(this.middlewareManifests.values());
        // Server middleware manifest
        // Normalize regexes as it uses path-to-regexp
        for(const key in middlewareManifest.middleware){
            middlewareManifest.middleware[key].matchers.forEach((matcher)=>{
                if (!matcher.regexp.startsWith('^')) {
                    const parsedPage = (0, _trytoparsepath.tryToParsePath)(matcher.regexp);
                    if (parsedPage.error || !parsedPage.regexStr) {
                        throw Object.defineProperty(new Error(`Invalid source: ${matcher.regexp}`), "__NEXT_ERROR_CODE", {
                            value: "E442",
                            enumerable: false,
                            configurable: true
                        });
                    }
                    matcher.regexp = parsedPage.regexStr;
                }
            });
        }
        const middlewareManifestPath = (0, _path.join)(this.distDir, 'server', _constants.MIDDLEWARE_MANIFEST);
        this.pendingCacheDeletes.push(middlewareManifestPath);
        (0, _writeatomic.writeFileAtomic)(middlewareManifestPath, JSON.stringify(middlewareManifest, null, 2));
        // Client middleware manifest This is only used in dev though, packages/next/src/build/index.ts
        // writes the mainfest again for builds.
        const matchers = middlewareManifest?.middleware['/']?.matchers || [];
        const clientMiddlewareManifestJs = `self.__MIDDLEWARE_MATCHERS = ${JSON.stringify(matchers, null, 2)};self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()`;
        this.pendingCacheDeletes.push(clientMiddlewareManifestPath);
        (0, _writeatomic.writeFileAtomic)((0, _path.join)(this.distDir, clientMiddlewareManifestPath), clientMiddlewareManifestJs);
        return {
            clientMiddlewareManifestPath
        };
    }
    loadPagesManifest(pageName) {
        this.pagesManifests.set((0, _entrykey.getEntryKey)('pages', 'server', pageName), readPartialManifestContent(this.distDir, _constants.PAGES_MANIFEST, pageName));
    }
    mergePagesManifests(manifests) {
        const manifest = {};
        for (const m of manifests){
            Object.assign(manifest, m);
        }
        return sortObjectByKey(manifest);
    }
    mergeSriManifests(manifests) {
        const manifest = {};
        for (const m of manifests){
            Object.assign(manifest, m);
        }
        return sortObjectByKey(manifest);
    }
    writePagesManifest() {
        if (!this.pagesManifests.takeChanged()) {
            return;
        }
        const pagesManifest = this.mergePagesManifests(this.pagesManifests.values());
        const pagesManifestPath = (0, _path.join)(this.distDir, 'server', _constants.PAGES_MANIFEST);
        this.pendingCacheDeletes.push(pagesManifestPath);
        (0, _writeatomic.writeFileAtomic)(pagesManifestPath, JSON.stringify(pagesManifest, null, 2));
    }
    writeManifests({ devRewrites, productionRewrites, entrypoints }) {
        this.writeActionManifest();
        this.writeAppPathsManifest();
        const lowPriorityFiles = this.writeClientBuildManifest(entrypoints, devRewrites, productionRewrites);
        const { clientMiddlewareManifestPath } = this.writeMiddlewareManifest();
        this.writeBuildManifest([
            ...lowPriorityFiles,
            clientMiddlewareManifestPath
        ]);
        this.writeInterceptionRouteRewriteManifest(devRewrites, productionRewrites);
        this.writeNextFontManifest();
        this.writePagesManifest();
        this.writeSriManifest();
        // Flush all queued cache deletions in a single require.cache scan
        if (this.pendingCacheDeletes.length > 0) {
            (0, _requirecache.deleteCache)(this.pendingCacheDeletes);
            this.pendingCacheDeletes = [];
        }
    }
}
function sortObjectByKey(obj) {
    return Object.keys(obj).sort().reduce((acc, key)=>{
        acc[key] = obj[key];
        return acc;
    }, {});
}

//# sourceMappingURL=manifest-loader.js.map