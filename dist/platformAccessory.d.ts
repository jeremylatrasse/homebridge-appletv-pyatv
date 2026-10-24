import { PlatformAccessory } from 'homebridge';
import { AppleTvPyatvPlatform } from './platform';
import { PyAtvClient } from './pyatvClient';
import { TrinnovForwarder } from './trinnovForwarder';
export interface AppleTvDeviceConfig {
    name: string;
    host: string;
    pythonPath?: string;
    companionCredentials?: string;
    airplayCredentials?: string;
    mrpCredentials?: string;
    exposePlaybackSensor?: boolean;
    trinnovHost?: string;
    trinnovPort?: number;
    trinnovMac?: string;
    trinnovStepDb?: number;
    trinnovAppleTvProfileId?: number;
    trinnovSyncPowerOn?: boolean;
    trinnovSyncPowerOff?: boolean;
}
export declare function sanitizeHomeKitName(rawName: string, fallback?: string): string;
/**
 * Standard Bridged Apple TV Power & Playback Accessory:
 * Appears automatically in HomeKit with zero extra pairing!
 *
 * Exposes:
 * - Power Switch (`Service.Switch`): 2-way synced with Apple TV power state via `pyatv`
 *   so you can group or automate your Projector, Panamax, and Sound power in HomeKit.
 * - Optional Playback Motion Sensor (`Service.MotionSensor`): Triggers when Apple TV is actively playing media
 *   (great for automatically dimming theater lights when a movie starts playing).
 */
export declare class AppleTvPyatvAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly pyatv;
    private readonly trinnov;
    private readonly deviceConfig;
    private powerSwitchService;
    private playbackSensorService?;
    constructor(platform: AppleTvPyatvPlatform, accessory: PlatformAccessory, pyatv: PyAtvClient, trinnov: TrinnovForwarder | null, deviceConfig: AppleTvDeviceConfig);
    private subscribeEvents;
}
