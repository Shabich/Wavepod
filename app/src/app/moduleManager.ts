/**
 * Connects modules to the RadioHub, provisions them for Wavepod and restores
 * their original configuration on request. The link factory is injected so the
 * flow can be tested without BLE.
 */
import type { RadioHub } from '../radio/RadioHub';
import {
  MeshtasticAdapter,
  type BleLink,
} from '../radio/meshtastic/MeshtasticAdapter';
import {
  firmwareStatus,
  makeBackup,
  planProvisioning,
  restoreMessages,
  type FirmwareStatus,
  type ModuleBackup,
  type ProvisioningPlan,
} from '../radio/meshtastic/provisioning';
import type { MetaRepository } from '../storage/meta';

export interface ModuleStatus {
  firmware: FirmwareStatus;
  firmwareVersion: string | undefined;
  plan: ProvisioningPlan;
  hasBackup: boolean;
}

export interface ModuleManagerOptions {
  connectLink: (deviceId: string) => Promise<BleLink>;
  hub: RadioHub;
  meta: MetaRepository;
  log?: (line: string) => void;
  /** How long to wait for the reboot that follows a configuration change. */
  rebootWaitMs?: number;
  /** How long to keep trying to reconnect after the reboot. */
  reconnectTimeoutMs?: number;
  retryDelayMs?: number;
  syncTimeoutMs?: number;
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
const backupKey = (node: number) => `module_backup:${node.toString(16)}`;

export class ModuleManager {
  private deviceId: string | null = null;
  private name: string | null = null;
  private readonly o: Required<Omit<ModuleManagerOptions, 'log'>> & {
    log: (line: string) => void;
  };

  constructor(options: ModuleManagerOptions) {
    this.o = {
      rebootWaitMs: 20_000,
      reconnectTimeoutMs: 90_000,
      retryDelayMs: 3_000,
      syncTimeoutMs: 20_000,
      log: () => undefined,
      ...options,
    };
  }

  get moduleName() {
    return this.name;
  }

  async connect(deviceId: string, name: string): Promise<void> {
    await this.disconnect();
    this.deviceId = deviceId;
    this.name = name;
    await this.attach();
  }

  async disconnect(): Promise<void> {
    const adapter = this.o.hub.adapter;
    this.o.hub.detach();
    this.deviceId = null;
    this.name = null;
    await adapter?.stop().catch(() => undefined);
  }

  /** Status of the connected, synced module; null if none. */
  async status(): Promise<ModuleStatus | null> {
    const a = this.o.hub.adapter;
    if (!a || a.connectionState !== 'ready' || a.localNode === undefined)
      return null;
    return {
      firmware: firmwareStatus(a.firmwareVersion),
      firmwareVersion: a.firmwareVersion,
      plan: planProvisioning({
        snapshot: a.snapshot,
        nodeNum: a.localNode,
        owner: a.ownUser(),
      }),
      hasBackup: (await this.o.meta.get(backupKey(a.localNode))) !== null,
    };
  }

  /**
   * Applies Wavepod's configuration. The original configuration is saved first
   * (only once per module, so re-provisioning never overwrites it).
   */
  async provision(): Promise<void> {
    const a = this.requireReady();
    if (firmwareStatus(a.firmwareVersion) === 'too-old') {
      throw new Error(`firmware ${a.firmwareVersion} too old`);
    }
    const node = a.localNode!;
    const plan = planProvisioning({
      snapshot: a.snapshot,
      nodeNum: node,
      owner: a.ownUser(),
    });
    if (plan.admin.length === 0) return;
    if ((await this.o.meta.get(backupKey(node))) === null) {
      await this.o.meta.set(
        backupKey(node),
        JSON.stringify(makeBackup(a.snapshot, a.ownUser())),
      );
    }
    this.o.log(`provisioning ${node.toString(16)}: ${plan.changes.join(', ')}`);
    await this.applyAndReconnect(a, plan.admin);
  }

  async restore(): Promise<void> {
    const a = this.requireReady();
    const raw = await this.o.meta.get(backupKey(a.localNode!));
    if (!raw) throw new Error('no backup for this module');
    const backup = JSON.parse(raw) as ModuleBackup;
    this.o.log(
      `restoring original configuration of ${a.localNode!.toString(16)}`,
    );
    await this.applyAndReconnect(a, restoreMessages(backup));
  }

  // ---------------------------------------------------------------- internals

  private requireReady() {
    const a = this.o.hub.adapter;
    if (!a || a.connectionState !== 'ready') throw new Error('no module ready');
    return a;
  }

  private async applyAndReconnect(
    a: MeshtasticAdapter,
    admin: Parameters<MeshtasticAdapter['applyAdmin']>[0],
  ) {
    await a.applyAdmin(admin);
    // The module reboots a moment after the commit: wait for the link to drop.
    const dropped = await this.waitFor(
      () => a.connectionState === 'disconnected',
      this.o.rebootWaitMs,
    );
    if (!dropped) this.o.log('no reboot observed, re-syncing');
    await a.stop().catch(() => undefined);
    this.o.hub.detach();
    await this.reconnect();
  }

  private async reconnect() {
    const end = Date.now() + this.o.reconnectTimeoutMs;
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        await this.attach();
        this.o.log(`module back after ${attempt} attempt(s)`);
        return;
      } catch (e) {
        if (Date.now() > end)
          throw new Error(`module did not come back: ${String(e)}`);
        await sleep(this.o.retryDelayMs);
      }
    }
  }

  private async attach() {
    if (!this.deviceId) throw new Error('no module selected');
    const link = await this.o.connectLink(this.deviceId);
    const adapter = new MeshtasticAdapter(link);
    this.o.hub.attach(adapter);
    try {
      await adapter.start();
      const ok = await this.waitFor(
        () => adapter.connectionState === 'ready',
        this.o.syncTimeoutMs,
      );
      if (!ok) throw new Error('sync timeout');
    } catch (e) {
      this.o.hub.detach();
      await adapter.stop().catch(() => undefined);
      throw e;
    }
  }

  private async waitFor(cond: () => boolean, ms: number) {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) return false;
      await sleep(50);
    }
    return true;
  }
}
