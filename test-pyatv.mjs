import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { PyAtvClient } from './dist/pyatvClient.js';
import { TargetForwarder } from './dist/targetForwarder.js';
import { sanitizeHomeKitName } from './dist/platformAccessory.js';
import { PLUGIN_VERSION } from './dist/settings.js';

const { values, positionals } = parseArgs({
  options: {
    'appletv-host': { type: 'string', short: 'a' },
    'target-host': { type: 'string', short: 't' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(
    'Usage: node test-pyatv.mjs [--appletv-host <ip>] [--target-host <ip>] [<appletv-ip> [target-ip]]',
  );
  process.exit(0);
}

const appleTvHost =
  values['appletv-host'] ||
  positionals[0] ||
  process.env.APPLETV_HOST ||
  '127.0.0.1';

const targetHost =
  values['target-host'] ||
  positionals[1] ||
  process.env.TARGET_HOST ||
  '127.0.0.1';

console.log(
  `Testing homebridge-appletv-pyatv v${PLUGIN_VERSION} (Apple TV: ${appleTvHost}, Target Device: ${targetHost})...`,
);

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
  success: () => {},
};

const client = new PyAtvClient(
  { name: 'Living Room Apple TV', host: appleTvHost },
  noopLogger,
);
assert.equal(client.config.host, appleTvHost);

const target = new TargetForwarder(
  { host: targetHost, stepDb: 1.5, appleTvProfileId: 1 },
  noopLogger,
);
assert.equal(target.host, targetHost);
assert.equal(target.stepDb, 1.5);
assert.equal(target.appleTvProfileId, 1);

let powerEvents = [];
let volumeSteps = [];
let playbackEvents = [];

client.on('powerChange', (p) => powerEvents.push(p));
client.on('volumeStep', (dir, delta) => volumeSteps.push({ dir, delta }));
client.on('playbackChange', (playing) => playbackEvents.push(playing));

client.handleStdoutChunk('{"event": "connected", "name": "Living Room Apple TV"}\n');
assert.equal(client.state.connected, true);

client.handleStdoutChunk('{"event": "power", "power": true, "raw": "On"}\n');
assert.equal(client.state.power, true);
assert.deepEqual(powerEvents, [true]);

client.handleStdoutChunk('{"event": "volume_step", "direction": "up", "delta": 5.0}\n');
client.handleStdoutChunk('{"event": "volume_step", "direction": "down", "delta": -5.0}\n');
assert.equal(volumeSteps.length, 2);
assert.equal(volumeSteps[0].dir, 'up');
assert.equal(volumeSteps[1].dir, 'down');

client.handleStdoutChunk('{"event": "playback", "playing": true, "state": "Playing"}\n');
assert.equal(client.state.playing, true);
assert.deepEqual(playbackEvents, [true]);

assert.equal(sanitizeHomeKitName('Living Room Apple TV (4K)'), 'Living Room Apple TV 4K');

console.log('✅ All homebridge-appletv-pyatv unit tests passed!');
