"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ImageError: null,
    ImageOptimizerCache: null,
    detectContentType: null,
    extractEtag: null,
    fetchExternalImage: null,
    fetchInternalImage: null,
    getHash: null,
    getImageEtag: null,
    getImageSize: null,
    getMaxAge: null,
    getPreviouslyCachedImageOrNull: null,
    getSharp: null,
    imageOptimizer: null,
    optimizeImage: null,
    sendResponse: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ImageError: function() {
        return ImageError;
    },
    ImageOptimizerCache: function() {
        return ImageOptimizerCache;
    },
    detectContentType: function() {
        return detectContentType;
    },
    extractEtag: function() {
        return extractEtag;
    },
    fetchExternalImage: function() {
        return fetchExternalImage;
    },
    fetchInternalImage: function() {
        return fetchInternalImage;
    },
    getHash: function() {
        return getHash;
    },
    getImageEtag: function() {
        return getImageEtag;
    },
    getImageSize: function() {
        return getImageSize;
    },
    getMaxAge: function() {
        return getMaxAge;
    },
    getPreviouslyCachedImageOrNull: function() {
        return getPreviouslyCachedImageOrNull;
    },
    getSharp: function() {
        return getSharp;
    },
    imageOptimizer: function() {
        return imageOptimizer;
    },
    optimizeImage: function() {
        return optimizeImage;
    },
    sendResponse: function() {
        return sendResponse;
    }
});
const _crypto = require("crypto");
const _fs = require("fs");
const _accept = require("next/dist/compiled/@hapi/accept");
const _contentdisposition = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/content-disposition"));
const _imagesize = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/image-size"));
const _detector = require("next/dist/compiled/image-detector/detector.js");
const _isanimated = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/is-animated"));
const _path = require("path");
const _url = /*#__PURE__*/ _interop_require_default(require("url"));
const _imageblursvg = require("../shared/lib/image-blur-svg");
const _matchlocalpattern = require("../shared/lib/match-local-pattern");
const _matchremotepattern = require("../shared/lib/match-remote-pattern");
const _mockrequest = require("./lib/mock-request");
const _responsecache = require("./response-cache");
const _sendpayload = require("./send-payload");
const _servestatic = require("./serve-static");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
const _iserror = /*#__PURE__*/ _interop_require_default(require("../lib/is-error"));
const _isprivateip = require("./is-private-ip");
const _disklrucacheexternal = require("./lib/disk-lru-cache.external");
const _url1 = require("../lib/url");
const _invarianterror = require("../shared/lib/invariant-error");
const _promises = require("dns/promises");
const _net = require("net");
const _dns = require("dns");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const AVIF = 'image/avif';
const WEBP = 'image/webp';
const PNG = 'image/png';
const JPEG = 'image/jpeg';
const JXL = 'image/jxl';
const JP2 = 'image/jp2';
const HEIC = 'image/heic';
const GIF = 'image/gif';
const SVG = 'image/svg+xml';
const ICO = 'image/x-icon';
const ICNS = 'image/x-icns';
const TIFF = 'image/tiff';
const BMP = 'image/bmp';
const PDF = 'application/pdf';
const CACHE_VERSION = 4;
const ANIMATABLE_TYPES = [
    WEBP,
    PNG,
    GIF
];
const BYPASS_TYPES = [
    SVG,
    ICO,
    ICNS,
    BMP,
    JXL,
    HEIC
];
const BLUR_IMG_SIZE = 8 // should match `next-image-loader`
;
const BLUR_QUALITY = 70 // should match `next-image-loader`
;
let _sharp;
async function initCacheEntries(cacheDir) {
    const cacheKeys = await _fs.promises.readdir(cacheDir).catch(()=>[]);
    const entries = [];
    for (const cacheKey of cacheKeys){
        try {
            const { expireAt, buffer } = await readFromCacheDir(cacheDir, cacheKey);
            entries.push({
                key: cacheKey,
                size: buffer.byteLength,
                expireAt
            });
        } catch  {
        // Skip entries that can't be read from disk
        }
    }
    // Sort oldest-first so we can replay them chronologically into LRU
    return entries.sort((a, b)=>a.expireAt - b.expireAt);
}
function getSharp(concurrency) {
    if (_sharp) {
        return _sharp;
    }
    try {
        _sharp = require('sharp');
        if (_sharp && _sharp.concurrency() > 1) {
            // Reducing concurrency should reduce the memory usage too.
            // We more aggressively reduce in dev but also reduce in prod.
            // https://sharp.pixelplumbing.com/api-utility#concurrency
            const divisor = process.env.NODE_ENV === 'development' ? 4 : 2;
            _sharp.concurrency(concurrency ?? Math.floor(Math.max(_sharp.concurrency() / divisor, 1)));
        }
    } catch (e) {
        if ((0, _iserror.default)(e) && e.code === 'MODULE_NOT_FOUND') {
            throw Object.defineProperty(new Error('Module `sharp` not found. Please run `npm install --cpu=wasm32 sharp` to install it.'), "__NEXT_ERROR_CODE", {
                value: "E47",
                enumerable: false,
                configurable: true
            });
        }
        throw e;
    }
    return _sharp;
}
function getSupportedMimeType(options, accept = '') {
    const mimeType = (0, _accept.mediaType)(accept, options);
    return accept.includes(mimeType) ? mimeType : '';
}
function getHash(items) {
    const hash = (0, _crypto.createHash)('sha256');
    for (let item of items){
        if (typeof item === 'number') hash.update(String(item));
        else {
            hash.update(item);
        }
    }
    // See https://en.wikipedia.org/wiki/Base64#URL_applications
    return hash.digest('base64url');
}
function extractEtag(etag, imageBuffer) {
    if (etag) {
        // upstream etag needs to be base64url encoded due to weak etag signature
        // as we store this in the cache-entry file name.
        return Buffer.from(etag).toString('base64url');
    }
    return getImageEtag(imageBuffer);
}
function getImageEtag(image) {
    return getHash([
        image
    ]);
}
async function writeToCacheDir(cacheDir, cacheKey, extension, maxAge, expireAt, buffer, etag, upstreamEtag) {
    const dir = (0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey);
    const filename = (0, _path.join)(/* turbopackIgnore: true */ dir, `${maxAge}.${expireAt}.${etag}.${upstreamEtag}.${extension}`);
    await _fs.promises.rm(dir, {
        recursive: true,
        force: true
    }).catch(()=>{});
    await _fs.promises.mkdir(dir, {
        recursive: true
    });
    await _fs.promises.writeFile(filename, buffer);
}
async function readFromCacheDir(cacheDir, cacheKey) {
    const dir = (0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey);
    const files = await _fs.promises.readdir(dir);
    const file = files[0];
    if (!file) {
        throw Object.defineProperty(new Error(`Invariant: cache entry "${cacheKey}" not found in dir "${cacheDir}"`), "__NEXT_ERROR_CODE", {
            value: "E1069",
            enumerable: false,
            configurable: true
        });
    }
    const [maxAgeSt, expireAtSt, etag, upstreamEtag, extension] = file.split('.', 5);
    const filePath = (0, _path.join)(/* turbopackIgnore: true */ dir, file);
    const buffer = await _fs.promises.readFile(/* turbopackIgnore: true */ filePath);
    const expireAt = Number(expireAtSt);
    const maxAge = Number(maxAgeSt);
    return {
        maxAge,
        expireAt,
        etag,
        upstreamEtag,
        buffer,
        extension
    };
}
async function deleteFromCacheDir(cacheDir, cacheKey) {
    return _fs.promises.rm((0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey), {
        recursive: true,
        force: true
    }).catch((err)=>{
        _log.error(`Failed to delete cache key ${cacheKey}`, err);
    });
}
async function detectContentType(buffer, skipMetadata, concurrency) {
    if (buffer.byteLength === 0) {
        return null;
    }
    if ([
        0xff,
        0xd8,
        0xff
    ].every((b, i)=>buffer[i] === b)) {
        return JPEG;
    }
    if ([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return PNG;
    }
    if ([
        0x47,
        0x49,
        0x46,
        0x38
    ].every((b, i)=>buffer[i] === b)) {
        return GIF;
    }
    if ([
        0x52,
        0x49,
        0x46,
        0x46,
        0,
        0,
        0,
        0,
        0x57,
        0x45,
        0x42,
        0x50
    ].every((b, i)=>!b || buffer[i] === b)) {
        return WEBP;
    }
    if ([
        0x3c,
        0x3f,
        0x78,
        0x6d,
        0x6c
    ].every((b, i)=>buffer[i] === b)) {
        return SVG;
    }
    if ([
        0x3c,
        0x73,
        0x76,
        0x67
    ].every((b, i)=>buffer[i] === b)) {
        return SVG;
    }
    if ([
        0,
        0,
        0,
        0,
        0x66,
        0x74,
        0x79,
        0x70,
        0x61,
        0x76,
        0x69,
        0x66
    ].every((b, i)=>!b || buffer[i] === b)) {
        return AVIF;
    }
    if ([
        0x00,
        0x00,
        0x01,
        0x00
    ].every((b, i)=>buffer[i] === b)) {
        return ICO;
    }
    if ([
        0x69,
        0x63,
        0x6e,
        0x73
    ].every((b, i)=>buffer[i] === b)) {
        return ICNS;
    }
    if ([
        0x49,
        0x49,
        0x2a,
        0x00
    ].every((b, i)=>buffer[i] === b)) {
        return TIFF;
    }
    if ([
        0x42,
        0x4d
    ].every((b, i)=>buffer[i] === b)) {
        return BMP;
    }
    if ([
        0xff,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return JXL;
    }
    if ([
        0x00,
        0x00,
        0x00,
        0x0c,
        0x4a,
        0x58,
        0x4c,
        0x20,
        0x0d,
        0x0a,
        0x87,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return JXL;
    }
    if ([
        0,
        0,
        0,
        0,
        0x66,
        0x74,
        0x79,
        0x70,
        0x68,
        0x65,
        0x69,
        0x63
    ].every((b, i)=>!b || buffer[i] === b)) {
        return HEIC;
    }
    if ([
        0x25,
        0x50,
        0x44,
        0x46,
        0x2d
    ].every((b, i)=>buffer[i] === b)) {
        return PDF;
    }
    if ([
        0x00,
        0x00,
        0x00,
        0x0c,
        0x6a,
        0x50,
        0x20,
        0x20,
        0x0d,
        0x0a,
        0x87,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return JP2;
    }
    let format;
    format = (0, _detector.detector)(buffer);
    if (!format && !skipMetadata) {
        const sharp = getSharp(concurrency);
        const meta = await sharp(buffer).metadata().catch((_)=>null);
        format = meta == null ? void 0 : meta.format;
    }
    switch(format){
        case 'avif':
            return AVIF;
        case 'webp':
            return WEBP;
        case 'png':
            return PNG;
        case 'jpeg':
        case 'jpg':
            return JPEG;
        case 'gif':
            return GIF;
        case 'svg':
            return SVG;
        case 'jxl':
        case 'jxl-stream':
            return JXL;
        case 'jp2':
            return JP2;
        case 'tiff':
        case 'tif':
            return TIFF;
        case 'pdf':
            return PDF;
        case 'bmp':
            return BMP;
        case 'ico':
            return ICO;
        case 'icns':
            return ICNS;
        case 'dcraw':
        case 'dz':
        case 'exr':
        case 'fits':
        case 'heif':
        case 'input':
        case 'magick':
        case 'openslide':
        case 'ppm':
        case 'rad':
        case 'raw':
        case 'v':
        case 'cur':
        case 'dds':
        case 'j2c':
        case 'ktx':
        case 'pnm':
        case 'psd':
        case 'tga':
        case undefined:
        default:
            return null;
    }
}
class ImageOptimizerCache {
    static validateParams(req, query, nextConfig, isDev) {
        var _nextConfig_images, _nextConfig_images1, _nextConfig_images2;
        const imageData = nextConfig.images;
        const { deviceSizes = [], imageSizes = [], domains = [], minimumCacheTTL = 14400, formats = [
            'image/webp'
        ] } = imageData;
        const remotePatterns = ((_nextConfig_images = nextConfig.images) == null ? void 0 : _nextConfig_images.remotePatterns) || [];
        const localPatterns = (_nextConfig_images1 = nextConfig.images) == null ? void 0 : _nextConfig_images1.localPatterns;
        const qualities = (_nextConfig_images2 = nextConfig.images) == null ? void 0 : _nextConfig_images2.qualities;
        const { url, w, q } = query;
        let href;
        if (domains.length > 0) {
            _log.warnOnce('The "images.domains" configuration is deprecated. Please use "images.remotePatterns" configuration instead.');
        }
        if (!url) {
            return {
                errorMessage: '"url" parameter is required'
            };
        } else if (Array.isArray(url)) {
            return {
                errorMessage: '"url" parameter cannot be an array'
            };
        }
        if (url.length > 3072) {
            return {
                errorMessage: '"url" parameter is too long'
            };
        }
        if (url.startsWith('//')) {
            return {
                errorMessage: '"url" parameter cannot be a protocol-relative URL (//)'
            };
        }
        let isAbsolute;
        if (url.startsWith('/')) {
            var _parseUrl;
            href = url;
            isAbsolute = false;
            if (/\/_next\/image($|\/)/.test(decodeURIComponent(((_parseUrl = (0, _url1.parseUrl)(url)) == null ? void 0 : _parseUrl.pathname) ?? ''))) {
                return {
                    errorMessage: '"url" parameter cannot be recursive'
                };
            }
            if (!(0, _matchlocalpattern.hasLocalMatch)(localPatterns, url)) {
                return {
                    errorMessage: '"url" parameter is not allowed'
                };
            }
        } else {
            let hrefParsed;
            try {
                hrefParsed = new URL(url);
                href = hrefParsed.toString();
                isAbsolute = true;
            } catch (_error) {
                return {
                    errorMessage: '"url" parameter is invalid'
                };
            }
            if (![
                'http:',
                'https:'
            ].includes(hrefParsed.protocol)) {
                return {
                    errorMessage: '"url" parameter is invalid'
                };
            }
            if (!(0, _matchremotepattern.hasRemoteMatch)(domains, remotePatterns, hrefParsed)) {
                return {
                    errorMessage: '"url" parameter is not allowed'
                };
            }
        }
        if (!w) {
            return {
                errorMessage: '"w" parameter (width) is required'
            };
        } else if (Array.isArray(w)) {
            return {
                errorMessage: '"w" parameter (width) cannot be an array'
            };
        } else if (!/^[0-9]+$/.test(w)) {
            return {
                errorMessage: '"w" parameter (width) must be an integer greater than 0'
            };
        }
        if (!q) {
            return {
                errorMessage: '"q" parameter (quality) is required'
            };
        } else if (Array.isArray(q)) {
            return {
                errorMessage: '"q" parameter (quality) cannot be an array'
            };
        } else if (!/^[0-9]+$/.test(q)) {
            return {
                errorMessage: '"q" parameter (quality) must be an integer between 1 and 100'
            };
        }
        const width = parseInt(w, 10);
        if (width <= 0 || isNaN(width)) {
            return {
                errorMessage: '"w" parameter (width) must be an integer greater than 0'
            };
        }
        const sizes = [
            ...deviceSizes || [],
            ...imageSizes || []
        ];
        if (isDev) {
            sizes.push(BLUR_IMG_SIZE);
        }
        const isValidSize = sizes.includes(width) || isDev && width <= BLUR_IMG_SIZE;
        if (!isValidSize) {
            return {
                errorMessage: `"w" parameter (width) of ${width} is not allowed`
            };
        }
        const quality = parseInt(q, 10);
        if (isNaN(quality) || quality < 1 || quality > 100) {
            return {
                errorMessage: '"q" parameter (quality) must be an integer between 1 and 100'
            };
        }
        if (qualities) {
            if (isDev) {
                qualities.push(BLUR_QUALITY);
            }
            if (!qualities.includes(quality)) {
                return {
                    errorMessage: `"q" parameter (quality) of ${q} is not allowed`
                };
            }
        }
        const mimeType = getSupportedMimeType(formats || [], req.headers['accept']);
        const isStatic = url.startsWith(`${nextConfig.basePath || ''}/_next/static/media`);
        return {
            href,
            sizes,
            isAbsolute,
            isStatic,
            width,
            quality,
            mimeType,
            minimumCacheTTL
        };
    }
    static getCacheKey({ href, width, quality, mimeType }) {
        return getHash([
            CACHE_VERSION,
            href,
            width,
            quality,
            mimeType
        ]);
    }
    constructor({ distDir, nextConfig, cacheHandler }){
        this.cacheDir = (0, _path.join)(/* turbopackIgnore: true */ distDir, 'cache', 'images');
        this.nextConfig = nextConfig;
        this.cacheHandler = cacheHandler;
        // Eagerly start LRU initialization for filesystem cache
        if (!cacheHandler && nextConfig.images.maximumDiskCacheSize !== 0 && nextConfig.experimental.isrFlushToDisk) {
            this.isDiskCacheEnabled = true;
            this.cacheDiskLRU = (0, _disklrucacheexternal.getOrInitDiskLRU)(this.cacheDir, nextConfig.images.maximumDiskCacheSize, initCacheEntries, deleteFromCacheDir);
        }
    }
    async get(cacheKey) {
        // If a custom cache handler is provided, use it
        if (this.cacheHandler) {
            try {
                const cacheData = await this.cacheHandler.get(cacheKey, {
                    kind: _responsecache.IncrementalCacheKind.IMAGE,
                    isFallback: false
                });
                if (!(cacheData == null ? void 0 : cacheData.value)) {
                    return null;
                }
                if (cacheData.value.kind !== _responsecache.CachedRouteKind.IMAGE) {
                    return null;
                }
                const now = Date.now();
                const lastModified = cacheData.lastModified || now;
                const revalidate = typeof cacheData.value.revalidate === 'number' ? cacheData.value.revalidate : this.nextConfig.images.minimumCacheTTL;
                const revalidateAfter = Math.max(revalidate, this.nextConfig.images.minimumCacheTTL) * 1000 + lastModified;
                const isStale = revalidateAfter < now;
                return {
                    value: cacheData.value,
                    revalidateAfter,
                    cacheControl: {
                        revalidate,
                        expire: undefined
                    },
                    isStale
                };
            } catch (_) {
            // failed to get from custom cache handler, treat as cache miss
            }
            return null;
        }
        // If the filesystem cache is disabled, return early
        if (!this.isDiskCacheEnabled) {
            return null;
        }
        // Fall back to filesystem cache
        try {
            const now = Date.now();
            const { maxAge, expireAt, etag, upstreamEtag, buffer, extension } = await readFromCacheDir(this.cacheDir, cacheKey);
            // Promote entry in LRU (mark as recently used)
            const lru = await this.cacheDiskLRU;
            lru == null ? void 0 : lru.get(cacheKey);
            return {
                value: {
                    kind: _responsecache.CachedRouteKind.IMAGE,
                    etag,
                    buffer,
                    extension,
                    upstreamEtag
                },
                revalidateAfter: Math.max(maxAge, this.nextConfig.images.minimumCacheTTL) * 1000 + Date.now(),
                cacheControl: {
                    revalidate: maxAge,
                    expire: undefined
                },
                isStale: now > expireAt
            };
        } catch (_) {
        // failed to read from cache dir, treat as cache miss
        }
        return null;
    }
    async set(cacheKey, value, { cacheControl }) {
        if ((value == null ? void 0 : value.kind) !== _responsecache.CachedRouteKind.IMAGE) {
            throw Object.defineProperty(new Error('invariant attempted to set non-image to image-cache'), "__NEXT_ERROR_CODE", {
                value: "E366",
                enumerable: false,
                configurable: true
            });
        }
        const revalidate = cacheControl == null ? void 0 : cacheControl.revalidate;
        if (typeof revalidate !== 'number') {
            throw Object.defineProperty(new _invarianterror.InvariantError('revalidate must be a number for image-cache'), "__NEXT_ERROR_CODE", {
                value: "E657",
                enumerable: false,
                configurable: true
            });
        }
        // If a custom cache handler is provided, use it
        if (this.cacheHandler) {
            try {
                // Apply minimumCacheTTL at write time, similar to the implementation in the fallback filesystem cache
                const effectiveRevalidate = Math.max(revalidate, this.nextConfig.images.minimumCacheTTL);
                const valueWithRevalidate = {
                    ...value,
                    revalidate: effectiveRevalidate
                };
                await this.cacheHandler.set(cacheKey, valueWithRevalidate, {
                    cacheControl: {
                        revalidate: effectiveRevalidate,
                        expire: cacheControl == null ? void 0 : cacheControl.expire
                    }
                });
            } catch (err) {
                _log.error(`Failed to write image to custom cache ${cacheKey}`, err);
            }
            return;
        }
        // If the filesystem cache is disabled, return early
        if (!this.isDiskCacheEnabled) {
            return;
        }
        // Fall back to filesystem cache
        const expireAt = Math.max(revalidate, this.nextConfig.images.minimumCacheTTL) * 1000 + Date.now();
        try {
            const lru = await this.cacheDiskLRU;
            const success = lru == null ? void 0 : lru.set(cacheKey, value.buffer.byteLength);
            if (success === false) {
                throw Object.defineProperty(new Error(`image of size ${value.buffer.byteLength} could not be tracked by lru cache`), "__NEXT_ERROR_CODE", {
                    value: "E1070",
                    enumerable: false,
                    configurable: true
                });
            }
            await writeToCacheDir(this.cacheDir, cacheKey, value.extension, revalidate, expireAt, value.buffer, value.etag, value.upstreamEtag);
        } catch (err) {
            _log.error(`Failed to write image to cache ${cacheKey}`, err);
        }
    }
}
class ImageError extends Error {
    constructor(statusCode, message){
        super(message);
        // ensure an error status is used > 400
        if (statusCode >= 400) {
            this.statusCode = statusCode;
        } else {
            this.statusCode = 500;
        }
    }
}
function parseCacheControl(str) {
    const map = new Map();
    if (!str) {
        return map;
    }
    for (let directive of str.split(',')){
        let [key, value] = directive.trim().split('=', 2);
        key = key.toLowerCase();
        if (value) {
            value = value.toLowerCase();
        }
        map.set(key, value);
    }
    return map;
}
function getMaxAge(str) {
    const map = parseCacheControl(str);
    if (map) {
        let age = map.get('s-maxage') || map.get('max-age') || '';
        if (age.startsWith('"') && age.endsWith('"')) {
            age = age.slice(1, -1);
        }
        const n = parseInt(age, 10);
        if (!isNaN(n)) {
            return n;
        }
    }
    return 0;
}
function getPreviouslyCachedImageOrNull(upstreamImage, previousCacheEntry) {
    var _previousCacheEntry_value;
    if ((previousCacheEntry == null ? void 0 : (_previousCacheEntry_value = previousCacheEntry.value) == null ? void 0 : _previousCacheEntry_value.kind) === 'IMAGE' && // Images that are SVGs, animated or failed the optimization previously end up using upstreamEtag as their etag as well,
    // in these cases we want to trigger a new "optimization" attempt.
    previousCacheEntry.value.upstreamEtag !== previousCacheEntry.value.etag && // and the upstream etag is the same as the previous cache entry's
    upstreamImage.etag === previousCacheEntry.value.upstreamEtag) {
        return previousCacheEntry.value;
    }
    return null;
}
async function optimizeImage({ buffer, contentType, quality, width, height, concurrency, limitInputPixels, sequentialRead, timeoutInSeconds }) {
    const sharp = getSharp(concurrency);
    const transformer = sharp(buffer, {
        limitInputPixels,
        sequentialRead: sequentialRead ?? undefined
    }).timeout({
        seconds: timeoutInSeconds ?? 7
    }).rotate();
    if (height) {
        transformer.resize(width, height);
    } else {
        transformer.resize(width, undefined, {
            withoutEnlargement: true
        });
    }
    if (contentType === AVIF) {
        transformer.avif({
            quality: Math.max(quality - 20, 1),
            effort: 3
        });
    } else if (contentType === WEBP) {
        transformer.webp({
            quality
        });
    } else if (contentType === PNG) {
        transformer.png({
            quality
        });
    } else if (contentType === JPEG) {
        transformer.jpeg({
            quality,
            mozjpeg: true
        });
    }
    const optimizedBuffer = await transformer.toBuffer();
    return optimizedBuffer;
}
function isRedirect(statusCode) {
    return [
        301,
        302,
        303,
        307,
        308
    ].includes(statusCode);
}
async function fetchExternalImage(href, dangerouslyAllowLocalIP, maximumResponseBody, count = 3) {
    if (!dangerouslyAllowLocalIP) {
        const { hostname } = new URL(href);
        let ips = [
            hostname
        ];
        if (!(0, _net.isIP)(hostname)) {
            const records = await (0, _promises.lookup)(hostname, {
                family: 0,
                all: true,
                hints: _dns.ALL
            }).catch((_)=>[
                    {
                        address: hostname
                    }
                ]);
            ips = records.map((record)=>record.address);
        }
        const privateIps = ips.filter((ip)=>(0, _isprivateip.isPrivateIp)(ip));
        if (privateIps.length > 0) {
            _log.error('upstream image', href, 'resolved to private ip', JSON.stringify(privateIps));
            throw Object.defineProperty(new ImageError(400, '"url" parameter is not allowed'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
    }
    const res = await fetch(href, {
        signal: AbortSignal.timeout(7000),
        redirect: 'manual'
    }).catch((err)=>err);
    if (res instanceof Error) {
        const err = res;
        if (err.name === 'TimeoutError') {
            _log.error('upstream image response timed out for', href);
            throw Object.defineProperty(new ImageError(504, '"url" parameter is valid but upstream response timed out'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        throw err;
    }
    const locationHeader = res.headers.get('Location');
    if (isRedirect(res.status) && locationHeader && URL.canParse(locationHeader, href)) {
        if (count === 0) {
            _log.error('upstream image response had too many redirects', href);
            throw Object.defineProperty(new ImageError(508, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        const redirect = new URL(locationHeader, href).href;
        return fetchExternalImage(redirect, dangerouslyAllowLocalIP, maximumResponseBody, count - 1);
    }
    if (!res.ok) {
        _log.error('upstream image response failed for', href, res.status);
        throw Object.defineProperty(new ImageError(res.status, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    if (!res.body) {
        _log.error('upstream image response is empty for', href);
        throw Object.defineProperty(new ImageError(400, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    const chunks = [];
    let totalSize = 0;
    for await (const c of res.body){
        const chunk = Buffer.from(c);
        totalSize += chunk.byteLength;
        if (totalSize > maximumResponseBody) {
            _log.error('upstream image response exceeded maximum size for', href, totalSize);
            throw Object.defineProperty(new ImageError(413, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentType = res.headers.get('Content-Type');
    const cacheControl = res.headers.get('Cache-Control');
    const etag = extractEtag(res.headers.get('ETag'), buffer);
    return {
        buffer,
        contentType,
        cacheControl,
        etag
    };
}
async function fetchInternalImage(href, _req, _res, handleRequest) {
    try {
        // Coerce HEAD to GET to avoid issues with the image optimizer
        const method = !_req.method || _req.method === 'HEAD' ? 'GET' : _req.method;
        const mocked = (0, _mockrequest.createRequestResponseMocks)({
            url: href,
            method,
            socket: _req.socket
        });
        await handleRequest(mocked.req, mocked.res, _url.default.parse(href, true));
        await mocked.res.hasStreamed;
        if (!mocked.res.statusCode) {
            _log.error('image response failed for', href, mocked.res.statusCode);
            throw Object.defineProperty(new ImageError(mocked.res.statusCode, '"url" parameter is valid but internal response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        const buffer = Buffer.concat(mocked.res.buffers);
        const contentType = mocked.res.getHeader('Content-Type');
        const cacheControl = mocked.res.getHeader('Cache-Control');
        const etag = extractEtag(mocked.res.getHeader('ETag'), buffer);
        return {
            buffer,
            contentType,
            cacheControl,
            etag
        };
    } catch (err) {
        _log.error('upstream image response failed for', href, err);
        throw Object.defineProperty(new ImageError(500, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
}
async function imageOptimizer(imageUpstream, paramsResult, nextConfig, opts) {
    const { href, quality, width, mimeType } = paramsResult;
    const { buffer: upstreamBuffer, etag: upstreamEtag } = imageUpstream;
    const maxAge = Math.max(nextConfig.images.minimumCacheTTL, getMaxAge(imageUpstream.cacheControl));
    const upstreamType = await detectContentType(upstreamBuffer, nextConfig.experimental.imgOptSkipMetadata, nextConfig.experimental.imgOptConcurrency);
    if (!upstreamType || !upstreamType.startsWith('image/') || upstreamType.includes(',')) {
        if (!opts.silent) {
            _log.error("The requested resource isn't a valid image for", href, 'received', upstreamType);
        }
        throw Object.defineProperty(new ImageError(400, "The requested resource isn't a valid image."), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    if (upstreamType.startsWith('image/svg') && !nextConfig.images.dangerouslyAllowSVG) {
        if (!opts.silent) {
            _log.error(`The requested resource "${href}" has type "${upstreamType}" but dangerouslyAllowSVG is disabled. Consider adding the "unoptimized" property to the <Image>.`);
        }
        throw Object.defineProperty(new ImageError(400, '"url" parameter is valid but image type is not allowed'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    if (ANIMATABLE_TYPES.includes(upstreamType) && (0, _isanimated.default)(upstreamBuffer)) {
        if (!opts.silent) {
            _log.warnOnce(`The requested resource "${href}" is an animated image so it will not be optimized. Consider adding the "unoptimized" property to the <Image>.`);
        }
        return {
            buffer: upstreamBuffer,
            contentType: upstreamType,
            maxAge,
            etag: upstreamEtag,
            upstreamEtag
        };
    }
    if (BYPASS_TYPES.includes(upstreamType)) {
        return {
            buffer: upstreamBuffer,
            contentType: upstreamType,
            maxAge,
            etag: upstreamEtag,
            upstreamEtag
        };
    }
    let contentType;
    if (mimeType) {
        contentType = mimeType;
    } else if ((0, _servestatic.getExtension)(upstreamType) && upstreamType !== WEBP && upstreamType !== AVIF) {
        contentType = upstreamType;
    } else {
        contentType = JPEG;
    }
    const previouslyCachedImage = getPreviouslyCachedImageOrNull(imageUpstream, opts.previousCacheEntry);
    if (previouslyCachedImage) {
        var _opts_previousCacheEntry_cacheControl, _opts_previousCacheEntry;
        return {
            buffer: previouslyCachedImage.buffer,
            contentType,
            maxAge: (opts == null ? void 0 : (_opts_previousCacheEntry = opts.previousCacheEntry) == null ? void 0 : (_opts_previousCacheEntry_cacheControl = _opts_previousCacheEntry.cacheControl) == null ? void 0 : _opts_previousCacheEntry_cacheControl.revalidate) || maxAge,
            etag: previouslyCachedImage.etag,
            upstreamEtag: previouslyCachedImage.upstreamEtag
        };
    }
    try {
        let optimizedBuffer = await optimizeImage({
            buffer: upstreamBuffer,
            contentType,
            quality,
            width,
            concurrency: nextConfig.experimental.imgOptConcurrency,
            limitInputPixels: nextConfig.experimental.imgOptMaxInputPixels,
            sequentialRead: nextConfig.experimental.imgOptSequentialRead,
            timeoutInSeconds: nextConfig.experimental.imgOptTimeoutInSeconds
        });
        if (opts.isDev && width <= BLUR_IMG_SIZE && quality === BLUR_QUALITY) {
            // During `next dev`, we don't want to generate blur placeholders with webpack
            // because it can delay starting the dev server. Instead, `next-image-loader.js`
            // will inline a special url to lazily generate the blur placeholder at request time.
            const meta = await getImageSize(optimizedBuffer);
            const blurOpts = {
                blurWidth: meta.width,
                blurHeight: meta.height,
                blurDataURL: `data:${contentType};base64,${optimizedBuffer.toString('base64')}`
            };
            optimizedBuffer = Buffer.from(unescape((0, _imageblursvg.getImageBlurSvg)(blurOpts)));
            contentType = 'image/svg+xml';
        }
        return {
            buffer: optimizedBuffer,
            contentType,
            maxAge,
            etag: getImageEtag(optimizedBuffer),
            upstreamEtag
        };
    } catch (error) {
        if (upstreamType) {
            // If we fail to optimize, fallback to the original image
            return {
                buffer: upstreamBuffer,
                contentType: upstreamType,
                maxAge: nextConfig.images.minimumCacheTTL,
                etag: upstreamEtag,
                upstreamEtag,
                error
            };
        } else {
            throw Object.defineProperty(new ImageError(400, 'Unable to optimize image and unable to fallback to upstream image'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
    }
}
function getFileNameWithExtension(url, contentType) {
    const [urlWithoutQueryParams] = url.split('?', 1);
    const fileNameWithExtension = urlWithoutQueryParams.split('/').pop();
    if (!contentType || !fileNameWithExtension) {
        return 'image.bin';
    }
    const [fileName] = fileNameWithExtension.split('.', 1);
    const extension = (0, _servestatic.getExtension)(contentType);
    return `${fileName}.${extension}`;
}
function setResponseHeaders(req, res, url, etag, contentType, isStatic, xCache, imagesConfig, maxAge, isDev) {
    res.setHeader('Vary', 'Accept');
    res.setHeader('Cache-Control', isStatic ? 'public, max-age=315360000, immutable' : `public, max-age=${isDev ? 0 : maxAge}, must-revalidate`);
    if ((0, _sendpayload.sendEtagResponse)(req, res, etag)) {
        // already called res.end() so we're finished
        return {
            finished: true
        };
    }
    if (contentType) {
        res.setHeader('Content-Type', contentType);
    }
    const fileName = getFileNameWithExtension(url, contentType);
    res.setHeader('Content-Disposition', (0, _contentdisposition.default)(fileName, {
        type: imagesConfig.contentDispositionType
    }));
    res.setHeader('Content-Security-Policy', imagesConfig.contentSecurityPolicy);
    res.setHeader('X-Nextjs-Cache', xCache);
    return {
        finished: false
    };
}
function sendResponse(req, res, url, extension, buffer, etag, isStatic, xCache, imagesConfig, maxAge, isDev) {
    const contentType = (0, _servestatic.getContentType)(extension);
    const result = setResponseHeaders(req, res, url, etag, contentType, isStatic, xCache, imagesConfig, maxAge, isDev);
    if (!result.finished) {
        res.setHeader('Content-Length', Buffer.byteLength(buffer));
        // A response body must not be sent for HEAD requests
        if (req.method === 'HEAD') {
            res.end();
        } else {
            res.end(buffer);
        }
    }
}
async function getImageSize(buffer) {
    const { width, height } = (0, _imagesize.default)(buffer);
    return {
        width,
        height
    };
}

//# sourceMappingURL=image-optimizer.js.map