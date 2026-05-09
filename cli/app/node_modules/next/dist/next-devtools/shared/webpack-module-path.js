"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    formatStackFrameFile: null,
    isWebpackInternalResource: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    formatStackFrameFile: function() {
        return formatStackFrameFile;
    },
    isWebpackInternalResource: function() {
        return isWebpackInternalResource;
    }
});
const replacementRegExes = [
    /^webpack-internal:\/\/\/(\([\w-]+\)\/)?/,
    /^(webpack:\/\/\/|webpack:\/\/(_N_E\/)?)(\([\w-]+\)\/)?/
];
function isWebpackInternalResource(file) {
    for (const regex of replacementRegExes){
        if (regex.test(file)) return true;
        file = file.replace(regex, '');
    }
    return false;
}
function formatStackFrameFile(file) {
    for (const regex of replacementRegExes){
        file = file.replace(regex, '');
    }
    return file;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=webpack-module-path.js.map