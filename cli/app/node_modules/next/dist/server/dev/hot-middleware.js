// Based on https://github.com/webpack-contrib/webpack-hot-middleware/blob/9708d781ae0e46179cf8ea1a94719de4679aaf53/middleware.js
// Included License below
// Copyright JS Foundation and other contributors
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// 'Software'), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
// CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WebpackHotMiddleware", {
    enumerable: true,
    get: function() {
        return WebpackHotMiddleware;
    }
});
const _utils = require("../../build/utils");
const _hotreloadertypes = require("./hot-reloader-types");
const _devindicatorserverstate = require("./dev-indicator-server-state");
const _messages = require("./messages");
function isMiddlewareStats(stats) {
    for (const key of stats.compilation.entrypoints.keys()){
        if ((0, _utils.isMiddlewareFilename)(key)) {
            return true;
        }
    }
    return false;
}
function statsToJson(stats) {
    if (!stats) return {};
    return stats.toJson({
        all: false,
        errors: true,
        hash: true,
        warnings: true
    });
}
function getStatsForSyncEvent(clientStats, serverStats) {
    if (!clientStats) return serverStats == null ? void 0 : serverStats.stats;
    if (!serverStats) return clientStats == null ? void 0 : clientStats.stats;
    // Prefer the server compiler stats if it has errors.
    // Otherwise we may end up in a state where the client compilation is the latest but without errors.
    // This causes the error overlay to not display the build error.
    if (serverStats.stats.hasErrors()) {
        return serverStats.stats;
    }
    // Return the latest stats
    return serverStats.ts > clientStats.ts ? serverStats.stats : clientStats.stats;
}
class WebpackHotMiddleware {
    constructor(compilers, versionInfo, devtoolsFrontendUrl, config, devToolsConfig){
        this.versionInfo = versionInfo;
        this.devtoolsFrontendUrl = devtoolsFrontendUrl;
        this.config = config;
        this.devToolsConfig = devToolsConfig;
        this.clientsWithoutHtmlRequestId = new Set();
        this.clientsByHtmlRequestId = new Map();
        this.closed = false;
        this.clientLatestStats = null;
        this.middlewareLatestStats = null;
        this.serverLatestStats = null;
        this.onClientInvalid = ()=>{
            var _this_serverLatestStats;
            if (this.closed || ((_this_serverLatestStats = this.serverLatestStats) == null ? void 0 : _this_serverLatestStats.stats.hasErrors())) return;
            this.publish({
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.BUILDING
            });
        };
        this.onClientDone = (statsResult)=>{
            var _this_serverLatestStats;
            this.clientLatestStats = {
                ts: Date.now(),
                stats: statsResult
            };
            if (this.closed || ((_this_serverLatestStats = this.serverLatestStats) == null ? void 0 : _this_serverLatestStats.stats.hasErrors())) return;
            this.publishStats(statsResult);
        };
        this.onServerInvalid = ()=>{
            var _this_serverLatestStats, _this_clientLatestStats;
            if (!((_this_serverLatestStats = this.serverLatestStats) == null ? void 0 : _this_serverLatestStats.stats.hasErrors())) return;
            this.serverLatestStats = null;
            if ((_this_clientLatestStats = this.clientLatestStats) == null ? void 0 : _this_clientLatestStats.stats) {
                this.publishStats(this.clientLatestStats.stats);
            }
        };
        this.onServerDone = (statsResult)=>{
            if (this.closed) return;
            if (statsResult.hasErrors()) {
                this.serverLatestStats = {
                    ts: Date.now(),
                    stats: statsResult
                };
                this.publishStats(statsResult);
            }
        };
        this.onEdgeServerInvalid = ()=>{
            var _this_middlewareLatestStats, _this_clientLatestStats;
            if (!((_this_middlewareLatestStats = this.middlewareLatestStats) == null ? void 0 : _this_middlewareLatestStats.stats.hasErrors())) return;
            this.middlewareLatestStats = null;
            if ((_this_clientLatestStats = this.clientLatestStats) == null ? void 0 : _this_clientLatestStats.stats) {
                this.publishStats(this.clientLatestStats.stats);
            }
        };
        this.onEdgeServerDone = (statsResult)=>{
            if (this.closed) return;
            if (!isMiddlewareStats(statsResult)) {
                this.onServerInvalid();
                this.onServerDone(statsResult);
            }
            if (statsResult.hasErrors()) {
                this.middlewareLatestStats = {
                    ts: Date.now(),
                    stats: statsResult
                };
                this.publishStats(statsResult);
            }
        };
        this./**
   * To sync we use the most recent stats but also we append middleware
   * errors. This is because it is possible that middleware fails to compile
   * and we still want to show the client overlay with the error while
   * the error page should be rendered just fine.
   */ onHMR = (client, htmlRequestId)=>{
            if (this.closed) return;
            if (htmlRequestId) {
                this.clientsByHtmlRequestId.set(htmlRequestId, client);
            } else {
                this.clientsWithoutHtmlRequestId.add(client);
            }
            client.addEventListener('close', ()=>{
                if (htmlRequestId) {
                    this.clientsByHtmlRequestId.delete(htmlRequestId);
                } else {
                    this.clientsWithoutHtmlRequestId.delete(client);
                }
            });
            const syncStats = getStatsForSyncEvent(this.clientLatestStats, this.serverLatestStats);
            if (syncStats) {
                var _this_middlewareLatestStats;
                const stats = statsToJson(syncStats);
                const middlewareStats = statsToJson((_this_middlewareLatestStats = this.middlewareLatestStats) == null ? void 0 : _this_middlewareLatestStats.stats);
                if (_devindicatorserverstate.devIndicatorServerState.disabledUntil < Date.now()) {
                    _devindicatorserverstate.devIndicatorServerState.disabledUntil = 0;
                }
                this.publish({
                    type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.SYNC,
                    hash: stats.hash,
                    errors: [
                        ...stats.errors || [],
                        ...middlewareStats.errors || []
                    ],
                    warnings: [
                        ...stats.warnings || [],
                        ...middlewareStats.warnings || []
                    ],
                    versionInfo: this.versionInfo,
                    debug: {
                        devtoolsFrontendUrl: this.devtoolsFrontendUrl
                    },
                    devIndicator: _devindicatorserverstate.devIndicatorServerState,
                    devToolsConfig: this.devToolsConfig
                });
            }
        };
        this.publishStats = (statsResult)=>{
            const stats = statsResult.toJson({
                all: false,
                hash: true,
                warnings: true,
                errors: true,
                moduleTrace: true
            });
            this.publish({
                type: _hotreloadertypes.HMR_MESSAGE_SENT_TO_BROWSER.BUILT,
                hash: stats.hash,
                warnings: stats.warnings || [],
                errors: stats.errors || []
            });
        };
        this.getClient = (htmlRequestId)=>{
            return this.clientsByHtmlRequestId.get(htmlRequestId);
        };
        this.publishToClient = (client, message)=>{
            if (this.closed) {
                return;
            }
            const data = typeof message.type === 'number' ? (0, _messages.createBinaryHmrMessageData)(message) : JSON.stringify(message);
            client.send(data);
        };
        this.publish = (message)=>{
            if (this.closed) {
                return;
            }
            for (const wsClient of [
                ...this.clientsWithoutHtmlRequestId,
                ...this.clientsByHtmlRequestId.values()
            ]){
                this.publishToClient(wsClient, message);
            }
        };
        this.publishToLegacyClients = (message)=>{
            if (this.closed) {
                return;
            }
            // Clients with a request ID are inferred App Router clients. If Cache
            // Components is not enabled, we consider those legacy clients. Pages
            // Router clients are also considered legacy clients. TODO: Maybe mark
            // clients as App Router / Pages Router clients explicitly, instead of
            // inferring it from the presence of a request ID.
            if (!this.config.cacheComponents) {
                for (const wsClient of this.clientsByHtmlRequestId.values()){
                    this.publishToClient(wsClient, message);
                }
            }
            for (const wsClient of this.clientsWithoutHtmlRequestId){
                this.publishToClient(wsClient, message);
            }
        };
        this.close = ()=>{
            if (this.closed) {
                return;
            }
            // Can't remove compiler plugins, so we just set a flag and noop if closed
            // https://github.com/webpack/tapable/issues/32#issuecomment-350644466
            this.closed = true;
            for (const wsClient of [
                ...this.clientsWithoutHtmlRequestId,
                ...this.clientsByHtmlRequestId.values()
            ]){
                // it's okay to not cleanly close these websocket connections, this is dev
                wsClient.terminate();
            }
            this.clientsWithoutHtmlRequestId.clear();
            this.clientsByHtmlRequestId.clear();
        };
        this.deleteClient = (client, htmlRequestId)=>{
            if (htmlRequestId) {
                this.clientsByHtmlRequestId.delete(htmlRequestId);
            } else {
                this.clientsWithoutHtmlRequestId.delete(client);
            }
        };
        this.hasClients = ()=>{
            return this.clientsWithoutHtmlRequestId.size + this.clientsByHtmlRequestId.size > 0;
        };
        this.getClientCount = ()=>{
            return this.clientsWithoutHtmlRequestId.size + this.clientsByHtmlRequestId.size;
        };
        compilers[0].hooks.invalid.tap('webpack-hot-middleware', this.onClientInvalid);
        compilers[0].hooks.done.tap('webpack-hot-middleware', this.onClientDone);
        compilers[1].hooks.invalid.tap('webpack-hot-middleware', this.onServerInvalid);
        compilers[1].hooks.done.tap('webpack-hot-middleware', this.onServerDone);
        compilers[2].hooks.done.tap('webpack-hot-middleware', this.onEdgeServerDone);
        compilers[2].hooks.invalid.tap('webpack-hot-middleware', this.onEdgeServerInvalid);
    }
    updateDevToolsConfig(newConfig) {
        this.devToolsConfig = newConfig;
    }
}

//# sourceMappingURL=hot-middleware.js.map