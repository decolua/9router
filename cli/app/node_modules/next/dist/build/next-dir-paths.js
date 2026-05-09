"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    NEXT_PROJECT_ROOT: null,
    NEXT_PROJECT_ROOT_DIST: null,
    NEXT_PROJECT_ROOT_DIST_CLIENT: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    NEXT_PROJECT_ROOT: function() {
        return NEXT_PROJECT_ROOT;
    },
    NEXT_PROJECT_ROOT_DIST: function() {
        return NEXT_PROJECT_ROOT_DIST;
    },
    NEXT_PROJECT_ROOT_DIST_CLIENT: function() {
        return NEXT_PROJECT_ROOT_DIST_CLIENT;
    }
});
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const NEXT_PROJECT_ROOT = _path.default.join(__dirname, '..', '..');
const NEXT_PROJECT_ROOT_DIST = _path.default.join(NEXT_PROJECT_ROOT, 'dist');
const NEXT_PROJECT_ROOT_DIST_CLIENT = _path.default.join(NEXT_PROJECT_ROOT_DIST, 'client');

//# sourceMappingURL=next-dir-paths.js.map