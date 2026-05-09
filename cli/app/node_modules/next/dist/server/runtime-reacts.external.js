"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getClientReact: null,
    getServerReact: null,
    registerClientReact: null,
    registerServerReact: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getClientReact: function() {
        return getClientReact;
    },
    getServerReact: function() {
        return getServerReact;
    },
    registerClientReact: function() {
        return registerClientReact;
    },
    registerServerReact: function() {
        return registerServerReact;
    }
});
let ClientReact = null;
function registerClientReact(react) {
    ClientReact = react;
}
function getClientReact() {
    return ClientReact;
}
let ServerReact = null;
function registerServerReact(react) {
    ServerReact = react;
}
function getServerReact() {
    return ServerReact;
}

//# sourceMappingURL=runtime-reacts.external.js.map