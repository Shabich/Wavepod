/**
 * Connects modules to the RadioHub, keeps them connected, provisions them for
 * Wavepod and restores their original configuration on request.
 *
 * Supervision: the last module is remembered; after an unexpected disconnection
 * (out of range, module off or rebooted) it is reconnected with growing delays
 * until the user disconnects or picks another module. On iOS, a pending BLE
 * connection request costs nothing and completes when the module reappears.
 *
 * The link factory is injected so the flow can be tested without BLE.
 */
import type { RadioHub } from '../radio/RadioHub';
import type { Unsubscribe } from '../radio/RadioInterface';
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

/** User-facing link state (the hub has the radio-level state). */
export type LinkState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface ModuleManagerOptions {
  connectLink: (deviceId: string) => Promise<BleLink>;
  /** Cancels a pending connection request (BLE requests may wait for the module). */
  cancelConnect?: (deviceId: string) => Promise<void>;
  hub: RadioHub;
  meta: MetaRepository;
  log?: (line: string) => void;
  now?: () => number;
  /** How long to wait for the reboot that follows a configuration change. */
  rebootWaitMs?: number;
  /** How long to keep trying to reconnect after that reboot. */
  reconnectTimeoutMs?: number;
  retryDelayMs?: number;
  syncTimeoutMs?: number;
  /** Delays between reconnection attempts after a loss; the last one repeats. */
  backoffMs?: number[];
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
const backupKey = (node: number) => `module_backup:${node.toString(16)}`;
const LAST_MODULE = 'last_module';

export class ModuleManager {
  private deviceId: string | null = null;
  private name: string | null = null;
  private linkState: LinkState = 'idle';
  private lostAt: number | null = null;
  /** Bumped on every user action; stale reconnection loops stop themselves. */
  private generation = 0;
  /** True while a configuration change makes the module reboot on purpose. */
  private provisioning = false;
  private unwatch: Unsubscribe | null = null;
  private readonly listeners = new Set<(s: LinkState) => void>();
  private readonly o: Required<
    Omit<ModuleManagerOptions, 'log' | 'now' | 'cancelConnect'>
  > & {
    cancelConnect?: (deviceId: string) => Promise<void>;
    log: (line: string) => void;
    now: () => number;
  };

  constructor(options: ModuleManagerOptions) {
    this.o = {
      rebootWaitMs: 20_000,
      reconnectTimeoutMs: 90_000,
      retryDelayMs: 3_000,
      syncTimeoutMs: 20_000,
      backoffMs: [2_000, 5_000, 10_000, 30_000, 60_000],
      log: () => undefined,
      now: () => Date.now(),
      ...options,
    };
  }

  get moduleName() {
    return this.name;
  }

  get state(): LinkState {
    return this.linkState;
  }

  /** When the link was lost (null while connected or idle). */
  get disconnectedSince(): number | null {
    return this.lostAt;
  }

  onStateChange(l: (s: LinkState) => void): Unsubscribe {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Connects to a module chosen by the user and remembers it. */
  async connect(deviceId: string, name: string): Promise<void> {
    if (this.deviceId && this.deviceId !== deviceId) {
      await this.o.cancelConnect?.(this.deviceId);
    }
    await this.release();
    const gen = ++this.generation;
    this.deviceId = deviceId;
    this.name = name;
    await this.o.meta.set(LAST_MODULE, JSON.stringify({ deviceId, name }));
    this.setState('connecting');
    try {
      await this.attach();
      if (gen === this.generation) this.setState('connected');
    } catch (e) {
      if (gen === this.generation) this.setState('idle');
      throw e;
    }
  }

  /** User disconnection: stop supervising and forget the module. */
  async disconnect(): Promise<void> {
    this.generation++;
    if (this.deviceId) await this.o.cancelConnect?.(this.deviceId);
    await this.release();
    this.deviceId = null;
    this.name = null;
    this.lostAt = null;
    await this.o.meta.set(LAST_MODULE, '');
    this.setState('idle');
  }

  /**
   * App start: reconnect to the remembered module in the background.
   * Returns false if there is none.
   */
  async resumeLast(): Promise<boolean> {
    const raw = await this.o.meta.get(LAST_MODULE);
    if (!raw) return false;
    const { deviceId, name } = JSON.parse(raw) as {
      deviceId: string;
      name: string;
    };
    this.deviceId = deviceId;
    this.name = name;
    this.lostAt = this.o.now();
    void this.supervise(++this.generation);
    return true;
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

  private setState(s: LinkState) {
    if (s === this.linkState) return;
    this.linkState = s;
    this.listeners.forEach(l => l(s));
  }

  private requireReady() {
    const a = this.o.hub.adapter;
    if (!a || a.connectionState !== 'ready') throw new Error('no module ready');
    return a;
  }

  /** Detaches and closes the current adapter without triggering supervision. */
  private async release() {
    this.unwatch?.();
    this.unwatch = null;
    const adapter = this.o.hub.adapter;
    this.o.hub.detach();
    await adapter?.stop().catch(() => undefined);
  }

  /** Unexpected loss of the link: reconnect until it works or the user acts. */
  private onLost(gen: number) {
    if (gen !== this.generation || this.provisioning) return;
    this.lostAt = this.o.now();
    this.o.log('module link lost, reconnecting');
    void this.release().then(() => this.supervise(gen));
  }

  private async supervise(gen: number) {
    this.setState('reconnecting');
    for (let attempt = 0; gen === this.generation; attempt++) {
      try {
        await this.attach();
        if (gen !== this.generation) return;
        const down = this.lostAt
          ? Math.round((this.o.now() - this.lostAt) / 1000)
          : 0;
        this.lostAt = null;
        this.setState('connected');
        this.o.log(
          `module reconnected after ${down} s (${attempt + 1} attempt(s))`,
        );
        return;
      } catch {
        const delays = this.o.backoffMs;
        await sleep(delays[Math.min(attempt, delays.length - 1)]);
      }
    }
  }

  private async applyAndReconnect(
    a: MeshtasticAdapter,
    admin: Parameters<MeshtasticAdapter['applyAdmin']>[0],
  ) {
    this.provisioning = true;
    try {
      await a.applyAdmin(admin);
      // The module reboots a moment after the commit: wait for the link to drop.
      const dropped = await this.waitFor(
        () => a.connectionState === 'disconnected',
        this.o.rebootWaitMs,
      );
      if (!dropped) this.o.log('no reboot observed, re-syncing');
      await this.release();
      await this.reconnectAfterReboot();
    } finally {
      this.provisioning = false;
    }
  }

  private async reconnectAfterReboot() {
    const end = Date.now() + this.o.reconnectTimeoutMs;
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        await this.attach();
        this.o.log(`module back after ${attempt} attempt(s)`);
        return;
      } catch (e) {
        if (Date.now() > end) {
          // Hand over to the regular supervision rather than giving up.
          this.lostAt = this.o.now();
          void this.supervise(this.generation);
          throw new Error(`module did not come back: ${String(e)}`);
        }
        await sleep(this.o.retryDelayMs);
      }
    }
  }

  private async attach() {
    if (!this.deviceId) throw new Error('no module selected');
    const gen = this.generation;
    const link = await this.o.connectLink(this.deviceId);
    if (gen !== this.generation) {
      await link.disconnect().catch(() => undefined);
      throw new Error('superseded');
    }
    const adapter = new MeshtasticAdapter(link);
    this.o.hub.attach(adapter);
    try {
      await adapter.start();
      await this.waitFor(
        () =>
          adapter.connectionState === 'ready' ||
          adapter.connectionState === 'disconnected',
        this.o.syncTimeoutMs,
      );
      if (adapter.connectionState !== 'ready') throw new Error('sync failed');
    } catch (e) {
      this.o.hub.detach();
      await adapter.stop().catch(() => undefined);
      throw e;
    }
    this.unwatch?.();
    this.unwatch = adapter.onConnectionState(s => {
      if (s === 'disconnected') this.onLost(gen);
    });
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
