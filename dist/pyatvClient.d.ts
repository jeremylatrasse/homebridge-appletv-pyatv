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
/**
 * Resolves the configured pythonPath (expanding `~` or shell expressions like
 * `$(brew --prefix python@3.12)/bin/python3.12` if present), defaulting to `python3`.
 */
export declare function resolvePythonPath(rawInput?: string): string;
export declare class PyAtvClient extends EventEmitter {
    readonly config: PyAtvClientConfig;
    private readonly log;
    private proc;
    private reconnectTimer;
    private stopped;
    private stdoutBuffer;
    readonly state: PyAtvState;
    constructor(config: PyAtvClientConfig, log: Logger);
    start(): void;
    stop(): void;
    private spawnBridge;
    handleStdoutChunk(data: string): void;
    private handleJsonEvent;
    sendCommand(command: 'power_on' | 'power_off' | 'volume_up' | 'volume_down' | 'play_pause'): void;
    setPower(on: boolean): void;
}
