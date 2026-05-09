"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    reportTrigger: null,
    watchCompilers: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    reportTrigger: function() {
        return reportTrigger;
    },
    watchCompilers: function() {
        return watchCompilers;
    }
});
const _unistore = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/unistore"));
const _formatwebpackmessages = /*#__PURE__*/ _interop_require_default(require("../../shared/lib/format-webpack-messages"));
const _store = require("./store");
const _constants = require("../../shared/lib/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const buildStore = (0, _unistore.default)({
    // @ts-expect-error initial value
    client: {},
    // @ts-expect-error initial value
    server: {},
    // @ts-expect-error initial value
    edgeServer: {}
});
let buildWasDone = false;
let clientWasLoading = true;
let serverWasLoading = true;
let edgeServerWasLoading = false;
buildStore.subscribe((state)=>{
    const { client, server, edgeServer, trigger, url } = state;
    const { appUrl } = _store.store.getState();
    if (client.loading || server.loading || (edgeServer == null ? void 0 : edgeServer.loading)) {
        _store.store.setState({
            bootstrap: false,
            appUrl: appUrl,
            // If it takes more than 3 seconds to compile, mark it as loading status
            loading: true,
            trigger,
            url
        }, true);
        clientWasLoading = !buildWasDone && clientWasLoading || client.loading;
        serverWasLoading = !buildWasDone && serverWasLoading || server.loading;
        edgeServerWasLoading = !buildWasDone && edgeServerWasLoading || edgeServer.loading;
        buildWasDone = false;
        return;
    }
    buildWasDone = true;
    let partialState = {
        bootstrap: false,
        appUrl: appUrl,
        loading: false,
        typeChecking: false,
        totalModulesCount: (clientWasLoading ? client.totalModulesCount : 0) + (serverWasLoading ? server.totalModulesCount : 0) + (edgeServerWasLoading ? (edgeServer == null ? void 0 : edgeServer.totalModulesCount) || 0 : 0),
        hasEdgeServer: !!edgeServer
    };
    if (client.errors && clientWasLoading) {
        // Show only client errors
        _store.store.setState({
            ...partialState,
            errors: client.errors,
            warnings: null
        }, true);
    } else if (server.errors && serverWasLoading) {
        _store.store.setState({
            ...partialState,
            errors: server.errors,
            warnings: null
        }, true);
    } else if (edgeServer.errors && edgeServerWasLoading) {
        _store.store.setState({
            ...partialState,
            errors: edgeServer.errors,
            warnings: null
        }, true);
    } else {
        // Show warnings from all of them
        const warnings = [
            ...client.warnings || [],
            ...server.warnings || [],
            ...edgeServer.warnings || []
        ];
        _store.store.setState({
            ...partialState,
            errors: null,
            warnings: warnings.length === 0 ? null : warnings
        }, true);
    }
});
function watchCompilers(client, server, edgeServer) {
    buildStore.setState({
        client: {
            loading: true
        },
        server: {
            loading: true
        },
        edgeServer: {
            loading: true
        },
        trigger: 'initial',
        url: undefined
    });
    function tapCompiler(key, compiler, onEvent) {
        compiler.hooks.invalid.tap(`NextJsInvalid-${key}`, ()=>{
            onEvent({
                loading: true
            });
        });
        compiler.hooks.done.tap(`NextJsDone-${key}`, (stats)=>{
            const { errors, warnings } = (0, _formatwebpackmessages.default)(stats.toJson({
                preset: 'errors-warnings',
                moduleTrace: true
            }));
            const hasErrors = !!(errors == null ? void 0 : errors.length);
            const hasWarnings = !!(warnings == null ? void 0 : warnings.length);
            onEvent({
                loading: false,
                totalModulesCount: stats.compilation.modules.size,
                errors: hasErrors ? errors : null,
                warnings: hasWarnings ? warnings : null
            });
        });
    }
    tapCompiler(_constants.COMPILER_NAMES.client, client, (status)=>{
        if (!status.loading && !buildStore.getState().server.loading && !buildStore.getState().edgeServer.loading && status.totalModulesCount > 0) {
            buildStore.setState({
                client: status,
                trigger: undefined,
                url: undefined
            });
        } else {
            buildStore.setState({
                client: status
            });
        }
    });
    tapCompiler(_constants.COMPILER_NAMES.server, server, (status)=>{
        if (!status.loading && !buildStore.getState().client.loading && !buildStore.getState().edgeServer.loading && status.totalModulesCount > 0) {
            buildStore.setState({
                server: status,
                trigger: undefined,
                url: undefined
            });
        } else {
            buildStore.setState({
                server: status
            });
        }
    });
    tapCompiler(_constants.COMPILER_NAMES.edgeServer, edgeServer, (status)=>{
        if (!status.loading && !buildStore.getState().client.loading && !buildStore.getState().server.loading && status.totalModulesCount > 0) {
            buildStore.setState({
                edgeServer: status,
                trigger: undefined,
                url: undefined
            });
        } else {
            buildStore.setState({
                edgeServer: status
            });
        }
    });
}
function reportTrigger(trigger, url) {
    buildStore.setState({
        trigger,
        url
    });
}

//# sourceMappingURL=index.js.map