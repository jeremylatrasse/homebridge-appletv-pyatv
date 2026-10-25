"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppleTvPyatvPlatform = void 0;
const settings_1 = require("./settings");
const pyatvClient_1 = require("./pyatvClient");
const targetForwarder_1 = require("./targetForwarder");
const platformAccessory_1 = require("./platformAccessory");
class AppleTvPyatvPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    pyatvClients = [];
    targetForwarders = [];
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.log.info(`Initializing Apple TV (pyatv) Platform v${settings_1.PLUGIN_VERSION}: "${this.config.name || 'Apple TV pyatv'}"`);
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            for (const client of this.pyatvClients) {
                client.stop();
            }
            for (const forwarder of this.targetForwarders) {
                forwarder.stop();
            }
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading cached Apple TV accessory:', accessory.displayName);
        this.accessories.push(accessory);
    }
    discoverDevices() {
        const rawDevices = this.config.devices || [];
        const devices = [...rawDevices];
        if (devices.length === 0 && typeof this.config.host === 'string' && this.config.host.trim()) {
            devices.push({
                name: this.config.name || 'Apple TV',
                host: this.config.host.trim(),
                pythonPath: this.config.pythonPath,
                companionCredentials: this.config.companionCredentials,
                airplayCredentials: this.config.airplayCredentials,
                mrpCredentials: this.config.mrpCredentials,
                exposePlaybackSensor: this.config.exposePlaybackSensor,
                targetHost: this.config.targetHost,
                targetPort: this.config.targetPort,
                targetMac: this.config.targetMac,
                targetStepDb: this.config.targetStepDb,
                targetAppleTvProfileId: this.config.targetAppleTvProfileId,
                targetSyncPowerOn: this.config.targetSyncPowerOn,
                targetSyncPowerOff: this.config.targetSyncPowerOff,
            });
        }
        if (devices.length === 0) {
            this.log.warn('No Apple TV devices configured in Homebridge config.');
            return;
        }
        const activeUuids = new Set();
        for (const [index, deviceConfig] of devices.entries()) {
            if (!deviceConfig.host) {
                this.log.warn(`Device #${index + 1} is missing IP / host. Skipping.`);
                continue;
            }
            const deviceName = deviceConfig.name?.trim() || 'Apple TV';
            const uuid = this.api.hap.uuid.generate(`appletv-pyatv:${deviceConfig.host}`);
            activeUuids.add(uuid);
            const pyatvClient = new pyatvClient_1.PyAtvClient({
                name: deviceName,
                host: deviceConfig.host,
                pythonPath: deviceConfig.pythonPath,
                companionCredentials: deviceConfig.companionCredentials,
                airplayCredentials: deviceConfig.airplayCredentials,
                mrpCredentials: deviceConfig.mrpCredentials,
            }, this.log);
            this.pyatvClients.push(pyatvClient);
            pyatvClient.start();
            let targetForwarder = null;
            if (deviceConfig.targetHost && deviceConfig.targetHost.trim()) {
                targetForwarder = new targetForwarder_1.TargetForwarder({
                    host: deviceConfig.targetHost.trim(),
                    port: deviceConfig.targetPort,
                    mac: deviceConfig.targetMac,
                    stepDb: deviceConfig.targetStepDb,
                    appleTvProfileId: deviceConfig.targetAppleTvProfileId,
                    syncPowerOn: deviceConfig.targetSyncPowerOn,
                    syncPowerOff: deviceConfig.targetSyncPowerOff,
                }, this.log);
                this.targetForwarders.push(targetForwarder);
                targetForwarder.start();
            }
            const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
            if (existingAccessory) {
                this.log.info(`Restoring cached Apple TV accessory: ${deviceName}`);
                new platformAccessory_1.AppleTvPyatvAccessory(this, existingAccessory, pyatvClient, targetForwarder, {
                    ...deviceConfig,
                    name: deviceName,
                });
                this.api.updatePlatformAccessories([existingAccessory]);
            }
            else {
                this.log.info(`Adding new Apple TV accessory: ${deviceName}`);
                const accessory = new this.api.platformAccessory(deviceName, uuid);
                new platformAccessory_1.AppleTvPyatvAccessory(this, accessory, pyatvClient, targetForwarder, {
                    ...deviceConfig,
                    name: deviceName,
                });
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            }
        }
        // Remove stale cached accessories
        const staleAccessories = this.accessories.filter((acc) => !activeUuids.has(acc.UUID));
        if (staleAccessories.length > 0) {
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, staleAccessories);
        }
    }
}
exports.AppleTvPyatvPlatform = AppleTvPyatvPlatform;
//# sourceMappingURL=platform.js.map