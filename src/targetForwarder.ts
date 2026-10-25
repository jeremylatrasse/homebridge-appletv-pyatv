import * as net from 'node:net';
import * as dgram from 'node:dgram';
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
export class TargetForwarder {
  private socket: net.Socket | null = null;
  private isConnected = false;
  private currentProfileId: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private buffer = '';

  private readonly host: string;
  private readonly port: number;
  private readonly mac?: string;
  public readonly stepDb: number;
  public readonly appleTvProfileId?: number;
  public readonly syncPowerOn: boolean;
  public readonly syncPowerOff: boolean;

  constructor(
    config: TargetDeviceConfig,
    private readonly log: Logger,
  ) {
    this.host = config.host;
    this.port = config.port ?? 44100;
    this.mac = config.mac;
    this.stepDb = config.stepDb ?? 1.0;
    this.appleTvProfileId = config.appleTvProfileId;
    this.syncPowerOn = config.syncPowerOn !== false;
    this.syncPowerOff = config.syncPowerOff !== false;
  }

  public start(): void {
    this.stopped = false;
    this.connect();
  }

  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private connect(): void {
    if (this.stopped || !this.host) {
      return;
    }

    const socket = new net.Socket();
    this.socket = socket;
    socket.setKeepAlive(true, 10000);

    socket.on('connect', () => {
      this.isConnected = true;
      this.log.info(`[TargetForwarder] Connected to target device at ${this.host}:${this.port}`);
      this.sendRaw('id HomebridgeAppleTV');
      this.sendRaw('send_profile');
    });

    socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        this.parseLine(line);
      }
    });

    socket.on('error', () => {
      // Quietly handle when target device is in standby
    });

    socket.on('close', () => {
      this.isConnected = false;
      this.socket = null;
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    socket.connect(this.port, this.host);
  }

  private parseLine(line: string): void {
    const profileMatch = line.match(/^(?:CURRENT_PROFILE|PROFILE)\s+(\d+)$/i);
    if (profileMatch) {
      this.currentProfileId = parseInt(profileMatch[1], 10);
    }
  }

  public sendRaw(command: string): void {
    if (this.socket && this.isConnected) {
      this.socket.write(`${command}\n`);
    }
  }

  public stepVolumeUp(): void {
    this.log.info(`[TargetForwarder] Volume UP (+${this.stepDb} dB)`);
    this.sendRaw(`dvolume ${this.stepDb}`);
  }

  public stepVolumeDown(): void {
    this.log.info(`[TargetForwarder] Volume DOWN (-${this.stepDb} dB)`);
    this.sendRaw(`dvolume -${this.stepDb}`);
  }

  public toggleMute(): void {
    this.log.info('[TargetForwarder] Toggle Mute');
    this.sendRaw('mute 2');
  }

  public async handleAppleTvPowerOn(): Promise<void> {
    if (!this.syncPowerOn) {
      return;
    }
    if (!this.isConnected && this.mac) {
      this.log.info(`[TargetForwarder] Waking target device via WoL (${this.mac})`);
      await this.sendWakeOnLan(this.mac);
    }
    if (typeof this.appleTvProfileId === 'number') {
      this.log.info(`[TargetForwarder] Selecting Apple TV Profile ${this.appleTvProfileId} on target device`);
      this.sendRaw(`profile ${this.appleTvProfileId}`);
    }
  }

  public handleAppleTvPowerOff(): void {
    if (!this.syncPowerOff) {
      return;
    }
    // Source-aware guard: if appleTvProfileId is configured and the target device is currently on a DIFFERENT profile/input,
    // do not shut off the target device when Apple TV idle-sleeps!
    if (
      typeof this.appleTvProfileId === 'number' &&
      this.currentProfileId !== null &&
      this.currentProfileId !== this.appleTvProfileId
    ) {
      this.log.info(
        `[TargetForwarder] Apple TV slept, but target device is on Profile ${this.currentProfileId} (not Apple TV Profile ${this.appleTvProfileId}). Leaving target device ON.`,
      );
      return;
    }

    this.log.info('[TargetForwarder] Powering OFF target device');
    this.sendRaw('power_off_SECURED_FHZMCH48FE');
    this.sendRaw('power_off');
  }

  private sendWakeOnLan(macAddress: string): Promise<void> {
    return new Promise((resolve) => {
      const cleaned = macAddress.replace(/[^0-9a-fA-F]/g, '');
      if (cleaned.length !== 12) {
        resolve();
        return;
      }
      const macBytes = Buffer.from(cleaned, 'hex');
      const packet = Buffer.alloc(6 + 16 * 6, 0xff);
      for (let i = 0; i < 16; i++) {
        macBytes.copy(packet, 6 + i * 6);
      }
      const udp = dgram.createSocket('udp4');
      udp.once('error', () => {
        udp.close();
        resolve();
      });
      udp.bind(() => {
        udp.setBroadcast(true);
        udp.send(packet, 0, packet.length, 9, '255.255.255.255', () => {
          udp.close();
          resolve();
        });
      });
    });
  }
}
