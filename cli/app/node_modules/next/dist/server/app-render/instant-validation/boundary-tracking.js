"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createValidationBoundaryTracking", {
    enumerable: true,
    get: function() {
        return createValidationBoundaryTracking;
    }
});
function createValidationBoundaryTracking() {
    return {
        expectedIds: new Set(),
        renderedIds: new Set()
    };
}

//# sourceMappingURL=boundary-tracking.js.map