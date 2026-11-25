import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { ModuleManager } from '../src/app/moduleManager';
import { RadioHub } from '../src/radio/RadioHub';
import type { BleLink } from '../src/radio/meshtastic/MeshtasticAdapter';
import {
  DeviceMetadataSchema,
  FromRadioSchema,
  MyNodeInfoSchema,
  NodeInfoSchema,
  ToRadioSchema,
  UserSchema,
  type MeshPacket,
  type User,
} from '../src/radio/meshtastic/proto/meshtastic/mesh_pb';
import { AdminMessageSchema } from '../src/radio/meshtastic/proto/meshtastic/admin_pb';
import {
  ConfigSchema,
  Config_LoRaConfigSchema,
  Config_LoRaConfig_RegionCode,
  type Config_LoRaConfig,
} from '../src/radio/meshtastic/proto/meshtastic/config_pb';
import { PortNum } from '../src/radio/meshtastic/proto/meshtastic/portnums_pb';
import { MetaRepository } from '../src/storage/meta';
import { migrate } from '../src/storage/migrations';
import { NodeSqliteDatabase } from './nodeSqlite';

const NODE = 0xcc001234;
const fr = (init: Parameters<typeof create<typeof FromRadioSchema>>[1]) =>
  toBinary(FromRadioSchema, create(FromRadioSchema, init));

/** Minimal firmware: config sync, admin transactions, reboot on commit. */
class FakeFirmware {
  lora: Config_LoRaConfig = create(Config_LoRaConfigSchema, {
    region: Config_LoRaConfig_RegionCode.UNSET,
    usePreset: true,
    hopLimit: 3,
    txEnabled: true,
  });
  owner: User = create(UserSchema, {
    longName: 'Meshtastic 1234',
    shortName: '1234',
  });
  firmware = '2.7.26.abc';
  /** Other config sections as stored by the firmware (replayed on sync). */
  extra = new Map<string, Uint8Array>();
  rebooting = false;
  reboots = 0;
  commits = 0;
  private pending: (() => void)[] = [];

  connect = async (): Promise<BleLink> => {
    if (this.rebooting) throw new Error('module not found');
    const queue: Uint8Array[] = [];
    const notify = new Set<() => void>();
    const closed = new Set<() => void>();
    const push = (...frames: Uint8Array[]) => {
      queue.push(...frames);
      notify.forEach(l => l());
    };
    this.onReboot = () => closed.forEach(l => l());
    return {
      writeToRadio: async bytes => {
        const msg = fromBinary(ToRadioSchema, bytes).payloadVariant;
        if (msg.case === 'wantConfigId') {
          push(
            fr({
              payloadVariant: {
                case: 'myInfo',
                value: create(MyNodeInfoSchema, { myNodeNum: NODE }),
              },
            }),
            fr({
              payloadVariant: {
                case: 'metadata',
                value: create(DeviceMetadataSchema, {
                  firmwareVersion: this.firmware,
                }),
              },
            }),
            fr({
              payloadVariant: {
                case: 'nodeInfo',
                value: create(NodeInfoSchema, { num: NODE, user: this.owner }),
              },
            }),
            fr({
              payloadVariant: {
                case: 'config',
                value: create(ConfigSchema, {
                  payloadVariant: { case: 'lora', value: this.lora },
                }),
              },
            }),
            ...this.extra.values(),
            fr({
              payloadVariant: { case: 'configCompleteId', value: msg.value },
            }),
          );
        } else if (msg.case === 'packet') {
          const p = msg.value as MeshPacket;
          const data = p.payloadVariant.value as {
            portnum: number;
            payload: Uint8Array;
          };
          if (data.portnum !== PortNum.ADMIN_APP) return;
          const admin = fromBinary(
            AdminMessageSchema,
            data.payload,
          ).payloadVariant;
          if (admin.case === 'beginEditSettings') this.pending = [];
          else if (
            admin.case === 'setConfig' &&
            admin.value.payloadVariant.case === 'lora'
          ) {
            const lora = admin.value.payloadVariant.value;
            this.pending.push(() => (this.lora = lora));
          } else if (admin.case === 'setConfig') {
            const cfg = admin.value;
            this.pending.push(() =>
              this.extra.set(
                `c:${cfg.payloadVariant.case}`,
                toBinary(
                  FromRadioSchema,
                  create(FromRadioSchema, {
                    payloadVariant: { case: 'config', value: cfg },
                  }),
                ),
              ),
            );
          } else if (admin.case === 'setModuleConfig') {
            const mc = admin.value;
            this.pending.push(() =>
              this.extra.set(
                `m:${mc.payloadVariant.case}`,
                toBinary(
                  FromRadioSchema,
                  create(FromRadioSchema, {
                    payloadVariant: { case: 'moduleConfig', value: mc },
                  }),
                ),
              ),
            );
          } else if (admin.case === 'setOwner') {
            const owner = admin.value;
            this.pending.push(() => (this.owner = owner));
          } else if (admin.case === 'commitEditSettings') {
            this.commits++;
            this.pending.forEach(f => f());
            this.reboot();
          }
        }
      },
      readFromRadio: async () => queue.shift() ?? new Uint8Array(0),
      onFromNum: l => {
        notify.add(l);
        return () => notify.delete(l);
      },
      onDisconnected: l => {
        closed.add(l);
        return () => closed.delete(l);
      },
      disconnect: async () => undefined,
    };
  };

  private onReboot: () => void = () => undefined;

  private reboot() {
    this.reboots++;
    setTimeout(() => {
      this.rebooting = true;
      this.onReboot();
      setTimeout(() => (this.rebooting = false), 60);
    }, 20);
  }
}

async function setup() {
  const db = new NodeSqliteDatabase();
  await migrate(db);
  const fw = new FakeFirmware();
  const hub = new RadioHub();
  const meta = new MetaRepository(db);
  const m = new ModuleManager({
    connectLink: fw.connect,
    hub,
    meta,
    rebootWaitMs: 1_000,
    reconnectTimeoutMs: 2_000,
    retryDelayMs: 20,
    syncTimeoutMs: 1_000,
  });
  return { fw, hub, meta, m };
}

describe('ModuleManager', () => {
  it('provisions a fresh module in one transaction and reconnects after the reboot', async () => {
    const { fw, hub, m } = await setup();
    await m.connect('dev-1', 'T1000-E');
    expect(hub.connectionState).toBe('ready');
    const before = await m.status();
    expect(before?.firmware).toBe('ok');
    expect(before?.plan.changes).toContain('région Europe 868 MHz');

    await m.provision();
    expect(fw.commits).toBe(1);
    expect(fw.reboots).toBe(1);
    expect(fw.lora.region).toBe(Config_LoRaConfig_RegionCode.EU_868);
    expect(fw.owner.longName).toBe('WP-1234');
    expect(hub.connectionState).toBe('ready');
    const after = await m.status();
    expect(after?.plan.changes).toEqual([]);
    expect(after?.hasBackup).toBe(true);
  });

  it('keeps the first backup and restores it', async () => {
    const { fw, meta, m } = await setup();
    await m.connect('dev-1', 'T1000-E');
    await m.provision();
    await m.provision(); // second run must not overwrite the original backup
    const backup = JSON.parse((await meta.get('module_backup:cc001234'))!);
    expect(backup.owner).toBeDefined();
    await m.restore();
    expect(fw.lora.region).toBe(Config_LoRaConfig_RegionCode.UNSET);
    expect(fw.owner.longName).toBe('Meshtastic 1234');
  });

  it('refuses a firmware that is too old', async () => {
    const { fw, m } = await setup();
    fw.firmware = '2.5.9.aaa';
    await m.connect('dev-1', 'Vieux module');
    expect((await m.status())?.firmware).toBe('too-old');
    await expect(m.provision()).rejects.toThrow('too old');
    expect(fw.commits).toBe(0);
  });

  it('does not re-apply anything to a configured module', async () => {
    const { fw, m } = await setup();
    await m.connect('dev-1', 'T1000-E');
    await m.provision();
    expect(fw.commits).toBe(1);
    await m.provision();
    expect(fw.commits).toBe(1);
    expect(fw.reboots).toBe(1);
  });
});
