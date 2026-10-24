import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLATFORM_NAME = 'AppleTvPyatv';
export const PLUGIN_NAME = 'homebridge-appletv-pyatv';

function loadPluginVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export const PLUGIN_VERSION = loadPluginVersion();
