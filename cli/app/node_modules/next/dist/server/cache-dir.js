"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getStorageDirectory", {
    enumerable: true,
    get: function() {
        return getStorageDirectory;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _isdocker = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/is-docker"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function getStorageDirectory(distDir) {
    const isLikelyEphemeral = (0, _isdocker.default)();
    if (isLikelyEphemeral) {
        return undefined;
    }
    return _path.default.join(distDir, 'cache');
}

//# sourceMappingURL=cache-dir.js.map