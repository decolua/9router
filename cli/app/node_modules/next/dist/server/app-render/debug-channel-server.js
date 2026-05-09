/**
 * Compile-time switcher for debug channel operations.
 *
 * Simple re-export from the web implementation.
 * A future change will add a conditional branch for node streams.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createDebugChannel: null,
    toNodeDebugChannel: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createDebugChannel: function() {
        return _debugchannelserverweb.createDebugChannel;
    },
    toNodeDebugChannel: function() {
        return _debugchannelserverweb.toNodeDebugChannel;
    }
});
const _debugchannelserverweb = require("./debug-channel-server.web");

//# sourceMappingURL=debug-channel-server.js.map