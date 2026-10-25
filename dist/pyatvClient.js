"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PyAtvClient = void 0;
exports.normalizePythonPathInput = normalizePythonPathInput;
exports.readShebangPython = readShebangPython;
const node_events_1 = require("node:events");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const DEFAULT_ENV_PATH = [
    '/opt/pyatv/bin',
    '/opt/pipx/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/home/linuxbrew/.linuxbrew/bin',
    '/usr/bin',
    '/bin',
    (0, node_path_1.join)((0, node_os_1.homedir)(), '.local', 'bin'),
    process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
].join(':');
/**
 * Normalizes a user-supplied pythonPath string (including `--python ...` flags,
 * `~`, or shell substitutions like `$(brew --prefix python@3.12)/bin/python3.12`).
 */
function normalizePythonPathInput(rawInput) {
    if (!rawInput) {
        return undefined;
    }
    let cleaned = rawInput.trim();
    if (!cleaned) {
        return undefined;
    }
    // If the user passed a command containing `--python <path>`, extract `<path>`
    const flagMatch = cleaned.match(/--python(?:=|\s+)([^\s]+)/);
    if (flagMatch && flagMatch[1]) {
        cleaned = flagMatch[1].trim();
    }
    // Expand leading `~/`
    if (cleaned.startsWith('~/')) {
        cleaned = (0, node_path_1.join)((0, node_os_1.homedir)(), cleaned.slice(2));
    }
    // Expand shell substitutions such as `$(brew --prefix python@3.12)/bin/python3.12` using POSIX /bin/sh
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
function safeReaddir(dirPath) {
    try {
        return (0, node_fs_1.existsSync)(dirPath) ? (0, node_fs_1.readdirSync)(dirPath) : [];
    }
    catch {
        return [];
    }
}
function listUserHomeDirs() {
    const homes = new Set([(0, node_os_1.homedir)()]);
    for (const staticHome of ['/root', '/var/root', '/var/lib/homebridge']) {
        if ((0, node_fs_1.existsSync)(staticHome)) {
            homes.add(staticHome);
        }
    }
    for (const base of ['/Users', '/home']) {
        for (const entry of safeReaddir(base)) {
            if (!entry.startsWith('.') && entry !== 'Shared') {
                homes.add((0, node_path_1.join)(base, entry));
            }
        }
    }
    return Array.from(homes);
}
/**
 * Extracts the target Python interpreter from an `atvremote` console script.
 * Handles both standard `#! /path/to/python` shebangs AND pip/distlib multi-line
 * `#!/bin/sh` + `'''exec' "/path with spaces/python" "$0" "$@"` wrappers used on macOS
 * when venvs live in `~/Library/Application Support/pipx/...`.
 */
function readShebangPython(scriptFile) {
    try {
        if (!(0, node_fs_1.existsSync)(scriptFile)) {
            return undefined;
        }
        const lines = (0, node_fs_1.readFileSync)(scriptFile, 'utf8').split('\n').slice(0, 6);
        for (const rawLine of lines) {
            const line = rawLine.trim();
            const execMatch = line.match(/exec'?\s+"([^"]+python[^"]*)"/i);
            if (execMatch && execMatch[1]) {
                return execMatch[1];
            }
        }
        const firstLine = lines[0]?.trim() || '';
        if (firstLine.startsWith('#!')) {
            const shebang = firstLine.slice(2).trim();
            const parts = shebang.split(/\s+/);
            const candidate = parts[0] === '/usr/bin/env' && parts[1] ? parts[1] : parts[0];
            if (candidate && (0, node_path_1.basename)(candidate).startsWith('python')) {
                return candidate;
            }
        }
    }
    catch {
        // Ignore read errors
    }
    return undefined;
}
function findUserPyAtvSitePackages(userHomes) {
    const sitePackages = [];
    for (const home of userHomes) {
        // macOS user site-packages: ~/Library/Python/3.x/lib/python/site-packages
        const macPyBase = (0, node_path_1.join)(home, 'Library', 'Python');
        for (const ver of safeReaddir(macPyBase).sort().reverse()) {
            const sp = (0, node_path_1.join)(macPyBase, ver, 'lib', 'python', 'site-packages');
            if ((0, node_fs_1.existsSync)((0, node_path_1.join)(sp, 'pyatv'))) {
                sitePackages.push(sp);
            }
        }
        // Linux/XDG user site-packages: ~/.local/lib/python3.x/site-packages
        const localLib = (0, node_path_1.join)(home, '.local', 'lib');
        for (const pyDir of safeReaddir(localLib).sort().reverse()) {
            if (pyDir.startsWith('python')) {
                const sp = (0, node_path_1.join)(localLib, pyDir, 'site-packages');
                if ((0, node_fs_1.existsSync)((0, node_path_1.join)(sp, 'pyatv'))) {
                    sitePackages.push(sp);
                }
            }
        }
    }
    return sitePackages;
}
function findSystemAndBrewPythons() {
    const results = [];
    // macOS Homebrew (/opt/homebrew, /usr/local) and Linuxbrew (/home/linuxbrew/.linuxbrew)
    for (const prefix of ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew']) {
        const optDir = (0, node_path_1.join)(prefix, 'opt');
        const pyFormulae = safeReaddir(optDir)
            .filter((name) => /^python@\d+\.\d+$/.test(name))
            .sort()
            .reverse();
        for (const formula of pyFormulae) {
            const ver = formula.split('@')[1];
            const binDir = (0, node_path_1.join)(optDir, formula, 'bin');
            for (const binName of [`python${ver}`, 'python3', 'python']) {
                const fullPath = (0, node_path_1.join)(binDir, binName);
                if ((0, node_fs_1.existsSync)(fullPath)) {
                    results.push(fullPath);
                }
            }
        }
        for (const binName of ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']) {
            const fullPath = (0, node_path_1.join)(prefix, 'bin', binName);
            if ((0, node_fs_1.existsSync)(fullPath)) {
                results.push(fullPath);
            }
        }
    }
    // Standard Linux / macOS /usr/bin Python versions
    for (const binName of ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']) {
        const fullPath = (0, node_path_1.join)('/usr/bin', binName);
        if ((0, node_fs_1.existsSync)(fullPath)) {
            results.push(fullPath);
        }
    }
    return results;
}
function canImportPyAtv(pythonBin, pythonPathEnv) {
    try {
        const env = { ...process.env, PATH: DEFAULT_ENV_PATH };
        if (pythonPathEnv) {
            env.PYTHONPATH = process.env.PYTHONPATH
                ? `${pythonPathEnv}:${process.env.PYTHONPATH}`
                : pythonPathEnv;
        }
        (0, node_child_process_1.execFileSync)(pythonBin, ['-c', 'import pyatv; from pyatv.const import Protocol, PowerState, DeviceState'], {
            env,
            stdio: 'ignore',
            timeout: 10000,
        });
        return true;
    }
    catch {
        return false;
    }
}
function isUsablePython3(pythonBin) {
    try {
        (0, node_child_process_1.execFileSync)(pythonBin, ['-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)'], {
            env: { ...process.env, PATH: DEFAULT_ENV_PATH },
            stdio: 'ignore',
            timeout: 5000,
        });
        return true;
    }
    catch {
        return false;
    }
}
function runCommandAsync(command, args) {
    return new Promise((resolve) => {
        try {
            const child = (0, node_child_process_1.spawn)(command, args, {
                stdio: 'ignore',
                env: { ...process.env, PATH: DEFAULT_ENV_PATH },
            });
            child.on('error', () => resolve(false));
            child.on('close', (code) => resolve(code === 0));
        }
        catch {
            resolve(false);
        }
    });
}
class PyAtvClient extends node_events_1.EventEmitter {
    config;
    log;
    static sharedInstallPromise = null;
    proc = null;
    reconnectTimer = null;
    stopped = false;
    stdoutBuffer = '';
    cachedRuntime = null;
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
    getManagedVenvCandidates() {
        return [
            (0, node_path_1.join)((0, node_os_1.homedir)(), '.homebridge-pyatv-venv'),
            (0, node_path_1.join)(__dirname, '..', '.pyatv-venv'),
            (0, node_path_1.join)((0, node_os_1.tmpdir)(), 'homebridge-pyatv-venv'),
        ];
    }
    /**
     * Automatically discovers the Python interpreter on the system (macOS, Linux,
     * Raspberry Pi, or Docker) that has `pyatv` installed.
     */
    resolvePythonRuntime() {
        if (this.cachedRuntime && this.cachedRuntime.hasPyAtv) {
            return this.cachedRuntime;
        }
        const normalizedUserPath = normalizePythonPathInput(this.config.pythonPath);
        const userHomes = listUserHomeDirs();
        // 1. Collect `atvremote` binary paths to inspect their `#!` or `exec` Python shebangs
        const atvremotePaths = new Set([
            '/opt/pyatv/bin/atvremote',
            '/opt/pipx/bin/atvremote',
            '/opt/homebrew/bin/atvremote',
            '/usr/local/bin/atvremote',
            '/home/linuxbrew/.linuxbrew/bin/atvremote',
            '/usr/bin/atvremote',
        ]);
        try {
            const whichOut = (0, node_child_process_1.execFileSync)('/bin/sh', ['-c', 'command -v atvremote'], {
                env: { ...process.env, PATH: DEFAULT_ENV_PATH },
                encoding: 'utf8',
                timeout: 2000,
            }).trim();
            if (whichOut) {
                atvremotePaths.add(whichOut);
            }
        }
        catch {
            // Ignore if atvremote is not on default PATH
        }
        for (const home of userHomes) {
            atvremotePaths.add((0, node_path_1.join)(home, '.local', 'bin', 'atvremote'));
            const macPyBase = (0, node_path_1.join)(home, 'Library', 'Python');
            for (const ver of safeReaddir(macPyBase).sort().reverse()) {
                atvremotePaths.add((0, node_path_1.join)(macPyBase, ver, 'bin', 'atvremote'));
            }
        }
        const shebangPythons = [];
        for (const scriptPath of atvremotePaths) {
            const shebangPy = readShebangPython(scriptPath);
            if (shebangPy) {
                shebangPythons.push(shebangPy);
            }
        }
        // 2. Query pipx directly if available
        const pipxVenvDirs = [];
        try {
            const pipxOut = (0, node_child_process_1.execFileSync)('/bin/sh', ['-c', 'pipx environment --value PIPX_LOCAL_VENVS'], {
                env: { ...process.env, PATH: DEFAULT_ENV_PATH },
                encoding: 'utf8',
                timeout: 3000,
            }).trim();
            if (pipxOut) {
                pipxVenvDirs.push(pipxOut);
            }
        }
        catch {
            // Ignore if pipx is not installed
        }
        // 3. Collect pipx, Homebrew Cellar, uv, & dedicated virtualenv Python binaries across system & users
        const venvPythons = [];
        for (const managedVenv of this.getManagedVenvCandidates()) {
            venvPythons.push((0, node_path_1.join)(managedVenv, 'bin', 'python3'), (0, node_path_1.join)(managedVenv, 'bin', 'python'));
        }
        for (const pipxDir of pipxVenvDirs) {
            venvPythons.push((0, node_path_1.join)(pipxDir, 'pyatv', 'bin', 'python3'), (0, node_path_1.join)(pipxDir, 'pyatv', 'bin', 'python'));
        }
        venvPythons.push('/opt/pyatv/bin/python3', '/opt/pyatv/bin/python', '/opt/pipx/venvs/pyatv/bin/python', '/usr/local/pipx/venvs/pyatv/bin/python', '/var/lib/homebridge/pyatv/bin/python3', '/var/lib/homebridge/pyatv/bin/python', '/opt/homebrew/opt/pyatv/libexec/bin/python3', '/opt/homebrew/opt/pyatv/libexec/bin/python', '/usr/local/opt/pyatv/libexec/bin/python3', '/usr/local/opt/pyatv/libexec/bin/python');
        for (const cellarPrefix of ['/opt/homebrew/Cellar/pyatv', '/usr/local/Cellar/pyatv']) {
            for (const ver of safeReaddir(cellarPrefix).sort().reverse()) {
                venvPythons.push((0, node_path_1.join)(cellarPrefix, ver, 'libexec', 'bin', 'python3'), (0, node_path_1.join)(cellarPrefix, ver, 'libexec', 'bin', 'python'));
            }
        }
        for (const home of userHomes) {
            venvPythons.push(
            // macOS default pipx location (platformdirs user_data_dir)
            (0, node_path_1.join)(home, 'Library', 'Application Support', 'pipx', 'venvs', 'pyatv', 'bin', 'python3'), (0, node_path_1.join)(home, 'Library', 'Application Support', 'pipx', 'venvs', 'pyatv', 'bin', 'python'), 
            // Linux / legacy pipx locations
            (0, node_path_1.join)(home, '.local', 'pipx', 'venvs', 'pyatv', 'bin', 'python3'), (0, node_path_1.join)(home, '.local', 'pipx', 'venvs', 'pyatv', 'bin', 'python'), (0, node_path_1.join)(home, '.local', 'share', 'pipx', 'venvs', 'pyatv', 'bin', 'python3'), (0, node_path_1.join)(home, '.local', 'share', 'pipx', 'venvs', 'pyatv', 'bin', 'python'), 
            // uv tool location
            (0, node_path_1.join)(home, '.local', 'share', 'uv', 'tools', 'pyatv', 'bin', 'python3'), (0, node_path_1.join)(home, '.local', 'share', 'uv', 'tools', 'pyatv', 'bin', 'python'), 
            // User dedicated venvs
            (0, node_path_1.join)(home, '.homebridge-pyatv-venv', 'bin', 'python3'), (0, node_path_1.join)(home, '.homebridge-pyatv-venv', 'bin', 'python'), (0, node_path_1.join)(home, '.pyatv', 'bin', 'python'), (0, node_path_1.join)(home, 'pyatv-venv', 'bin', 'python'));
        }
        // 4. Collect Homebrew, Linuxbrew, & system Python interpreters
        const systemPythons = [
            ...findSystemAndBrewPythons(),
            ...(normalizedUserPath === 'python3' || !normalizedUserPath ? ['python3'] : []),
        ];
        const candidates = [
            ...(normalizedUserPath && normalizedUserPath !== 'python3' ? [normalizedUserPath] : []),
            ...shebangPythons,
            ...venvPythons,
            ...systemPythons,
        ];
        const seen = new Set();
        const uniqueCandidates = [];
        for (const candidate of candidates) {
            if (candidate && !seen.has(candidate)) {
                seen.add(candidate);
                uniqueCandidates.push(candidate);
            }
        }
        // First pass: check if any candidate can directly `import pyatv`
        for (const candidate of uniqueCandidates) {
            if (canImportPyAtv(candidate)) {
                this.cachedRuntime = { pythonExec: candidate, hasPyAtv: true };
                return this.cachedRuntime;
            }
        }
        // Second pass: if `pyatv` was installed in a user's site-packages (`pip install --user pyatv`),
        // pair candidate Python interpreters with discovered user site-packages via PYTHONPATH
        const userSitePackages = findUserPyAtvSitePackages(userHomes);
        if (userSitePackages.length > 0) {
            const pythonPathEnv = userSitePackages.join(':');
            for (const candidate of uniqueCandidates) {
                if (canImportPyAtv(candidate, pythonPathEnv)) {
                    this.cachedRuntime = { pythonExec: candidate, pythonPathEnv, hasPyAtv: true };
                    return this.cachedRuntime;
                }
            }
        }
        // Third pass: check if `pyatv` is inside a pipx venv site-packages that needs a system/Homebrew Python binary
        for (const venvPy of venvPythons) {
            const venvLibDir = (0, node_path_1.join)((0, node_path_1.dirname)((0, node_path_1.dirname)(venvPy)), 'lib');
            for (const pyVerDir of safeReaddir(venvLibDir)) {
                const sp = (0, node_path_1.join)(venvLibDir, pyVerDir, 'site-packages');
                if ((0, node_fs_1.existsSync)((0, node_path_1.join)(sp, 'pyatv'))) {
                    for (const candidate of uniqueCandidates) {
                        if (canImportPyAtv(candidate, sp)) {
                            this.cachedRuntime = { pythonExec: candidate, pythonPathEnv: sp, hasPyAtv: true };
                            return this.cachedRuntime;
                        }
                    }
                }
            }
        }
        // No existing Python environment had `pyatv`; pick the best base Python 3 for auto-provisioning
        for (const candidate of uniqueCandidates) {
            if (isUsablePython3(candidate)) {
                return { pythonExec: candidate, hasPyAtv: false };
            }
        }
        return { pythonExec: normalizedUserPath || 'python3', hasPyAtv: false };
    }
    /**
     * Automatically creates a dedicated virtualenv and installs `pyatv` if no
     * accessible Python environment on the system currently has `pyatv`.
     */
    async ensurePyAtvInstalled(basePython) {
        if (PyAtvClient.sharedInstallPromise) {
            return PyAtvClient.sharedInstallPromise;
        }
        PyAtvClient.sharedInstallPromise = (async () => {
            for (const venvDir of this.getManagedVenvCandidates()) {
                const venvPython = (0, node_path_1.join)(venvDir, 'bin', 'python3');
                if (canImportPyAtv(venvPython)) {
                    return { pythonExec: venvPython, hasPyAtv: true };
                }
                this.log.info(`[${this.config.name}] pyatv not found in accessible Python paths; provisioning virtualenv at ${venvDir} (using ${basePython})...`);
                const created = await runCommandAsync(basePython, ['-m', 'venv', venvDir]);
                if (!created) {
                    continue;
                }
                this.log.info(`[${this.config.name}] Installing pyatv into ${venvDir} (this takes ~15-30s on first run)...`);
                const installed = await runCommandAsync(venvPython, [
                    '-m',
                    'pip',
                    'install',
                    '--quiet',
                    '--upgrade',
                    'pip',
                    'pyatv',
                ]);
                if (installed && canImportPyAtv(venvPython)) {
                    this.log.info(`[${this.config.name}] Successfully installed pyatv in ${venvPython}`);
                    return { pythonExec: venvPython, hasPyAtv: true };
                }
            }
            // Fallback if python3-venv is missing on Linux: install with --user
            this.log.info(`[${this.config.name}] Attempting user-level pip install of pyatv using ${basePython}...`);
            const userInstalled = await runCommandAsync(basePython, [
                '-m',
                'pip',
                'install',
                '--quiet',
                '--user',
                'pyatv',
            ]);
            if (userInstalled && canImportPyAtv(basePython)) {
                return { pythonExec: basePython, hasPyAtv: true };
            }
            return null;
        })();
        try {
            const result = await PyAtvClient.sharedInstallPromise;
            if (result) {
                this.cachedRuntime = result;
            }
            return result;
        }
        finally {
            PyAtvClient.sharedInstallPromise = null;
        }
    }
    start() {
        this.stopped = false;
        void this.spawnBridge();
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
    async spawnBridge() {
        if (this.stopped) {
            return;
        }
        const scriptPath = (0, node_path_1.join)(__dirname, '..', 'scripts', 'pyatv_bridge.py');
        let runtime = this.resolvePythonRuntime();
        if (!runtime.hasPyAtv) {
            const provisioned = await this.ensurePyAtvInstalled(runtime.pythonExec);
            if (provisioned) {
                runtime = provisioned;
            }
        }
        if (this.stopped) {
            return;
        }
        const { pythonExec, pythonPathEnv } = runtime;
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
            const env = { ...process.env, PATH: DEFAULT_ENV_PATH };
            if (pythonPathEnv) {
                env.PYTHONPATH = process.env.PYTHONPATH
                    ? `${pythonPathEnv}:${process.env.PYTHONPATH}`
                    : pythonPathEnv;
            }
            const proc = (0, node_child_process_1.spawn)(pythonExec, [scriptPath, ...args], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
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
                this.cachedRuntime = null;
                this.log.error(`[${this.config.name}] Failed to launch python3/pyatv (${pythonExec}): ${err.message}`);
            });
            proc.on('close', (code) => {
                this.state.connected = false;
                this.proc = null;
                if (code !== 0) {
                    this.cachedRuntime = null;
                }
                if (!this.stopped) {
                    this.log.debug(`[${this.config.name}] pyatv bridge exited (code ${code}). Reconnecting in 5s...`);
                    this.reconnectTimer = setTimeout(() => {
                        void this.spawnBridge();
                    }, 5000);
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