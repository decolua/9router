// NOTE: this is marked as shared/external because it's stateful
// and the state needs to be shared between app-render (which waits for pending imports)
// and helpers used in transformed page code (which register pending imports)
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    trackPendingChunkLoad: null,
    trackPendingImport: null,
    trackPendingModules: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    trackPendingChunkLoad: function() {
        return _trackmoduleloadinginstance.trackPendingChunkLoad;
    },
    trackPendingImport: function() {
        return _trackmoduleloadinginstance.trackPendingImport;
    },
    trackPendingModules: function() {
        return _trackmoduleloadinginstance.trackPendingModules;
    }
});
const _trackmoduleloadinginstance = require("./track-module-loading.instance");

//# sourceMappingURL=track-module-loading.external.js.map