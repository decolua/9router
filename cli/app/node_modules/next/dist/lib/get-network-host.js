"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getNetworkHost", {
    enumerable: true,
    get: function() {
        return getNetworkHost;
    }
});
const _os = /*#__PURE__*/ _interop_require_default(require("os"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function getNetworkHosts(family) {
    const interfaces = _os.default.networkInterfaces();
    const hosts = [];
    Object.keys(interfaces).forEach((key)=>{
        var _interfaces_key;
        (_interfaces_key = interfaces[key]) == null ? void 0 : _interfaces_key.filter((networkInterface)=>{
            switch(networkInterface.family){
                case 'IPv6':
                    return family === 'IPv6' && networkInterface.scopeid === 0 && networkInterface.address !== '::1';
                case 'IPv4':
                    return family === 'IPv4' && networkInterface.address !== '127.0.0.1';
                default:
                    return false;
            }
        }).forEach((networkInterface)=>{
            if (networkInterface.address) {
                hosts.push(networkInterface.address);
            }
        });
    });
    return hosts;
}
function getNetworkHost(family) {
    const hosts = getNetworkHosts(family);
    return hosts[0] ?? null;
}

//# sourceMappingURL=get-network-host.js.map