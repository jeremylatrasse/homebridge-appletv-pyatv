import { EventEmitter } from 'node:events';
import { spawn, execFileSync, ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Logger } from 'homebridge';

export interface PyAtvClientConfig {
  name: string;
  host: string;
  pythonPath?: string;
  companionCredentials?: string;
  airplayCredentials?: string;
  mrpCredentials?: string;
}

export interface PyAtvState {
  connected: boolean;
  power: boolean;
  playing: boolean;
  volume: number | null;
}

export interface ResolvedPythonRuntime {
  pythonExec: string;
  pythonPathEnv?: string;
}

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
  join(homedir(), '.local', 'bin'),
  process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
].join(':');

/**
 * Normalizes a user-supplied pythonPath string (including `--python ...` flags,
 * `~`, or shell substitutions like `$(brew --prefix python@3.12)/bin/python3.12`).
 */
export function normalizePythonPathInput(rawInput?: string): string | undefined {
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
    cleaned = join(homedir(), cleaned.slice(2));
  }

  // Expand shell substitutions such as `$(brew --prefix python@3.12)/bin/python3.12` using POSIX /bin/sh
  if (cleaned.includes('$(') || cleaned.includes('`') || cleaned.includes('$')) {
    try {
      const expanded = execFileSync('/bin/sh', ['-c', `echo ${cleaned}`], {
        env: { ...process.env, PATH: DEFAULT_ENV_PATH },
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      if (expanded) {
        cleaned = expanded;
      }
    } catch {
      // Fall back to unexpanded string if shell evaluation fails
    }
  }

  return cleaned;
}

function safeReaddir(dirPath: string): string[] {
  try {
    return existsSync(dirPath) ? readdirSync(dirPath) : [];
  } catch {
    return [];
  }
}

function listUserHomeDirs(): string[] {
  const homes = new Set<string>([homedir()]);
  // Include macOS (/Users/*, /var/root) and Linux/Docker (/home/*, /root, /var/lib/homebridge)
  for (const staticHome of ['/root', '/var/root', '/var/lib/homebridge']) {
    if (existsSync(staticHome)) {
      homes.add(staticHome);
    }
  }
  for (const base of ['/Users', '/home']) {
    for (const entry of safeReaddir(base)) {
      if (!entry.startsWith('.') && entry !== 'Shared') {
        homes.add(join(base, entry));
      }
    }
  }
  return Array.from(homes);
}

function readShebangPython(scriptFile: string): string | undefined {
  try {
    if (!existsSync(scriptFile)) {
      return undefined;
    }
    const firstLine = readFileSync(scriptFile, 'utf8').split('\n')[0]?.trim() || '';
    if (firstLine.startsWith('#!')) {
      const shebang = firstLine.slice(2).trim();
      const parts = shebang.split(/\s+/);
      if (parts[0] === '/usr/bin/env' && parts[1]) {
        return parts[1];
      }
      if (parts[0]) {
        return parts[0];
      }
    }
  } catch {
    // Ignore read errors
  }
  return undefined;
}

function findUserPyAtvSitePackages(userHomes: string[]): string[] {
  const sitePackages: string[] = [];
  for (const home of userHomes) {
    // macOS user site-packages: ~/Library/Python/3.x/lib/python/site-packages
    const macPyBase = join(home, 'Library', 'Python');
    for (const ver of safeReaddir(macPyBase).sort().reverse()) {
      const sp = join(macPyBase, ver, 'lib', 'python', 'site-packages');
      if (existsSync(join(sp, 'pyatv'))) {
        sitePackages.push(sp);
      }
    }
    // Linux/XDG user site-packages: ~/.local/lib/python3.x/site-packages
    const localLib = join(home, '.local', 'lib');
    for (const pyDir of safeReaddir(localLib).sort().reverse()) {
      if (pyDir.startsWith('python')) {
        const sp = join(localLib, pyDir, 'site-packages');
        if (existsSync(join(sp, 'pyatv'))) {
          sitePackages.push(sp);
        }
      }
    }
  }
  return sitePackages;
}

function findSystemAndBrewPythons(): string[] {
  const results: string[] = [];
  // macOS Homebrew (/opt/homebrew, /usr/local) and Linuxbrew (/home/linuxbrew/.linuxbrew)
  for (const prefix of ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew']) {
    const optDir = join(prefix, 'opt');
    const pyFormulae = safeReaddir(optDir)
      .filter((name) => /^python@\d+\.\d+$/.test(name))
      .sort()
      .reverse();

    for (const formula of pyFormulae) {
      const ver = formula.split('@')[1];
      const binDir = join(optDir, formula, 'bin');
      for (const binName of [`python${ver}`, 'python3', 'python']) {
        const fullPath = join(binDir, binName);
        if (existsSync(fullPath)) {
          results.push(fullPath);
        }
      }
    }

    for (const binName of ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']) {
      const fullPath = join(prefix, 'bin', binName);
      if (existsSync(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  // Standard Linux / POSIX /usr/bin Python versions
  for (const binName of ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3']) {
    const fullPath = join('/usr/bin', binName);
    if (existsSync(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function canImportPyAtv(pythonBin: string, pythonPathEnv?: string): boolean {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: DEFAULT_ENV_PATH };
    if (pythonPathEnv) {
      env.PYTHONPATH = process.env.PYTHONPATH
        ? `${pythonPathEnv}:${process.env.PYTHONPATH}`
        : pythonPathEnv;
    }
    execFileSync(pythonBin, ['-c', 'import pyatv'], {
      env,
      stdio: 'ignore',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export class PyAtvClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private stdoutBuffer = '';
  private cachedRuntime: ResolvedPythonRuntime | null = null;

  public readonly state: PyAtvState = {
    connected: false,
    power: false,
    playing: false,
    volume: null,
  };

  constructor(
    public readonly config: PyAtvClientConfig,
    private readonly log: Logger,
  ) {
    super();
  }

  /**
   * Automatically discovers the Python interpreter on the system (macOS, Linux,
   * Raspberry Pi, or Docker) that has `pyatv` installed.
   */
  public resolvePythonRuntime(): ResolvedPythonRuntime {
    if (this.cachedRuntime) {
      return this.cachedRuntime;
    }

    const normalizedUserPath = normalizePythonPathInput(this.config.pythonPath);
    const userHomes = listUserHomeDirs();

    // 1. Collect `atvremote` binary paths to inspect their `#!` Python shebangs
    const atvremotePaths = new Set<string>([
      '/opt/pyatv/bin/atvremote',
      '/opt/pipx/bin/atvremote',
      '/opt/homebrew/bin/atvremote',
      '/usr/local/bin/atvremote',
      '/home/linuxbrew/.linuxbrew/bin/atvremote',
      '/usr/bin/atvremote',
    ]);

    try {
      const whichOut = execFileSync('/bin/sh', ['-c', 'command -v atvremote'], {
        env: { ...process.env, PATH: DEFAULT_ENV_PATH },
        encoding: 'utf8',
        timeout: 2000,
      }).trim();
      if (whichOut) {
        atvremotePaths.add(whichOut);
      }
    } catch {
      // Ignore if atvremote is not on default PATH
    }

    for (const home of userHomes) {
      atvremotePaths.add(join(home, '.local', 'bin', 'atvremote'));
      const macPyBase = join(home, 'Library', 'Python');
      for (const ver of safeReaddir(macPyBase).sort().reverse()) {
        atvremotePaths.add(join(macPyBase, ver, 'bin', 'atvremote'));
      }
    }

    const shebangPythons: string[] = [];
    for (const scriptPath of atvremotePaths) {
      const shebangPy = readShebangPython(scriptPath);
      if (shebangPy) {
        shebangPythons.push(shebangPy);
      }
    }

    // 2. Collect pipx & dedicated virtualenv Python binaries across system & users
    const venvPythons: string[] = [
      '/opt/pyatv/bin/python3',
      '/opt/pyatv/bin/python',
      '/opt/pipx/venvs/pyatv/bin/python',
      '/usr/local/pipx/venvs/pyatv/bin/python',
      '/var/lib/homebridge/pyatv/bin/python3',
      '/var/lib/homebridge/pyatv/bin/python',
      '/opt/homebrew/opt/pyatv/libexec/bin/python3',
      '/opt/homebrew/opt/pyatv/libexec/bin/python',
      '/usr/local/opt/pyatv/libexec/bin/python3',
      '/usr/local/opt/pyatv/libexec/bin/python',
    ];

    for (const home of userHomes) {
      venvPythons.push(
        join(home, '.local', 'pipx', 'venvs', 'pyatv', 'bin', 'python'),
        join(home, '.local', 'share', 'pipx', 'venvs', 'pyatv', 'bin', 'python'),
        join(home, '.pyatv', 'bin', 'python'),
        join(home, 'pyatv-venv', 'bin', 'python'),
      );
    }

    // 3. Collect Homebrew, Linuxbrew, & system Python interpreters
    const systemPythons = [
      ...findSystemAndBrewPythons(),
      ...(normalizedUserPath === 'python3' || !normalizedUserPath ? ['python3'] : []),
    ];

    const candidates: string[] = [
      ...(normalizedUserPath && normalizedUserPath !== 'python3' ? [normalizedUserPath] : []),
      ...shebangPythons,
      ...venvPythons,
      ...systemPythons,
    ];

    const seen = new Set<string>();
    const uniqueCandidates: string[] = [];
    for (const candidate of candidates) {
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate);
        uniqueCandidates.push(candidate);
      }
    }

    // First pass: check if any candidate can directly `import pyatv`
    for (const candidate of uniqueCandidates) {
      if (canImportPyAtv(candidate)) {
        this.cachedRuntime = { pythonExec: candidate };
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
          this.cachedRuntime = { pythonExec: candidate, pythonPathEnv };
          return this.cachedRuntime;
        }
      }
    }

    // Also check if `pyatv` is inside a pipx venv site-packages that needs a system/Homebrew Python binary
    for (const venvPy of venvPythons) {
      const venvLibDir = join(dirname(dirname(venvPy)), 'lib');
      for (const pyVerDir of safeReaddir(venvLibDir)) {
        const sp = join(venvLibDir, pyVerDir, 'site-packages');
        if (existsSync(join(sp, 'pyatv'))) {
          for (const candidate of uniqueCandidates) {
            if (canImportPyAtv(candidate, sp)) {
              this.cachedRuntime = { pythonExec: candidate, pythonPathEnv: sp };
              return this.cachedRuntime;
            }
          }
        }
      }
    }

    return { pythonExec: normalizedUserPath || 'python3' };
  }

  public start(): void {
    this.stopped = false;
    this.spawnBridge();
  }

  public stop(): void {
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

  private spawnBridge(): void {
    if (this.stopped) {
      return;
    }

    const scriptPath = join(__dirname, '..', 'scripts', 'pyatv_bridge.py');
    const { pythonExec, pythonPathEnv } = this.resolvePythonRuntime();

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

    this.log.info(
      `[${this.config.name}] Starting pyatv bridge for ${this.config.host} (python: ${pythonExec})...`,
    );

    try {
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: DEFAULT_ENV_PATH };
      if (pythonPathEnv) {
        env.PYTHONPATH = process.env.PYTHONPATH
          ? `${pythonPathEnv}:${process.env.PYTHONPATH}`
          : pythonPathEnv;
      }

      const proc = spawn(pythonExec, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      this.proc = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        this.handleStdoutChunk(chunk.toString('utf8'));
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf8').trim();
        if (msg) {
          this.log.debug(`[${this.config.name}] pyatv stderr: ${msg}`);
        }
      });

      proc.on('error', (err: Error) => {
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
          this.reconnectTimer = setTimeout(() => this.spawnBridge(), 5000);
        }
      });
    } catch (err: unknown) {
      const error = err as Error;
      this.log.error(`[${this.config.name}] Spawn error: ${error.message}`);
    }
  }

  public handleStdoutChunk(data: string): void {
    this.stdoutBuffer += data;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleJsonEvent(line);
      }
    }
  }

  private handleJsonEvent(line: string): void {
    try {
      const payload = JSON.parse(line) as Record<string, unknown>;
      const event = payload.event as string;

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
          const direction = payload.direction as 'up' | 'down';
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
    } catch {
      this.log.debug(`[${this.config.name}] Non-JSON pyatv output: ${line}`);
    }
  }

  public sendCommand(command: 'power_on' | 'power_off' | 'volume_up' | 'volume_down' | 'play_pause'): void {
    if (this.proc && this.proc.stdin.writable) {
      this.proc.stdin.write(`${JSON.stringify({ command })}\n`);
    }
  }

  public setPower(on: boolean): void {
    this.state.power = on;
    this.sendCommand(on ? 'power_on' : 'power_off');
  }
}
