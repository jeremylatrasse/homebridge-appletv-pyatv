import { Logger } from 'homebridge';
export interface TargetDeviceConfig {
    host: string;
    port?: number;
    mac?: string;
    stepDb?: number;
    appleTvProfileId?: number;
    syncPowerOn?: boolean;
    syncPowerOff?: boolean;
}
/**
 * Lightweight TCP & Wake-on-LAN forwarder so Apple TV Remote
 * Volume Up/Down, Mute, and Power events control the target device directly
 * with zero HomeKit automation lag.
 */
export declare class TargetForwarder {
    private readonly log;
    private socket;
    private isConnected;
    private currentProfileId;
    private reconnectTimer;
    private stopped;
    private buffer;
    readonly host: string;
    readonly port: number;
    private readonly mac?;
    readonly stepDb: number;
    readonly appleTvProfileId?: number;
    readonly syncPowerOn: boolean;
    readonly syncPowerOff: boolean;
    constructor(config: TargetDeviceConfig, log: Logger);
    start(): void;
    stop(): void;
    private connect;
    private parseLine;
    sendRaw(command: string): void;
    stepVolumeUp(): void;
    stepVolumeDown(): void;
    toggleMute(): void;
    handleAppleTvPowerOn(): Promise<void>;
    handleAppleTvPowerOff(): void;
    private sendWakeOnLan;
}
