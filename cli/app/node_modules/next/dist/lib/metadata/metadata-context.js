"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createMetadataContext", {
    enumerable: true,
    get: function() {
        return createMetadataContext;
    }
});
function createMetadataContext(renderOpts) {
    return {
        trailingSlash: renderOpts.trailingSlash,
        isStaticMetadataRouteFile: false
    };
}

//# sourceMappingURL=metadata-context.js.map