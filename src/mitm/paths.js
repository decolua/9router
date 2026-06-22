"use strict";
const path = require("path");
const { DATA_DIR } = require("../lib/dataDir.cjs");

const MITM_DIR = path.join(DATA_DIR, "mitm");

module.exports = { DATA_DIR, MITM_DIR };
