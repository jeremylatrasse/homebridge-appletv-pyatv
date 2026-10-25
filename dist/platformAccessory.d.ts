import { PlatformAccessory } from 'homebridge';
import { AppleTvPyatvPlatform } from './platform';
import { PyAtvClient } from './pyatvClient';
import { TargetForwarder } from './targetForwarder';
export interface AppleTvDeviceConfig {
    name: string;
    host: string;
    pythonPath?: string;
    companionCredentials?: string;
    airplayCredentials?: string;
    mrpCredentials?: string;
    exposePlaybackSensor?: boolean;
    targetHost?: string;
    targetPort?: number;
    targetMac?: string;
    targetStepDb?: number;
    targetAppleTvProfileId?: number;
    targetSyncPowerOn?: boolean;
    targetSyncPowerOff?: boolean;
}
export declare function sanitizeHomeKitName(rawName: string, fallback?: string): string;
/**
 * Standard Bridged Apple TV Power & Playback Accessory:
 * Appears automatically in HomeKit with zero extra pairing!
 *
 * Exposes:
 * - Power Switch (`Service.Switch`): 2-way synced with Apple TV power state via `pyatv`
 *   so you can group or automate your target devices in HomeKit.
 * - Optional Playback Motion Sensor (`Service.MotionSensor`): Triggers when Apple TV is actively playing media
 *   (great for automatically triggering lighting scenes when media starts playing).
 */
export declare class AppleTvPyatvAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly pyatv;
    private readonly targetDevice;
    private readonly deviceConfig;
    private powerSwitchService;
    private playbackSensorService?;
    constructor(platform: AppleTvPyatvPlatform, accessory: PlatformAccessory, pyatv: PyAtvClient, targetDevice: TargetForwarder | null, deviceConfig: AppleTvDeviceConfig);
    private subscribeEvents;
}
