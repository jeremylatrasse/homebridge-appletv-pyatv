"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrinnovForwarder = void 0;
const net = __importStar(require("node:net"));
const dgram = __importStar(require("node:dgram"));
/**
 * Lightweight Trinnov TCP & Wake-on-LAN forwarder so Apple TV Remote
 * Volume Up/Down, Mute, and Power events control the Trinnov directly
 * with zero HomeKit automation lag.
 */
class TrinnovForwarder {
    log;
    socket = null;
    isConnected = false;
    currentProfileId = null;
    reconnectTimer = null;
    stopped = false;
    buffer = '';
    host;
    port;
    mac;
    stepDb;
    appleTvProfileId;
    syncPowerOn;
    syncPowerOff;
    constructor(config, log) {
        this.log = log;
        this.host = config.host;
        this.port = config.port ?? 44100;
        this.mac = config.mac;
        this.stepDb = config.stepDb ?? 1.0;
        this.appleTvProfileId = config.appleTvProfileId;
        this.syncPowerOn = config.syncPowerOn !== false;
        this.syncPowerOff = config.syncPowerOff !== false;
    }
    start() {
        this.stopped = false;
        this.connect();
    }
    stop() {
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
    connect() {
        if (this.stopped || !this.host) {
            return;
        }
        const socket = new net.Socket();
        this.socket = socket;
        socket.setKeepAlive(true, 10000);
        socket.on('connect', () => {
            this.isConnected = true;
            this.log.info(`[TrinnovForwarder] Connected to Trinnov at ${this.host}:${this.port}`);
            this.sendRaw('id HomebridgeAppleTV');
            this.sendRaw('send_profile');
        });
        socket.on('data', (chunk) => {
            this.buffer += chunk.toString('utf8');
            let idx;
            while ((idx = this.buffer.indexOf('\n')) !== -1) {
                const line = this.buffer.slice(0, idx).trim();
                this.buffer = this.buffer.slice(idx + 1);
                this.parseLine(line);
            }
        });
        socket.on('error', () => {
            // Quietly handle when Trinnov is in standby
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
    parseLine(line) {
        const profileMatch = line.match(/^(?:CURRENT_PROFILE|PROFILE)\s+(\d+)$/i);
        if (profileMatch) {
            this.currentProfileId = parseInt(profileMatch[1], 10);
        }
    }
    sendRaw(command) {
        if (this.socket && this.isConnected) {
            this.socket.write(`${command}\n`);
        }
    }
    stepVolumeUp() {
        this.log.info(`[TrinnovForwarder] Volume UP (+${this.stepDb} dB)`);
        this.sendRaw(`dvolume ${this.stepDb}`);
    }
    stepVolumeDown() {
        this.log.info(`[TrinnovForwarder] Volume DOWN (-${this.stepDb} dB)`);
        this.sendRaw(`dvolume -${this.stepDb}`);
    }
    toggleMute() {
        this.log.info('[TrinnovForwarder] Toggle Mute');
        this.sendRaw('mute 2');
    }
    async handleAppleTvPowerOn() {
        if (!this.syncPowerOn) {
            return;
        }
        if (!this.isConnected && this.mac) {
            this.log.info(`[TrinnovForwarder] Waking Trinnov via WoL (${this.mac})`);
            await this.sendWakeOnLan(this.mac);
        }
        if (typeof this.appleTvProfileId === 'number') {
            this.log.info(`[TrinnovForwarder] Selecting Apple TV Profile ${this.appleTvProfileId} on Trinnov`);
            this.sendRaw(`profile ${this.appleTvProfileId}`);
        }
    }
    handleAppleTvPowerOff() {
        if (!this.syncPowerOff) {
            return;
        }
        // Source-aware guard: if appleTvProfileId is configured and the Trinnov is currently on a DIFFERENT profile
        // (e.g. listening to Roon or watching Kaleidescape), do not shut off the Trinnov when Apple TV idle-sleeps!
        if (typeof this.appleTvProfileId === 'number' &&
            this.currentProfileId !== null &&
            this.currentProfileId !== this.appleTvProfileId) {
            this.log.info(`[TrinnovForwarder] Apple TV slept, but Trinnov is on Profile ${this.currentProfileId} (not Apple TV Profile ${this.appleTvProfileId}). Leaving Trinnov ON.`);
            return;
        }
        this.log.info('[TrinnovForwarder] Powering OFF Trinnov');
        this.sendRaw('power_off_SECURED_FHZMCH48FE');
        this.sendRaw('power_off');
    }
    sendWakeOnLan(macAddress) {
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
exports.TrinnovForwarder = TrinnovForwarder;
//# sourceMappingURL=trinnovForwarder.js.map