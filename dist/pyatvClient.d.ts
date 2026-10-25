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
    hasPyAtv: boolean;
}
/**
 * Normalizes a user-supplied pythonPath string (including `--python ...` flags,
 * `~`, or shell substitutions like `$(brew --prefix python@3.12)/bin/python3.12`).
 */
export declare function normalizePythonPathInput(rawInput?: string): string | undefined;
/**
 * Extracts the target Python interpreter from an `atvremote` console script.
 * Handles both standard `#! /path/to/python` shebangs AND pip/distlib multi-line
 * `#!/bin/sh` + `'''exec' "/path with spaces/python" "$0" "$@"` wrappers used on macOS
 * when venvs live in `~/Library/Application Support/pipx/...`.
 */
export declare function readShebangPython(scriptFile: string): string | undefined;
export declare class PyAtvClient extends EventEmitter {
    readonly config: PyAtvClientConfig;
    private readonly log;
    private static sharedInstallPromise;
    private proc;
    private reconnectTimer;
    private stopped;
    private stdoutBuffer;
    private cachedRuntime;
    readonly state: PyAtvState;
    constructor(config: PyAtvClientConfig, log: Logger);
    private getManagedVenvCandidates;
    /**
     * Automatically discovers the Python interpreter on the system (macOS, Linux,
     * Raspberry Pi, or Docker) that has `pyatv` installed.
     */
    resolvePythonRuntime(): ResolvedPythonRuntime;
    /**
     * Automatically creates a dedicated virtualenv and installs `pyatv` if no
     * accessible Python environment on the system currently has `pyatv`.
     */
    private ensurePyAtvInstalled;
    start(): void;
    stop(): void;
    private spawnBridge;
    handleStdoutChunk(data: string): void;
    private handleJsonEvent;
    sendCommand(command: 'power_on' | 'power_off' | 'volume_up' | 'volume_down' | 'play_pause'): void;
    setPower(on: boolean): void;
}
