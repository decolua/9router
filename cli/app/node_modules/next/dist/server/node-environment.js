// This file should be imported before any others. It sets up the environment
// for later imports to work properly.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
require("./node-environment-baseline");
require("./node-environment-extensions/error-inspect");
require("./node-environment-extensions/console-file");
require("./node-environment-extensions/console-exit");
require("./node-environment-extensions/console-dim.external");
require("./node-environment-extensions/unhandled-rejection.external");
require("./node-environment-extensions/random");
require("./node-environment-extensions/date");
require("./node-environment-extensions/web-crypto");
require("./node-environment-extensions/node-crypto");
require("./node-environment-extensions/fast-set-immediate.external");

//# sourceMappingURL=node-environment.js.map