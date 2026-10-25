"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PyAtvClient = void 0;
exports.resolvePythonPath = resolvePythonPath;
const node_events_1 = require("node:events");
const node_child_process_1 = require("node:child_process");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const DEFAULT_ENV_PATH = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
].join(':');
/**
 * Resolves the configured pythonPath (expanding `~` or shell expressions like
 * `$(brew --prefix python@3.12)/bin/python3.12` if present), defaulting to `python3`.
 */
function resolvePythonPath(rawInput) {
    if (!rawInput) {
        return 'python3';
    }
    let cleaned = rawInput.trim();
    if (!cleaned) {
        return 'python3';
    }
    const flagMatch = cleaned.match(/--python(?:=|\s+)([^\s]+)/);
    if (flagMatch && flagMatch[1]) {
        cleaned = flagMatch[1].trim();
    }
    if (cleaned.startsWith('~/')) {
        cleaned = (0, node_path_1.join)((0, node_os_1.homedir)(), cleaned.slice(2));
    }
    if (cleaned.includes('$(') || cleaned.includes('`') || cleaned.includes('$')) {
        try {
            const expanded = (0, node_child_process_1.execFileSync)('/bin/sh', ['-c', `echo ${cleaned}`], {
                env: { ...process.env, PATH: DEFAULT_ENV_PATH },
                encoding: 'utf8',
                timeout: 3000,
            }).trim();
            if (expanded) {
                cleaned = expanded;
            }
        }
        catch {
            // Fall back to unexpanded string if shell evaluation fails
        }
    }
    return cleaned;
}
class PyAtvClient extends node_events_1.EventEmitter {
    config;
    log;
    proc = null;
    reconnectTimer = null;
    stopped = false;
    stdoutBuffer = '';
    state = {
        connected: false,
        power: false,
        playing: false,
        volume: null,
    };
    constructor(config, log) {
        super();
        this.config = config;
        this.log = log;
    }
    start() {
        this.stopped = false;
        this.spawnBridge();
    }
    stop() {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.proc) {
            this.proc.kill('SIGTERM');
            this.proc = null;
        }
    }
    spawnBridge() {
        if (this.stopped) {
            return;
        }
        const scriptPath = (0, node_path_1.join)(__dirname, '..', 'scripts', 'pyatv_bridge.py');
        const pythonExec = resolvePythonPath(this.config.pythonPath);
        const args = ['--host', this.config.host];
        if (this.config.companionCredentials) {
            args.push('--companion-credentials', this.config.companionCredentials);
        }
        if (this.config.airplayCredentials) {
            args.push('--airplay-credentials', this.config.airplayCredentials);
        }
        if (this.config.mrpCredentials) {
            args.push('--mrp-credentials', this.config.mrpCredentials);
        }
        this.log.info(`[${this.config.name}] Starting pyatv bridge for ${this.config.host} (python: ${pythonExec})...`);
        try {
            const proc = (0, node_child_process_1.spawn)(pythonExec, [scriptPath, ...args], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PATH: DEFAULT_ENV_PATH },
            });
            this.proc = proc;
            proc.stdout.on('data', (chunk) => {
                this.handleStdoutChunk(chunk.toString('utf8'));
            });
            proc.stderr.on('data', (chunk) => {
                const msg = chunk.toString('utf8').trim();
                if (msg) {
                    this.log.debug(`[${this.config.name}] pyatv stderr: ${msg}`);
                }
            });
            proc.on('error', (err) => {
                this.log.error(`[${this.config.name}] Failed to launch python3/pyatv (${pythonExec}): ${err.message}`);
            });
            proc.on('close', (code) => {
                this.state.connected = false;
                this.proc = null;
                if (!this.stopped) {
                    this.log.debug(`[${this.config.name}] pyatv bridge exited (code ${code}). Reconnecting in 5s...`);
                    this.reconnectTimer = setTimeout(() => this.spawnBridge(), 5000);
                }
            });
        }
        catch (err) {
            const error = err;
            this.log.error(`[${this.config.name}] Spawn error: ${error.message}`);
        }
    }
    handleStdoutChunk(data) {
        this.stdoutBuffer += data;
        let newlineIndex;
        while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
            if (line) {
                this.handleJsonEvent(line);
            }
        }
    }
    handleJsonEvent(line) {
        try {
            const payload = JSON.parse(line);
            const event = payload.event;
            switch (event) {
                case 'connected':
                    this.state.connected = true;
                    this.log.info(`[${this.config.name}] Connected to Apple TV (${payload.name}) at ${this.config.host}`);
                    break;
                case 'power': {
                    const power = Boolean(payload.power);
                    const changed = this.state.power !== power;
                    this.state.power = power;
                    if (changed) {
                        this.log.info(`[${this.config.name}] Apple TV Power -> ${power ? 'ON' : 'OFF'}`);
                        this.emit('powerChange', power);
                    }
                    break;
                }
                case 'volume_step': {
                    const direction = payload.direction;
                    const delta = Number(payload.delta || 0);
                    this.log.info(`[${this.config.name}] Siri Remote Volume ${direction.toUpperCase()} (delta: ${delta})`);
                    this.emit('volumeStep', direction, delta);
                    break;
                }
                case 'volume': {
                    if (typeof payload.new === 'number') {
                        this.state.volume = payload.new;
                        this.emit('volumeChange', payload.new);
                    }
                    break;
                }
                case 'playback': {
                    const playing = Boolean(payload.playing);
                    const changed = this.state.playing !== playing;
                    this.state.playing = playing;
                    if (changed) {
                        this.log.info(`[${this.config.name}] Playback state -> ${payload.state}`);
                        this.emit('playbackChange', playing, payload.state);
                    }
                    break;
                }
                case 'error':
                    this.log.warn(`[${this.config.name}] pyatv: ${payload.message}`);
                    break;
                default:
                    break;
            }
        }
        catch {
            this.log.debug(`[${this.config.name}] Non-JSON pyatv output: ${line}`);
        }
    }
    sendCommand(command) {
        if (this.proc && this.proc.stdin.writable) {
            this.proc.stdin.write(`${JSON.stringify({ command })}\n`);
        }
    }
    setPower(on) {
        this.state.power = on;
        this.sendCommand(on ? 'power_on' : 'power_off');
    }
}
exports.PyAtvClient = PyAtvClient;
//# sourceMappingURL=pyatvClient.js.map