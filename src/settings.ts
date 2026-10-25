import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLATFORM_NAME = 'AppleTvPyatv';
export const PLUGIN_NAME = 'homebridge-appletv-pyatv';

const FALLBACK_VERSION = '1.0.0';

function loadPluginVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const PLUGIN_VERSION = loadPluginVersion();
