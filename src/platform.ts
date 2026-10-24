import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, PLUGIN_VERSION } from './settings';
import { PyAtvClient } from './pyatvClient';
import { TrinnovForwarder } from './trinnovForwarder';
import { AppleTvPyatvAccessory, AppleTvDeviceConfig } from './platformAccessory';

export class AppleTvPyatvPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly pyatvClients: PyAtvClient[] = [];
  private readonly trinnovForwarders: TrinnovForwarder[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.info(
      `Initializing Apple TV (pyatv) Platform v${PLUGIN_VERSION}: "${this.config.name || 'Apple TV pyatv'}"`,
    );

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

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading cached Apple TV accessory:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const rawDevices = (this.config.devices as AppleTvDeviceConfig[]) || [];
    const devices: AppleTvDeviceConfig[] = [...rawDevices];

    if (devices.length === 0 && typeof this.config.host === 'string' && this.config.host.trim()) {
      devices.push({
        name: (this.config.name as string) || 'Theater Apple TV',
        host: (this.config.host as string).trim(),
        pythonPath: this.config.pythonPath as string | undefined,
        companionCredentials: this.config.companionCredentials as string | undefined,
        airplayCredentials: this.config.airplayCredentials as string | undefined,
        mrpCredentials: this.config.mrpCredentials as string | undefined,
        exposePlaybackSensor: this.config.exposePlaybackSensor as boolean | undefined,
        trinnovHost: this.config.trinnovHost as string | undefined,
        trinnovPort: this.config.trinnovPort as number | undefined,
        trinnovMac: this.config.trinnovMac as string | undefined,
        trinnovStepDb: this.config.trinnovStepDb as number | undefined,
        trinnovAppleTvProfileId: this.config.trinnovAppleTvProfileId as number | undefined,
        trinnovSyncPowerOn: this.config.trinnovSyncPowerOn as boolean | undefined,
        trinnovSyncPowerOff: this.config.trinnovSyncPowerOff as boolean | undefined,
      });
    }

    if (devices.length === 0) {
      this.log.warn('No Apple TV devices configured in Homebridge config.');
      return;
    }

    const activeUuids = new Set<string>();

    for (const [index, deviceConfig] of devices.entries()) {
      if (!deviceConfig.host) {
        this.log.warn(`Device #${index + 1} is missing IP / host. Skipping.`);
        continue;
      }

      const deviceName = deviceConfig.name?.trim() || 'Theater Apple TV';
      const uuid = this.api.hap.uuid.generate(`appletv-pyatv:${deviceConfig.host}`);
      activeUuids.add(uuid);

      const pyatvClient = new PyAtvClient(
        {
          name: deviceName,
          host: deviceConfig.host,
          pythonPath: deviceConfig.pythonPath,
          companionCredentials: deviceConfig.companionCredentials,
          airplayCredentials: deviceConfig.airplayCredentials,
          mrpCredentials: deviceConfig.mrpCredentials,
        },
        this.log,
      );
      this.pyatvClients.push(pyatvClient);
      pyatvClient.start();

      let trinnovForwarder: TrinnovForwarder | null = null;
      if (deviceConfig.trinnovHost && deviceConfig.trinnovHost.trim()) {
        trinnovForwarder = new TrinnovForwarder(
          {
            host: deviceConfig.trinnovHost.trim(),
            port: deviceConfig.trinnovPort,
            mac: deviceConfig.trinnovMac,
            stepDb: deviceConfig.trinnovStepDb,
            appleTvProfileId: deviceConfig.trinnovAppleTvProfileId,
            syncPowerOn: deviceConfig.trinnovSyncPowerOn,
            syncPowerOff: deviceConfig.trinnovSyncPowerOff,
          },
          this.log,
        );
        this.trinnovForwarders.push(trinnovForwarder);
        trinnovForwarder.start();
      }

      const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
      if (existingAccessory) {
        this.log.info(`Restoring cached Apple TV accessory: ${deviceName}`);
        new AppleTvPyatvAccessory(this, existingAccessory, pyatvClient, trinnovForwarder, {
          ...deviceConfig,
          name: deviceName,
        });
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        this.log.info(`Adding new Apple TV accessory: ${deviceName}`);
        const accessory = new this.api.platformAccessory(deviceName, uuid);
        new AppleTvPyatvAccessory(this, accessory, pyatvClient, trinnovForwarder, {
          ...deviceConfig,
          name: deviceName,
        });
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Remove stale cached accessories
    const staleAccessories = this.accessories.filter((acc) => !activeUuids.has(acc.UUID));
    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }
}
