"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "normalizeDataPath", {
    enumerable: true,
    get: function() {
        return normalizeDataPath;
    }
});
const _pathhasprefix = require("../router/utils/path-has-prefix");
function normalizeDataPath(pathname) {
    if (!(0, _pathhasprefix.pathHasPrefix)(pathname || '/', '/_next/data')) {
        return pathname;
    }
    pathname = pathname.replace(/\/_next\/data\/[^/]{1,}/, '').replace(/\.json$/, '');
    if (pathname === '/index') {
        return '/';
    }
    return pathname;
}

//# sourceMappingURL=normalize-data-path.js.map