"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "collectRootParamKeys", {
    enumerable: true,
    get: function() {
        return collectRootParamKeys;
    }
});
const _getsegmentparam = require("../../../shared/lib/router/utils/get-segment-param");
const _checks = require("../../../server/route-modules/checks");
const _invarianterror = require("../../../shared/lib/invariant-error");
function collectAppPageRootParamKeys(routeModule) {
    let rootParams = [];
    let current = routeModule.userland.loaderTree;
    while(current){
        var _getSegmentParam;
        const [name, parallelRoutes, modules] = current;
        // If this is a dynamic segment, then we collect the param.
        const paramName = (_getSegmentParam = (0, _getsegmentparam.getSegmentParam)(name)) == null ? void 0 : _getSegmentParam.paramName;
        if (paramName) {
            rootParams.push(paramName);
        }
        // If this has a layout module, then we've found the root layout because
        // we return once we found the first layout.
        if (typeof modules.layout !== 'undefined') {
            return rootParams;
        }
        // This didn't include a root layout, so we need to continue. We don't need
        // to collect from other parallel routes because we can't have a parallel
        // route above a root layout.
        current = parallelRoutes.children;
    }
    // If we didn't find a root layout, then we don't have any params.
    return [];
}
function collectRootParamKeys(routeModule) {
    if ((0, _checks.isAppRouteRouteModule)(routeModule)) {
        return [];
    }
    if ((0, _checks.isAppPageRouteModule)(routeModule)) {
        return collectAppPageRootParamKeys(routeModule);
    }
    throw Object.defineProperty(new _invarianterror.InvariantError('Expected a route module to be one of app route or page'), "__NEXT_ERROR_CODE", {
        value: "E568",
        enumerable: false,
        configurable: true
    });
}

//# sourceMappingURL=collect-root-param-keys.js.map