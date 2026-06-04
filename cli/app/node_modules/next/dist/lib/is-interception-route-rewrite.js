"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "isInterceptionRouteRewrite", {
    enumerable: true,
    get: function() {
        return isInterceptionRouteRewrite;
    }
});
const _approuterheaders = require("../client/components/app-router-headers");
function isInterceptionRouteRewrite(route) {
    var _route_has_, _route_has;
    // When we generate interception rewrites in the above implementation, we always do so with only a single `has` condition.
    return ((_route_has = route.has) == null ? void 0 : (_route_has_ = _route_has[0]) == null ? void 0 : _route_has_.key) === _approuterheaders.NEXT_URL;
}

//# sourceMappingURL=is-interception-route-rewrite.js.map