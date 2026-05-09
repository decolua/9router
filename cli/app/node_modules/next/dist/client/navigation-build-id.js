// This gets assigned as a side-effect during app initialization. Because it
// represents the build used to create the JS bundle, it should never change
// after being set, so we store it in a global variable.
//
// When performing RSC requests, if the incoming data has a different build ID,
// we perform an MPA navigation/refresh to load the updated build and ensure
// that the client and server in sync.
//
// Starts as an empty string. In practice, because setNavigationBuildId is called during initialization
// before hydration starts, this will always get reassigned to the actual ID before it's ever needed
// by a navigation. If for some reasons it didn't, due to a bug or race condition, then on
// navigation the build comparision would fail and trigger an MPA navigation.
//
// Note that this can also be initialized with the deployment id instead (if available). So it's not
// the same as "the build id", but we are running out of alternative names for "build id or
// deployment id".
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getNavigationBuildId: null,
    setNavigationBuildId: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getNavigationBuildId: function() {
        return getNavigationBuildId;
    },
    setNavigationBuildId: function() {
        return setNavigationBuildId;
    }
});
let globalBuildId = '';
function setNavigationBuildId(buildId) {
    globalBuildId = buildId;
}
function getNavigationBuildId() {
    return globalBuildId;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=navigation-build-id.js.map