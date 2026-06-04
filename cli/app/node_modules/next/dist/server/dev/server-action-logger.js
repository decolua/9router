"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "formatArgs", {
    enumerable: true,
    get: function() {
        return formatArgs;
    }
});
const _safestablestringify = require("next/dist/compiled/safe-stable-stringify");
// Configure stringify with reasonable limits for action logging
const stringify = (0, _safestablestringify.configure)({
    maximumDepth: 2,
    maximumBreadth: 3
});
/**
 * Format a single argument for display in server action logs.
 */ function formatArg(arg) {
    try {
        return stringify(arg) ?? String(arg);
    } catch  {
        // String(arg) can throw for temporary client references (e.g., class instances
        // passed from client to server) because accessing .toString() on them throws
        // "Cannot access toString on the server"
        try {
            return String(arg);
        } catch  {
            return '[unserializable]';
        }
    }
}
function formatArgs(args) {
    return args.map((a)=>formatArg(a)).join(', ');
}

//# sourceMappingURL=server-action-logger.js.map