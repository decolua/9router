"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "writeFileAtomic", {
    enumerable: true,
    get: function() {
        return writeFileAtomic;
    }
});
const _fs = require("fs");
const _rename = require("./rename");
function writeFileAtomic(filePath, content) {
    const tempPath = filePath + '.tmp.' + Math.random().toString(36).slice(2);
    try {
        (0, _fs.writeFileSync)(tempPath, content, 'utf-8');
        (0, _rename.renameSync)(tempPath, filePath);
    } catch (e) {
        try {
            (0, _fs.unlinkSync)(tempPath);
        } catch  {
        // ignore
        }
        throw e;
    }
}

//# sourceMappingURL=write-atomic.js.map