"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "sortByPageExts", {
    enumerable: true,
    get: function() {
        return sortByPageExts;
    }
});
const _posix = require("path/posix");
function sortByPageExts(pageExtensions) {
    return (a, b)=>{
        // prioritize entries according to pageExtensions order
        // for consistency as fs order can differ across systems
        // NOTE: this is reversed so preferred comes last and
        // overrides prior
        const aExt = (0, _posix.extname)(a);
        const bExt = (0, _posix.extname)(b);
        const aNoExt = a.substring(0, a.length - aExt.length);
        const bNoExt = b.substring(0, b.length - bExt.length);
        if (aNoExt !== bNoExt) return 0;
        // find extension index (skip '.' as pageExtensions doesn't have it)
        const aExtIndex = pageExtensions.indexOf(aExt.substring(1));
        const bExtIndex = pageExtensions.indexOf(bExt.substring(1));
        return bExtIndex - aExtIndex;
    };
}

//# sourceMappingURL=sort-by-page-exts.js.map