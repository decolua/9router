"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "normalizePath", {
    enumerable: true,
    get: function() {
        return normalizePath;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function normalizePath(file) {
    return _path.default.sep === '\\' ? file.replace(/\\/g, '/') : file;
}

//# sourceMappingURL=normalize-path.js.map