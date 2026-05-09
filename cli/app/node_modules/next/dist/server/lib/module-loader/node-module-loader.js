"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "NodeModuleLoader", {
    enumerable: true,
    get: function() {
        return NodeModuleLoader;
    }
});
class NodeModuleLoader {
    async load(id) {
        if (process.env.NEXT_RUNTIME !== 'edge') {
            // Need to `await` to cover the case that route is marked ESM modules by ESM escalation.
            return await (process.env.NEXT_MINIMAL ? __non_webpack_require__(id) : require(id));
        }
        throw Object.defineProperty(new Error('NodeModuleLoader is not supported in edge runtime.'), "__NEXT_ERROR_CODE", {
            value: "E25",
            enumerable: false,
            configurable: true
        });
    }
}

//# sourceMappingURL=node-module-loader.js.map