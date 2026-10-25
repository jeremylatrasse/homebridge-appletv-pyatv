import { EventEmitter } from 'node:events';
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
/**
 * Normalizes a user-supplied pythonPath string (including `--python ...` flags,
 * `~`, or shell substitutions like `$(brew --prefix python@3.12)/bin/python3.12`).
 */
export declare function normalizePythonPathInput(rawInput?: string): string | undefined;
export declare class PyAtvClient extends EventEmitter {
    readonly config: PyAtvClientConfig;
    private readonly log;
    private proc;
    private reconnectTimer;
    private stopped;
    private stdoutBuffer;
    private cachedRuntime;
    readonly state: PyAtvState;
    constructor(config: PyAtvClientConfig, log: Logger);
    /**
     * Automatically discovers the Python interpreter on the system (macOS, Linux,
     * Raspberry Pi, or Docker) that has `pyatv` installed.
     */
    resolvePythonRuntime(): ResolvedPythonRuntime;
    start(): void;
    stop(): void;
    private spawnBridge;
    handleStdoutChunk(data: string): void;
    private handleJsonEvent;
    sendCommand(command: 'power_on' | 'power_off' | 'volume_up' | 'volume_down' | 'play_pause'): void;
    setPower(on: boolean): void;
}
