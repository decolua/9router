"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    collectAppFiles: null,
    collectPagesFiles: null,
    createPagesMapping: null,
    createRelativeFilePath: null,
    discoverRoutes: null,
    getPageFromPath: null,
    processAppRoutes: null,
    processLayoutRoutes: null,
    processPageRoutes: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    collectAppFiles: function() {
        return collectAppFiles;
    },
    collectPagesFiles: function() {
        return collectPagesFiles;
    },
    createPagesMapping: function() {
        return createPagesMapping;
    },
    createRelativeFilePath: function() {
        return createRelativeFilePath;
    },
    discoverRoutes: function() {
        return discoverRoutes;
    },
    getPageFromPath: function() {
        return getPageFromPath;
    },
    processAppRoutes: function() {
        return processAppRoutes;
    },
    processLayoutRoutes: function() {
        return processLayoutRoutes;
    },
    processPageRoutes: function() {
        return processPageRoutes;
    }
});
const _path = require("path");
const _findpagefile = require("../server/lib/find-page-file");
const _recursivereaddir = require("../lib/recursive-readdir");
const _constants = require("../lib/constants");
const _normalizepathsep = require("../shared/lib/page-path/normalize-path-sep");
const _apppaths = require("../shared/lib/router/utils/app-paths");
const _ensureleadingslash = require("../shared/lib/page-path/ensure-leading-slash");
const _pagetypes = require("../lib/page-types");
const _fileclassifier = require("./file-classifier");
const _getmetadataroute = require("../lib/metadata/get-metadata-route");
const _ismetadataroute = require("../lib/metadata/is-metadata-route");
const _getpagestaticinfo = require("./analysis/get-page-static-info");
const _entryconstants = require("../shared/lib/entry-constants");
const _utils = require("./utils");
const PRIVATE_PAGES_PREFIX_REGEX = /^private-next-pages\//;
const PRIVATE_APP_PREFIX_REGEX = /^private-next-app-dir\//;
const SKIP_ROUTES = new Set([
    _entryconstants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY,
    _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY
]);
function removeSuffix(value, suffix) {
    return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
/** Normalize a route for the app router */ function normalizeAppRoute(pageName) {
    return (0, _apppaths.normalizeAppPath)((0, _normalizepathsep.normalizePathSep)(pageName));
}
/** Normalize a layout route (strip /layout suffix) */ function normalizeLayoutRoute(pageName) {
    return (0, _ensureleadingslash.ensureLeadingSlash)(removeSuffix((0, _apppaths.normalizeAppPath)((0, _normalizepathsep.normalizePathSep)(pageName)), '/layout'));
}
function getPageFromPath(pagePath, pageExtensions) {
    let page = (0, _normalizepathsep.normalizePathSep)(pagePath);
    // Try longer extensions first so compound extensions like 'page.js'
    // match before shorter ones like 'js'
    const sorted = [
        ...pageExtensions
    ].sort((a, b)=>b.length - a.length);
    for (const extension of sorted){
        const next = removeSuffix(page, `.${extension}`);
        if (next !== page) {
            page = next;
            break;
        }
    }
    page = removeSuffix(page, '/index');
    return page === '' ? '/' : page;
}
async function collectAppFiles(appDir, validFileMatcher) {
    const allAppFiles = await (0, _recursivereaddir.recursiveReadDir)(appDir, {
        pathnameFilter: (absolutePath)=>validFileMatcher.isAppRouterPage(absolutePath) || validFileMatcher.isRootNotFound(absolutePath) || validFileMatcher.isAppLayoutPage(absolutePath) || validFileMatcher.isAppDefaultPage(absolutePath),
        ignorePartFilter: (part)=>part.startsWith('_')
    });
    const appPaths = allAppFiles.filter((absolutePath)=>validFileMatcher.isAppRouterPage(absolutePath) || validFileMatcher.isRootNotFound(absolutePath));
    const layoutPaths = allAppFiles.filter((absolutePath)=>validFileMatcher.isAppLayoutPage(absolutePath));
    const defaultPaths = allAppFiles.filter((absolutePath)=>validFileMatcher.isAppDefaultPage(absolutePath));
    return {
        appPaths,
        layoutPaths,
        defaultPaths
    };
}
async function collectPagesFiles(pagesDir, validFileMatcher) {
    return await (0, _recursivereaddir.recursiveReadDir)(pagesDir, {
        pathnameFilter: validFileMatcher.isPageFile
    });
}
function createRelativeFilePath(baseDir, filePath, prefix, isSrcDir) {
    const privatePrefixRegex = prefix === 'pages' ? PRIVATE_PAGES_PREFIX_REGEX : PRIVATE_APP_PREFIX_REGEX;
    const srcPrefix = isSrcDir ? 'src/' : '';
    return (0, _path.join)(baseDir, filePath.replace(privatePrefixRegex, `${srcPrefix}${prefix}/`));
}
function processPageRoutes(mappedPages, baseDir, isSrcDir) {
    const pageRoutes = [];
    const pageApiRoutes = [];
    for (const [route, filePath] of Object.entries(mappedPages)){
        const relativeFilePath = createRelativeFilePath(baseDir, filePath, 'pages', isSrcDir);
        if (route.startsWith('/api/')) {
            pageApiRoutes.push({
                route: (0, _normalizepathsep.normalizePathSep)(route),
                filePath: relativeFilePath
            });
        } else {
            if ((0, _utils.isReservedPage)(route)) continue;
            pageRoutes.push({
                route: (0, _normalizepathsep.normalizePathSep)(route),
                filePath: relativeFilePath
            });
        }
    }
    return {
        pageRoutes,
        pageApiRoutes
    };
}
function processAppRoutes(mappedAppPages, validFileMatcher, baseDir, isSrcDir) {
    const appRoutes = [];
    const appRouteHandlers = [];
    for (const [page, filePath] of Object.entries(mappedAppPages)){
        if (page === _entryconstants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY || page === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY) {
            continue;
        }
        const relativeFilePath = createRelativeFilePath(baseDir, filePath, 'app', isSrcDir);
        const route = normalizeAppRoute(page);
        if (validFileMatcher.isAppRouterRoute(filePath)) {
            appRouteHandlers.push({
                route,
                filePath: relativeFilePath
            });
        } else {
            appRoutes.push({
                route,
                filePath: relativeFilePath
            });
        }
    }
    return {
        appRoutes,
        appRouteHandlers
    };
}
function processLayoutRoutes(mappedAppLayouts, baseDir, isSrcDir) {
    return Object.entries(mappedAppLayouts).map(([route, filePath])=>({
            route: normalizeLayoutRoute(route),
            filePath: createRelativeFilePath(baseDir, filePath, 'app', isSrcDir)
        }));
}
async function createPagesMapping({ isDev, pageExtensions, pagePaths, pagesType, pagesDir, appDir, appDirOnly }) {
    const isAppRoute = pagesType === 'app';
    const promises = pagePaths.map(async (pagePath)=>{
        if (pagePath.endsWith('.d.ts') && pageExtensions.includes('ts')) {
            return;
        }
        let pageKey = getPageFromPath(pagePath, pageExtensions);
        if (isAppRoute) {
            // Turbopack encodes '_' as '%5F' in app paths; normalize to underscores.
            pageKey = pageKey.replace(/%5F/g, '_');
            if (pageKey === _entryconstants.UNDERSCORE_NOT_FOUND_ROUTE) {
                pageKey = _entryconstants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY;
            }
            if (pageKey === _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE) {
                pageKey = _entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY;
            }
        }
        const normalizedPath = (0, _normalizepathsep.normalizePathSep)((0, _path.join)(pagesType === _pagetypes.PAGE_TYPES.PAGES ? _constants.PAGES_DIR_ALIAS : pagesType === _pagetypes.PAGE_TYPES.APP ? _constants.APP_DIR_ALIAS : _constants.ROOT_DIR_ALIAS, pagePath));
        let route = pagesType === _pagetypes.PAGE_TYPES.APP ? (0, _getmetadataroute.normalizeMetadataRoute)(pageKey) : pageKey;
        if (pagesType === _pagetypes.PAGE_TYPES.APP && (0, _ismetadataroute.isMetadataRouteFile)(pagePath, pageExtensions, true)) {
            const filePath = (0, _path.join)(appDir, pagePath);
            const staticInfo = await (0, _getpagestaticinfo.getPageStaticInfo)({
                nextConfig: {},
                pageFilePath: filePath,
                isDev,
                page: pageKey,
                pageType: pagesType
            });
            route = (0, _getmetadataroute.normalizeMetadataPageToRoute)(route, !!(staticInfo.generateImageMetadata || staticInfo.generateSitemaps));
        }
        return [
            route,
            normalizedPath
        ];
    });
    const pages = Object.fromEntries((await Promise.all(promises)).filter((entry)=>entry != null));
    switch(pagesType){
        case _pagetypes.PAGE_TYPES.ROOT:
            {
                return pages;
            }
        case _pagetypes.PAGE_TYPES.APP:
            {
                const hasAppPages = Object.keys(pages).length > 0;
                const hasAppGlobalError = !isDev && appDirOnly;
                return {
                    ...hasAppPages && {
                        [_entryconstants.UNDERSCORE_NOT_FOUND_ROUTE_ENTRY]: require.resolve('next/dist/client/components/builtin/global-not-found')
                    },
                    ...hasAppGlobalError && {
                        [_entryconstants.UNDERSCORE_GLOBAL_ERROR_ROUTE_ENTRY]: require.resolve('next/dist/client/components/builtin/app-error')
                    },
                    ...pages
                };
            }
        case _pagetypes.PAGE_TYPES.PAGES:
            {
                if (isDev) {
                    delete pages['/_app'];
                    delete pages['/_error'];
                    delete pages['/_document'];
                }
                const root = isDev && pagesDir ? _constants.PAGES_DIR_ALIAS : 'next/dist/pages';
                if (Object.keys(pages).length === 0 && !appDirOnly) {
                    appDirOnly = true;
                }
                return {
                    ...(isDev || !appDirOnly) && {
                        '/_app': `${root}/_app`,
                        '/_error': `${root}/_error`,
                        '/_document': `${root}/_document`,
                        ...pages
                    }
                };
            }
        default:
            {
                return {};
            }
    }
}
async function discoverRoutes(options) {
    const { appDir, pagesDir, pageExtensions, isDev, baseDir, isSrcDir, debugBuildPaths } = options;
    const validFileMatcher = options.validFileMatcher || (0, _findpagefile.createValidFileMatcher)(pageExtensions, appDir);
    let appDirOnly = options.appDirOnly ?? (!!appDir && !pagesDir);
    // Helper to reduce createPagesMapping boilerplate
    const mapPaths = (pagePaths, pagesType)=>createPagesMapping({
            pagePaths,
            isDev,
            pagesType,
            pageExtensions,
            pagesDir,
            appDir,
            appDirOnly
        });
    // Helper to apply debugBuildPaths filtering
    const applyDebugFilter = (paths, debugPaths)=>{
        if (debugPaths.length > 0) {
            const debugPathsSet = new Set(debugPaths);
            return paths.filter((p)=>debugPathsSet.has(p));
        }
        // Empty array means build none
        return [];
    };
    let pageRoutes = [];
    let pageApiRoutes = [];
    let mappedPages;
    let pagesPaths = [];
    if (pagesDir && !appDirOnly) {
        if (process.env.NEXT_PRIVATE_PAGE_PATHS) {
            pagesPaths = JSON.parse(process.env.NEXT_PRIVATE_PAGE_PATHS);
        } else {
            pagesPaths = await collectPagesFiles(pagesDir, validFileMatcher);
            if (debugBuildPaths) {
                pagesPaths = applyDebugFilter(pagesPaths, debugBuildPaths.pages);
            }
        }
        mappedPages = await mapPaths(pagesPaths, _pagetypes.PAGE_TYPES.PAGES);
        // Update appDirOnly if no user page routes were found, so the
        // subsequent app mapping can emit the global error entry.
        if (Object.keys(mappedPages).length === 0) {
            appDirOnly = true;
        }
        ;
        ({ pageRoutes, pageApiRoutes } = processPageRoutes(mappedPages, baseDir, !!isSrcDir));
    }
    let appRoutes = [];
    let appRouteHandlers = [];
    let layoutRoutes = [];
    let slots = [];
    let mappedAppPages;
    let mappedAppLayouts;
    if (appDir) {
        let appPaths;
        let layoutPaths;
        let defaultPaths;
        if (process.env.NEXT_PRIVATE_APP_PATHS) {
            // Used for testing — override collected app paths
            appPaths = JSON.parse(process.env.NEXT_PRIVATE_APP_PATHS);
            layoutPaths = [];
            defaultPaths = [];
        } else {
            const result = await collectAppFiles(appDir, validFileMatcher);
            appPaths = result.appPaths;
            layoutPaths = result.layoutPaths;
            defaultPaths = result.defaultPaths;
            if (debugBuildPaths) {
                appPaths = applyDebugFilter(appPaths, debugBuildPaths.app);
            }
        }
        // Map all app file types in parallel
        let mappedDefaultFiles;
        [mappedAppPages, mappedAppLayouts, mappedDefaultFiles] = await Promise.all([
            mapPaths(appPaths, _pagetypes.PAGE_TYPES.APP),
            mapPaths(layoutPaths, _pagetypes.PAGE_TYPES.APP),
            mapPaths(defaultPaths, _pagetypes.PAGE_TYPES.APP)
        ]);
        // Extract slots from pages and default files
        slots = (0, _fileclassifier.combineSlots)((0, _fileclassifier.extractSlotsFromRoutes)(mappedAppPages, SKIP_ROUTES), (0, _fileclassifier.extractSlotsFromRoutes)(mappedDefaultFiles));
        ({ appRoutes, appRouteHandlers } = processAppRoutes(mappedAppPages, validFileMatcher, baseDir, !!isSrcDir));
        layoutRoutes = processLayoutRoutes(mappedAppLayouts, baseDir, !!isSrcDir);
    }
    return {
        appRoutes,
        appRouteHandlers,
        layoutRoutes,
        slots,
        pageRoutes,
        pageApiRoutes,
        mappedAppPages,
        mappedAppLayouts,
        mappedPages,
        pagesPaths,
        appDirOnly
    };
}

//# sourceMappingURL=route-discovery.js.map