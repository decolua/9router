"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "decodePathParams", {
    enumerable: true,
    get: function() {
        return decodePathParams;
    }
});
const _escapepathdelimiters = /*#__PURE__*/ _interop_require_default(require("../../../shared/lib/router/utils/escape-path-delimiters"));
const _utils = require("../../../shared/lib/utils");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
/**
 * We only encode path delimiters for path segments from
 * getStaticPaths so we need to attempt decoding the URL
 * to match against and only escape the path delimiters
 * this allows non-ascii values to be handled e.g.
 * Japanese characters.
 * */ function decodePathParams(pathname) {
    // TODO: investigate adding this handling for non-SSG
    // pages so non-ascii names also work there.
    return pathname.split('/').map((seg)=>{
        try {
            seg = (0, _escapepathdelimiters.default)(decodeURIComponent(seg), true);
        } catch (_) {
            // An improperly encoded URL was provided
            throw Object.defineProperty(new _utils.DecodeError('Failed to decode path param(s).'), "__NEXT_ERROR_CODE", {
                value: "E539",
                enumerable: false,
                configurable: true
            });
        }
        return seg;
    }).join('/');
}

//# sourceMappingURL=decode-path-params.js.map