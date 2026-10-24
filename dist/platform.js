"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppleTvPyatvPlatform = void 0;
const settings_1 = require("./settings");
const pyatvClient_1 = require("./pyatvClient");
const trinnovForwarder_1 = require("./trinnovForwarder");
const platformAccessory_1 = require("./platformAccessory");
class AppleTvPyatvPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    pyatvClients = [];
    trinnovForwarders = [];
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
            for (const forwarder of this.trinnovForwarders) {
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
                name: this.config.name || 'Theater Apple TV',
                host: this.config.host.trim(),
                pythonPath: this.config.pythonPath,
                companionCredentials: this.config.companionCredentials,
                airplayCredentials: this.config.airplayCredentials,
                mrpCredentials: this.config.mrpCredentials,
                exposePlaybackSensor: this.config.exposePlaybackSensor,
                trinnovHost: this.config.trinnovHost,
                trinnovPort: this.config.trinnovPort,
                trinnovMac: this.config.trinnovMac,
                trinnovStepDb: this.config.trinnovStepDb,
                trinnovAppleTvProfileId: this.config.trinnovAppleTvProfileId,
                trinnovSyncPowerOn: this.config.trinnovSyncPowerOn,
                trinnovSyncPowerOff: this.config.trinnovSyncPowerOff,
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
            const deviceName = deviceConfig.name?.trim() || 'Theater Apple TV';
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
            let trinnovForwarder = null;
            if (deviceConfig.trinnovHost && deviceConfig.trinnovHost.trim()) {
                trinnovForwarder = new trinnovForwarder_1.TrinnovForwarder({
                    host: deviceConfig.trinnovHost.trim(),
                    port: deviceConfig.trinnovPort,
                    mac: deviceConfig.trinnovMac,
                    stepDb: deviceConfig.trinnovStepDb,
                    appleTvProfileId: deviceConfig.trinnovAppleTvProfileId,
                    syncPowerOn: deviceConfig.trinnovSyncPowerOn,
                    syncPowerOff: deviceConfig.trinnovSyncPowerOff,
                }, this.log);
                this.trinnovForwarders.push(trinnovForwarder);
                trinnovForwarder.start();
            }
            const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
            if (existingAccessory) {
                this.log.info(`Restoring cached Apple TV accessory: ${deviceName}`);
                new platformAccessory_1.AppleTvPyatvAccessory(this, existingAccessory, pyatvClient, trinnovForwarder, {
                    ...deviceConfig,
                    name: deviceName,
                });
                this.api.updatePlatformAccessories([existingAccessory]);
            }
            else {
                this.log.info(`Adding new Apple TV accessory: ${deviceName}`);
                const accessory = new this.api.platformAccessory(deviceName, uuid);
                new platformAccessory_1.AppleTvPyatvAccessory(this, accessory, pyatvClient, trinnovForwarder, {
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