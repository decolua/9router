"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getDevOverlayFontMiddleware", {
    enumerable: true,
    get: function() {
        return getDevOverlayFontMiddleware;
    }
});
const _interop_require_default = require("@swc/helpers/_/_interop_require_default");
const _interop_require_wildcard = require("@swc/helpers/_/_interop_require_wildcard");
const _path = /*#__PURE__*/ _interop_require_default._(require("path"));
const _promises = /*#__PURE__*/ _interop_require_wildcard._(require("fs/promises"));
const _fs = require("fs");
const _log = /*#__PURE__*/ _interop_require_wildcard._(require("../../../build/output/log"));
const _middlewareresponse = require("../middleware-response");
const FONT_PREFIX = '/__nextjs_font/';
const VALID_FONTS = [
    'geist-latin-ext.woff2',
    'geist-mono-latin-ext.woff2',
    'geist-latin.woff2',
    'geist-mono-latin.woff2'
];
const FONT_HEADERS = {
    'Content-Type': 'font/woff2',
    'Cache-Control': 'public, max-age=31536000, immutable'
};
function getDevOverlayFontMiddleware() {
    return async function devOverlayFontMiddleware(req, res, next) {
        try {
            const { pathname } = new URL(`http://n${req.url}`);
            if (!pathname.startsWith(FONT_PREFIX)) {
                return next();
            }
            const fontFile = pathname.replace(FONT_PREFIX, '');
            if (!VALID_FONTS.includes(fontFile)) {
                return _middlewareresponse.middlewareResponse.notFound(res);
            }
            const fontPath = _path.default.resolve(__dirname, fontFile);
            const fileExists = await checkFileExists(fontPath);
            if (!fileExists) {
                return _middlewareresponse.middlewareResponse.notFound(res);
            }
            const fontData = await _promises.readFile(fontPath);
            Object.entries(FONT_HEADERS).forEach(([key, value])=>{
                res.setHeader(key, value);
            });
            res.end(fontData);
        } catch (err) {
            _log.error('Failed to serve font:', err instanceof Error ? err.message : err);
            return _middlewareresponse.middlewareResponse.internalServerError(res);
        }
    };
}
async function checkFileExists(filePath) {
    try {
        await _promises.access(filePath, _fs.constants.F_OK);
        return true;
    } catch  {
        return false;
    }
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=get-dev-overlay-font-middleware.js.map