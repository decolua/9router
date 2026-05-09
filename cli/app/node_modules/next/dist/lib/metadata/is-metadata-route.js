"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DEFAULT_METADATA_ROUTE_EXTENSIONS: null,
    STATIC_METADATA_IMAGES: null,
    getExtensionRegexString: null,
    isMetadataPage: null,
    isMetadataRoute: null,
    isMetadataRouteFile: null,
    isStaticMetadataFile: null,
    isStaticMetadataRoute: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DEFAULT_METADATA_ROUTE_EXTENSIONS: function() {
        return DEFAULT_METADATA_ROUTE_EXTENSIONS;
    },
    STATIC_METADATA_IMAGES: function() {
        return STATIC_METADATA_IMAGES;
    },
    getExtensionRegexString: function() {
        return getExtensionRegexString;
    },
    isMetadataPage: function() {
        return isMetadataPage;
    },
    isMetadataRoute: function() {
        return isMetadataRoute;
    },
    isMetadataRouteFile: function() {
        return isMetadataRouteFile;
    },
    isStaticMetadataFile: function() {
        return isStaticMetadataFile;
    },
    isStaticMetadataRoute: function() {
        return isStaticMetadataRoute;
    }
});
const _normalizepathsep = require("../../shared/lib/page-path/normalize-path-sep");
const _apppaths = require("../../shared/lib/router/utils/app-paths");
const _isapprouteroute = require("../is-app-route-route");
const STATIC_METADATA_IMAGES = {
    icon: {
        filename: 'icon',
        extensions: [
            'ico',
            'jpg',
            'jpeg',
            'png',
            'svg'
        ]
    },
    apple: {
        filename: 'apple-icon',
        extensions: [
            'jpg',
            'jpeg',
            'png'
        ]
    },
    favicon: {
        filename: 'favicon',
        extensions: [
            'ico'
        ]
    },
    openGraph: {
        filename: 'opengraph-image',
        extensions: [
            'jpg',
            'jpeg',
            'png',
            'gif'
        ]
    },
    twitter: {
        filename: 'twitter-image',
        extensions: [
            'jpg',
            'jpeg',
            'png',
            'gif'
        ]
    }
};
const DEFAULT_METADATA_ROUTE_EXTENSIONS = [
    'js',
    'jsx',
    'ts',
    'tsx'
];
const getExtensionRegexString = (staticExtensions, dynamicExtensions)=>{
    let result;
    // If there's no possible multi dynamic routes, will not match any <name>[].<ext> files
    if (!dynamicExtensions || dynamicExtensions.length === 0) {
        result = `(\\.(?:${staticExtensions.join('|')}))`;
    } else {
        result = `(?:\\.(${staticExtensions.join('|')})|(\\.(${dynamicExtensions.join('|')})))`;
    }
    return result;
};
function isStaticMetadataFile(appDirRelativePath) {
    return isMetadataRouteFile(appDirRelativePath, [], true);
}
// Pre-compiled static regexes for common cases
const FAVICON_REGEX = /^[\\/]favicon\.ico$/;
const ROBOTS_TXT_REGEX = /^[\\/]robots\.txt$/;
const MANIFEST_JSON_REGEX = /^[\\/]manifest\.json$/;
const MANIFEST_WEBMANIFEST_REGEX = /^[\\/]manifest\.webmanifest$/;
const SITEMAP_XML_REGEX = /[\\/]sitemap\.xml$/;
// Cache for compiled regex patterns based on parameters
const compiledRegexCache = new Map();
// Fast path checks for common metadata files
function fastPathCheck(normalizedPath) {
    // Check favicon.ico first (most common)
    if (FAVICON_REGEX.test(normalizedPath)) return true;
    // Check other common static files
    if (ROBOTS_TXT_REGEX.test(normalizedPath)) return true;
    if (MANIFEST_JSON_REGEX.test(normalizedPath)) return true;
    if (MANIFEST_WEBMANIFEST_REGEX.test(normalizedPath)) return true;
    if (SITEMAP_XML_REGEX.test(normalizedPath)) return true;
    // Quick negative check - if it doesn't contain any metadata keywords, skip
    if (!normalizedPath.includes('robots') && !normalizedPath.includes('manifest') && !normalizedPath.includes('sitemap') && !normalizedPath.includes('icon') && !normalizedPath.includes('apple-icon') && !normalizedPath.includes('opengraph-image') && !normalizedPath.includes('twitter-image') && !normalizedPath.includes('favicon')) {
        return false;
    }
    return null // Continue with full regex matching
    ;
}
function getCompiledRegexes(pageExtensions, strictlyMatchExtensions) {
    // Create cache key
    const cacheKey = `${pageExtensions.join(',')}|${strictlyMatchExtensions}`;
    const cached = compiledRegexCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    // Pre-compute common strings
    const trailingMatcher = strictlyMatchExtensions ? '$' : '?$';
    const variantsMatcher = '\\d?';
    const groupSuffix = strictlyMatchExtensions ? '' : '(-\\w{6})?';
    const suffixMatcher = variantsMatcher + groupSuffix;
    // Pre-compute extension arrays to avoid repeated concatenation
    const robotsExts = pageExtensions.length > 0 ? [
        ...pageExtensions,
        'txt'
    ] : [
        'txt'
    ];
    const manifestExts = pageExtensions.length > 0 ? [
        ...pageExtensions,
        'webmanifest',
        'json'
    ] : [
        'webmanifest',
        'json'
    ];
    const regexes = [
        new RegExp(`^[\\\\/]robots${getExtensionRegexString(robotsExts, null)}${trailingMatcher}`),
        new RegExp(`^[\\\\/]manifest${getExtensionRegexString(manifestExts, null)}${trailingMatcher}`),
        // FAVICON_REGEX removed - already handled in fastPathCheck
        new RegExp(`[\\\\/]sitemap${getExtensionRegexString([
            'xml'
        ], pageExtensions)}${trailingMatcher}`),
        new RegExp(`[\\\\/]icon${suffixMatcher}${getExtensionRegexString(STATIC_METADATA_IMAGES.icon.extensions, pageExtensions)}${trailingMatcher}`),
        new RegExp(`[\\\\/]apple-icon${suffixMatcher}${getExtensionRegexString(STATIC_METADATA_IMAGES.apple.extensions, pageExtensions)}${trailingMatcher}`),
        new RegExp(`[\\\\/]opengraph-image${suffixMatcher}${getExtensionRegexString(STATIC_METADATA_IMAGES.openGraph.extensions, pageExtensions)}${trailingMatcher}`),
        new RegExp(`[\\\\/]twitter-image${suffixMatcher}${getExtensionRegexString(STATIC_METADATA_IMAGES.twitter.extensions, pageExtensions)}${trailingMatcher}`)
    ];
    compiledRegexCache.set(cacheKey, regexes);
    return regexes;
}
function isMetadataRouteFile(appDirRelativePath, pageExtensions, strictlyMatchExtensions) {
    // Early exit for empty or obviously non-metadata paths
    if (!appDirRelativePath || appDirRelativePath.length < 2) {
        return false;
    }
    const normalizedPath = (0, _normalizepathsep.normalizePathSep)(appDirRelativePath);
    // Fast path check for common cases
    const fastResult = fastPathCheck(normalizedPath);
    if (fastResult !== null) {
        return fastResult;
    }
    // Get compiled regexes from cache
    const regexes = getCompiledRegexes(pageExtensions, strictlyMatchExtensions);
    // Use for loop instead of .some() for better performance
    for(let i = 0; i < regexes.length; i++){
        if (regexes[i].test(normalizedPath)) {
            return true;
        }
    }
    return false;
}
function isStaticMetadataRoute(route) {
    // extract ext with regex
    const pathname = route.replace(/\/route$/, '');
    const matched = (0, _isapprouteroute.isAppRouteRoute)(route) && isMetadataRouteFile(pathname, [], true) && // These routes can either be built by static or dynamic entrypoints,
    // so we assume they're dynamic
    pathname !== '/robots.txt' && pathname !== '/manifest.webmanifest' && !pathname.endsWith('/sitemap.xml');
    return matched;
}
function isMetadataPage(page) {
    const matched = !(0, _isapprouteroute.isAppRouteRoute)(page) && isMetadataRouteFile(page, [], false);
    return matched;
}
function isMetadataRoute(route) {
    let page = (0, _apppaths.normalizeAppPath)(route).replace(/^\/?app\//, '')// Remove the dynamic route id
    .replace('/[__metadata_id__]', '')// Remove the /route suffix
    .replace(/\/route$/, '');
    if (page[0] !== '/') page = '/' + page;
    const matched = (0, _isapprouteroute.isAppRouteRoute)(route) && isMetadataRouteFile(page, [], false);
    return matched;
}

//# sourceMappingURL=is-metadata-route.js.map