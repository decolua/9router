/**
 * Web debug channel implementation.
 * Loaded by debug-channel-server.ts.
 */ // Types defined inline for now; will move to debug-channel-server.node.ts later.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createDebugChannel: null,
    createWebDebugChannel: null,
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
        return createDebugChannel;
    },
    createWebDebugChannel: function() {
        return createWebDebugChannel;
    },
    toNodeDebugChannel: function() {
        return toNodeDebugChannel;
    }
});
function createDebugChannel() {
    if (process.env.NODE_ENV === 'production') {
        return undefined;
    }
    return createWebDebugChannel();
}
function createWebDebugChannel() {
    let readableController;
    const clientSideReadable = new ReadableStream({
        start (controller) {
            readableController = controller;
        }
    });
    return {
        serverSide: {
            writable: new WritableStream({
                write (chunk) {
                    readableController == null ? void 0 : readableController.enqueue(chunk);
                },
                close () {
                    readableController == null ? void 0 : readableController.close();
                },
                abort (err) {
                    readableController == null ? void 0 : readableController.error(err);
                }
            })
        },
        clientSide: {
            readable: clientSideReadable
        }
    };
}
function toNodeDebugChannel(_webDebugChannel) {
    throw Object.defineProperty(new Error('toNodeDebugChannel cannot be used in edge/web runtime, this is a bug in the Next.js codebase'), "__NEXT_ERROR_CODE", {
        value: "E1071",
        enumerable: false,
        configurable: true
    });
}

//# sourceMappingURL=debug-channel-server.web.js.map