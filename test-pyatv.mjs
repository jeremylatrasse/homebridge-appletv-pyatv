import assert from 'node:assert/strict';
import { PyAtvClient } from './dist/pyatvClient.js';
import { sanitizeHomeKitName } from './dist/platformAccessory.js';
import { PLUGIN_VERSION } from './dist/settings.js';

console.log(`Testing homebridge-appletv-pyatv v${PLUGIN_VERSION}...`);

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
  success: () => {},
};

const client = new PyAtvClient(
  { name: 'Theater Apple TV', host: '172.16.1.50' },
  noopLogger,
);

let powerEvents = [];
let volumeSteps = [];
let playbackEvents = [];

client.on('powerChange', (p) => powerEvents.push(p));
client.on('volumeStep', (dir, delta) => volumeSteps.push({ dir, delta }));
client.on('playbackChange', (playing) => playbackEvents.push(playing));

client.handleStdoutChunk('{"event": "connected", "name": "Theater Apple TV"}\n');
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

assert.equal(sanitizeHomeKitName('Theater Apple TV (4K)'), 'Theater Apple TV 4K');

console.log('✅ All homebridge-appletv-pyatv unit tests passed!');
