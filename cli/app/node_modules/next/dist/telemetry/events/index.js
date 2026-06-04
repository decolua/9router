"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    EVENT_MCP_TOOL_USAGE: null,
    eventMcpToolUsage: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    EVENT_MCP_TOOL_USAGE: function() {
        return _build.EVENT_MCP_TOOL_USAGE;
    },
    eventMcpToolUsage: function() {
        return _build.eventMcpToolUsage;
    }
});
0 && __export(require("./version")) && __export(require("./build")) && __export(require("./plugins"));
_export_star(require("./version"), exports);
const _build = _export_star(require("./build"), exports);
_export_star(require("./plugins"), exports);
function _export_star(from, to) {
    Object.keys(from).forEach(function(k) {
        if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
            Object.defineProperty(to, k, {
                enumerable: true,
                get: function() {
                    return from[k];
                }
            });
        }
    });
    return from;
}

//# sourceMappingURL=index.js.map