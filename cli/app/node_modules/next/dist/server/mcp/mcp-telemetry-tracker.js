/**
 * Telemetry tracker for MCP tool call usage.
 * Tracks invocation counts for each MCP tool to be reported via telemetry.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getMcpTelemetryUsage: null,
    mcpTelemetryTracker: null,
    recordMcpTelemetry: null,
    resetMcpTelemetry: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getMcpTelemetryUsage: function() {
        return getMcpTelemetryUsage;
    },
    mcpTelemetryTracker: function() {
        return mcpTelemetryTracker;
    },
    recordMcpTelemetry: function() {
        return recordMcpTelemetry;
    },
    resetMcpTelemetry: function() {
        return resetMcpTelemetry;
    }
});
class McpTelemetryTracker {
    /**
   * Record a tool call invocation
   */ recordToolCall(toolName) {
        const current = this.usageMap.get(toolName) || 0;
        this.usageMap.set(toolName, current + 1);
    }
    /**
   * Get all tool usages as an array
   */ getUsages() {
        return Array.from(this.usageMap.entries()).map(([featureName, count])=>({
                featureName,
                invocationCount: count
            }));
    }
    /**
   * Reset all usage tracking
   */ reset() {
        this.usageMap.clear();
    }
    /**
   * Check if any tools have been called
   */ hasUsage() {
        return this.usageMap.size > 0;
    }
    constructor(){
        this.usageMap = new Map();
    }
}
const mcpTelemetryTracker = new McpTelemetryTracker();
function getMcpTelemetryUsage() {
    return mcpTelemetryTracker.getUsages();
}
function resetMcpTelemetry() {
    mcpTelemetryTracker.reset();
}
function recordMcpTelemetry(telemetry) {
    const mcpUsages = getMcpTelemetryUsage();
    if (mcpUsages.length === 0) {
        return;
    }
    const { eventMcpToolUsage } = require('../../telemetry/events/build');
    const events = eventMcpToolUsage(mcpUsages);
    for (const event of events){
        telemetry.record(event);
    }
}

//# sourceMappingURL=mcp-telemetry-tracker.js.map