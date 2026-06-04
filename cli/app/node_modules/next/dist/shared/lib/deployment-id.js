"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getAssetToken: null,
    getAssetTokenQuery: null,
    getDeploymentId: null,
    getDeploymentIdQuery: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getAssetToken: function() {
        return getAssetToken;
    },
    getAssetTokenQuery: function() {
        return getAssetTokenQuery;
    },
    getDeploymentId: function() {
        return getDeploymentId;
    },
    getDeploymentIdQuery: function() {
        return getDeploymentIdQuery;
    }
});
let deploymentId;
if (typeof window !== 'undefined') {
    deploymentId = document.documentElement.dataset.dplId;
    // Immediately remove the attribute to prevent hydration errors (the dplId was inserted into the
    // HTML only), React isn't aware of it at all.
    delete document.documentElement.dataset.dplId;
} else {
    // Client side: replaced with globalThis.NEXT_DEPLOYMENT_ID
    // Server side: left as is or replaced with a string or replaced with false
    deploymentId = process.env.NEXT_DEPLOYMENT_ID || undefined;
}
function getDeploymentId() {
    return deploymentId;
}
function getDeploymentIdQuery(ampersand = false) {
    let id = getDeploymentId();
    if (id) {
        return `${ampersand ? '&' : '?'}dpl=${id}`;
    }
    return '';
}
function getAssetToken() {
    return process.env.NEXT_IMMUTABLE_ASSET_TOKEN || process.env.NEXT_DEPLOYMENT_ID;
}
function getAssetTokenQuery(ampersand = false) {
    let id = getAssetToken();
    if (id) {
        return `${ampersand ? '&' : '?'}dpl=${id}`;
    }
    return '';
}

//# sourceMappingURL=deployment-id.js.map