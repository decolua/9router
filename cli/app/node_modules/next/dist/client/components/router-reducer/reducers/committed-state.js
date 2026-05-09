"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getLastCommittedTree: null,
    setLastCommittedTree: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getLastCommittedTree: function() {
        return getLastCommittedTree;
    },
    setLastCommittedTree: function() {
        return setLastCommittedTree;
    }
});
// The tree from the last state that was committed to the browser history
// (i.e., the last state for which HistoryUpdater's useInsertionEffect ran).
// This lets the server-patch reducer distinguish between retrying a
// navigation that already pushed a history entry vs one whose transition
// suspended and never committed.
//
// Currently only used by the server-patch retry logic, but this module is a
// stepping stone toward a broader refactor of the navigation queue. The
// existing AppRouter action queue will eventually be replaced by a more
// reactive model that explicitly tracks pending vs committed navigation
// state. This file will likely evolve into (or be subsumed by) that new
// implementation.
let lastCommittedTree = null;
function getLastCommittedTree() {
    return lastCommittedTree;
}
function setLastCommittedTree(tree) {
    lastCommittedTree = tree;
}

if ((typeof exports.default === 'function' || (typeof exports.default === 'object' && exports.default !== null)) && typeof exports.default.__esModule === 'undefined') {
  Object.defineProperty(exports.default, '__esModule', { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}

//# sourceMappingURL=committed-state.js.map