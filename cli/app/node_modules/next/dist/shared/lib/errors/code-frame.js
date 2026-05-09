"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "codeFrameColumns", {
    enumerable: true,
    get: function() {
        return codeFrameColumns;
    }
});
const _swc = require("../../../build/swc");
function codeFrameColumns(file, location, options = {}) {
    // Default to the terminal width
    if (options.maxWidth === undefined) {
        options.maxWidth = process.stdout.columns;
    }
    return (0, _swc.getBindingsSync)().codeFrameColumns(file, location, options);
}

//# sourceMappingURL=code-frame.js.map