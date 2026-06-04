"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    RouterServerContextSymbol: null,
    routerServerGlobal: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    RouterServerContextSymbol: function() {
        return RouterServerContextSymbol;
    },
    routerServerGlobal: function() {
        return routerServerGlobal;
    }
});
const RouterServerContextSymbol = Symbol.for('@next/router-server-methods');
const routerServerGlobal = globalThis;

//# sourceMappingURL=router-server-context.js.map