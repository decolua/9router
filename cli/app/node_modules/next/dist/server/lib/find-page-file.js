"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createValidFileMatcher: null,
    findPageFile: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createValidFileMatcher: function() {
        return createValidFileMatcher;
    },
    findPageFile: function() {
        return findPageFile;
    }
});
const _fileexists = require("../../lib/file-exists");
const _getpagepaths = require("../../shared/lib/page-path/get-page-paths");
const _nonnullable = require("../../lib/non-nullable");
const _path = require("path");
const _fs = require("fs");
const _log = require("../../build/output/log");
const _picocolors = require("../../lib/picocolors");
const _ismetadataroute = require("../../lib/metadata/is-metadata-route");
const _escaperegexp = require("../../shared/lib/escape-regexp");
async function isTrueCasePagePath(pagePath, pagesDir) {
    const pageSegments = (0, _path.normalize)(pagePath).split(_path.sep).filter(Boolean);
    const segmentExistsPromises = pageSegments.map(async (segment, i)=>{
        const segmentParentDir = (0, _path.join)(pagesDir, ...pageSegments.slice(0, i));
        const parentDirEntries = await _fs.promises.readdir(segmentParentDir);
        return parentDirEntries.includes(segment);
    });
    return (await Promise.all(segmentExistsPromises)).every(Boolean);
}
async function findPageFile(pagesDir, normalizedPagePath, pageExtensions, isAppDir) {
    const pagePaths = (0, _getpagepaths.getPagePaths)(normalizedPagePath, pageExtensions, isAppDir);
    const [existingPath, ...others] = (await Promise.all(pagePaths.map(async (path)=>{
        const filePath = (0, _path.join)(pagesDir, path);
        try {
            return await (0, _fileexists.fileExists)(filePath) ? path : null;
        } catch (err) {
            var _err_code;
            if (!(err == null ? void 0 : (_err_code = err.code) == null ? void 0 : _err_code.includes('ENOTDIR'))) throw err;
        }
        return null;
    }))).filter(_nonnullable.nonNullable);
    if (!existingPath) {
        return null;
    }
    if (!await isTrueCasePagePath(existingPath, pagesDir)) {
        return null;
    }
    if (others.length > 0) {
        (0, _log.warn)(`Duplicate page detected. ${(0, _picocolors.cyan)((0, _path.join)('pages', existingPath))} and ${(0, _picocolors.cyan)((0, _path.join)('pages', others[0]))} both resolve to ${(0, _picocolors.cyan)(normalizedPagePath)}.`);
    }
    return existingPath;
}
function createValidFileMatcher(pageExtensions, appDirPath) {
    // Helper to create extension regex pattern
    const extPattern = `(?:${pageExtensions.map((extension)=>(0, _escaperegexp.escapeStringRegexp)(extension)).join('|')})`;
    // Pattern factory for "leaf" files that can appear at start of path or after separator
    // e.g., 'page.tsx', '/path/page.tsx', '\\path\\route.js'
    const createLeafPattern = (fileNames)=>{
        const names = fileNames.length === 1 ? fileNames[0] : `(${fileNames.join('|')})`;
        return new RegExp(`(^${names}|[\\\\/]${names})\\.${extPattern}$`);
    };
    // Pattern factory for root-only files (no path separator allowed)
    const createRootOnlyPattern = (fileName)=>new RegExp(`^${fileName}\\.${extPattern}$`);
    // All file matching patterns
    const validExtensionFileRegex = new RegExp(`\\.${extPattern}$`);
    const leafOnlyPageFileRegex = createLeafPattern([
        'page',
        'route'
    ]);
    const leafOnlyRouteFileRegex = createLeafPattern([
        'route'
    ]);
    const leafOnlyLayoutFileRegex = createLeafPattern([
        'layout'
    ]);
    const leafOnlyDefaultFileRegex = createLeafPattern([
        'default'
    ]);
    const rootNotFoundFileRegex = createRootOnlyPattern('not-found');
    /** TODO-METADATA: support other metadata routes
   *  regex for:
   *
   * /robots.txt|<ext>
   * /sitemap.xml|<ext>
   * /favicon.ico
   * /manifest.json|<ext>
   * <route>/icon.png|jpg|<ext>
   * <route>/apple-touch-icon.png|jpg|<ext>
   *
   */ /**
   * Match the file if it's a metadata route file, static: if the file is a static metadata file.
   * It needs to be a file which doesn't match the custom metadata routes e.g. `app/robots.txt/route.js`
   */ function isMetadataFile(filePath) {
        const appDirRelativePath = appDirPath ? filePath.replace(appDirPath, '') : filePath;
        return (0, _ismetadataroute.isMetadataRouteFile)(appDirRelativePath, pageExtensions, true);
    }
    // Determine if the file is leaf node page file or route file under layouts,
    // 'page.<extension>' | 'route.<extension>'
    function isAppRouterPage(filePath) {
        return leafOnlyPageFileRegex.test(filePath) || isMetadataFile(filePath);
    }
    // Determine if the file is leaf node route file under app directory
    function isAppRouterRoute(filePath) {
        return leafOnlyRouteFileRegex.test(filePath);
    }
    function isAppLayoutPage(filePath) {
        return leafOnlyLayoutFileRegex.test(filePath);
    }
    function isAppDefaultPage(filePath) {
        return leafOnlyDefaultFileRegex.test(filePath);
    }
    function isPageFile(filePath) {
        return validExtensionFileRegex.test(filePath) || isMetadataFile(filePath);
    }
    function isRootNotFound(filePath) {
        if (!appDirPath) {
            return false;
        }
        if (!filePath.startsWith(appDirPath + _path.sep)) {
            return false;
        }
        const rest = filePath.slice(appDirPath.length + 1);
        return rootNotFoundFileRegex.test(rest);
    }
    return {
        isPageFile,
        isAppRouterPage,
        isAppRouterRoute,
        isAppLayoutPage,
        isAppDefaultPage,
        isMetadataFile,
        isRootNotFound
    };
}

//# sourceMappingURL=find-page-file.js.map