"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppleTvPyatvAccessory = void 0;
exports.sanitizeHomeKitName = sanitizeHomeKitName;
const settings_1 = require("./settings");
function sanitizeHomeKitName(rawName, fallback = 'Apple TV') {
    const cleaned = rawName
        .replace(/\+/g, ' and ')
        .replace(/[()[\]{}/\\]/g, ' ')
        .replace(/[^a-zA-Z0-9 '-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[^a-zA-Z0-9]+/, '')
        .replace(/[^a-zA-Z0-9]+$/, '');
    return cleaned.length > 0 ? cleaned.slice(0, 64) : fallback;
}
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
class AppleTvPyatvAccessory {
    platform;
    accessory;
    pyatv;
    trinnov;
    deviceConfig;
    powerSwitchService;
    playbackSensorService;
    constructor(platform, accessory, pyatv, trinnov, deviceConfig) {
        this.platform = platform;
        this.accessory = accessory;
        this.pyatv = pyatv;
        this.trinnov = trinnov;
        this.deviceConfig = deviceConfig;
        const { Service, Characteristic } = this.platform;
        const cleanName = sanitizeHomeKitName(this.deviceConfig.name, 'Apple TV');
        // 1. Accessory Information
        const infoService = this.accessory.getService(Service.AccessoryInformation);
        infoService
            .setCharacteristic(Characteristic.Name, cleanName)
            .setCharacteristic(Characteristic.Manufacturer, 'Apple Inc.')
            .setCharacteristic(Characteristic.Model, 'Apple TV 4K (pyatv)')
            .setCharacteristic(Characteristic.SerialNumber, `ATV-${this.deviceConfig.host}`)
            .setCharacteristic(Characteristic.FirmwareRevision, settings_1.PLUGIN_VERSION);
        // 2. Primary Power Switch (for grouping & automating Projector + Theater Power in HomeKit)
        const powerSubtype = 'appletv-power';
        const powerName = sanitizeHomeKitName(`${cleanName} Power`, 'Apple TV Power');
        let powerSvc = this.accessory.getServiceById(Service.Switch, powerSubtype);
        if (!powerSvc) {
            powerSvc = new Service.Switch(powerName, powerSubtype);
            powerSvc.addOptionalCharacteristic(Characteristic.ConfiguredName);
            powerSvc.setCharacteristic(Characteristic.Name, powerName);
            powerSvc.setCharacteristic(Characteristic.ConfiguredName, powerName);
            this.accessory.addService(powerSvc);
        }
        else {
            if (!powerSvc.testCharacteristic(Characteristic.ConfiguredName)) {
                powerSvc.addOptionalCharacteristic(Characteristic.ConfiguredName);
            }
            powerSvc.displayName = powerName;
            powerSvc.setCharacteristic(Characteristic.Name, powerName);
            powerSvc.setCharacteristic(Characteristic.ConfiguredName, powerName);
        }
        this.powerSwitchService = powerSvc;
        this.powerSwitchService
            .getCharacteristic(Characteristic.On)
            .onGet(() => this.pyatv.state.power)
            .onSet(async (value) => {
            const targetOn = Boolean(value);
            this.platform.log.info(`[${cleanName}] HomeKit Switch set Apple TV Power -> ${targetOn ? 'ON' : 'OFF'}`);
            this.pyatv.setPower(targetOn);
            if (this.trinnov) {
                if (targetOn) {
                    await this.trinnov.handleAppleTvPowerOn();
                }
                else {
                    this.trinnov.handleAppleTvPowerOff();
                }
            }
        });
        // 3. Optional Playback Sensor (for Theater lighting scenes on Play / Pause)
        const playbackSubtype = 'appletv-playback';
        if (this.deviceConfig.exposePlaybackSensor) {
            const playName = sanitizeHomeKitName(`${cleanName} Playing`, 'Apple TV Playing');
            let playSvc = this.accessory.getServiceById(Service.MotionSensor, playbackSubtype);
            if (!playSvc) {
                playSvc = new Service.MotionSensor(playName, playbackSubtype);
                playSvc.addOptionalCharacteristic(Characteristic.ConfiguredName);
                playSvc.setCharacteristic(Characteristic.Name, playName);
                playSvc.setCharacteristic(Characteristic.ConfiguredName, playName);
                this.accessory.addService(playSvc);
            }
            else {
                if (!playSvc.testCharacteristic(Characteristic.ConfiguredName)) {
                    playSvc.addOptionalCharacteristic(Characteristic.ConfiguredName);
                }
                playSvc.displayName = playName;
                playSvc.setCharacteristic(Characteristic.Name, playName);
                playSvc.setCharacteristic(Characteristic.ConfiguredName, playName);
            }
            this.playbackSensorService = playSvc;
            this.playbackSensorService
                .getCharacteristic(Characteristic.MotionDetected)
                .onGet(() => this.pyatv.state.playing);
        }
        else {
            const existing = this.accessory.getServiceById(Service.MotionSensor, playbackSubtype);
            if (existing) {
                this.accessory.removeService(existing);
            }
        }
        // 4. Subscribe to live pyatv events (Siri Remote Power, Volume Up/Down, Playback)
        this.subscribeEvents();
    }
    subscribeEvents() {
        const { Characteristic } = this.platform;
        this.pyatv.on('powerChange', async (power) => {
            this.powerSwitchService.updateCharacteristic(Characteristic.On, power);
            if (this.trinnov) {
                if (power) {
                    await this.trinnov.handleAppleTvPowerOn();
                }
                else {
                    this.trinnov.handleAppleTvPowerOff();
                }
            }
        });
        this.pyatv.on('volumeStep', (direction) => {
            if (this.trinnov) {
                if (direction === 'up') {
                    this.trinnov.stepVolumeUp();
                }
                else {
                    this.trinnov.stepVolumeDown();
                }
            }
        });
        this.pyatv.on('playbackChange', (playing) => {
            if (this.playbackSensorService) {
                this.playbackSensorService.updateCharacteristic(Characteristic.MotionDetected, playing);
            }
        });
    }
}
exports.AppleTvPyatvAccessory = AppleTvPyatvAccessory;
//# sourceMappingURL=platformAccessory.js.map