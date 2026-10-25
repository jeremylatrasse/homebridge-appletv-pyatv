import { EventEmitter } from 'node:events';
import { spawn, execFileSync, ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
export function resolvePythonPath(rawInput?: string): string {
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
    cleaned = join(homedir(), cleaned.slice(2));
  }

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

export class PyAtvClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private stdoutBuffer = '';

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

    this.log.info(
      `[${this.config.name}] Starting pyatv bridge for ${this.config.host} (python: ${pythonExec})...`,
    );

    try {
      const proc = spawn(pythonExec, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: DEFAULT_ENV_PATH },
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
