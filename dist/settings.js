"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLUGIN_VERSION = exports.PLUGIN_NAME = exports.PLATFORM_NAME = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.PLATFORM_NAME = 'AppleTvPyatv';
exports.PLUGIN_NAME = 'homebridge-appletv-pyatv';
const FALLBACK_VERSION = '1.0.5';
function loadPluginVersion() {
    try {
        const pkgPath = (0, node_path_1.join)(__dirname, '..', 'package.json');
        const pkg = JSON.parse((0, node_fs_1.readFileSync)(pkgPath, 'utf8'));
        return pkg.version || FALLBACK_VERSION;
    }
    catch {
        return FALLBACK_VERSION;
    }
}
exports.PLUGIN_VERSION = loadPluginVersion();
//# sourceMappingURL=settings.js.map