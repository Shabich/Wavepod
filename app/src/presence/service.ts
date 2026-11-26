/**
 * Presence: "vu il y a X min" is the last authenticated or radio signal from a
 * contact, never "online". Sources: messages and acks (delivery engine), presence
 * beacons, and any packet heard from the contact's module (unauthenticated hint).
 *
 * Also exchanges beacon keys (Hello) and runs our own beacon, unless in discreet
 * mode, which stops every spontaneous transmission (beacon and probe).
 */
import type { DeliveryEngine, Scheduler } from '../delivery/engine';
import type { WavepodIdentity } from '../crypto/identity';
import type {
  RadioInterface,
  RadioPacket,
  Unsubscribe,
} from '../radio/RadioInterface';
import { BROADCAST_ADDR } from '../radio/meshtastic/constants';
import type { ContactsRepository } from '../storage/contacts';
import type { MetaRepository } from '../storage/meta';
import { encodeBeacon, isBeacon, matchBeacon, nextBeaconDelay } from './beacon';

export const BEACON_INTERVALS_MIN = [15, 20, 30] as const;
export type BeaconInterval = (typeof BEACON_INTERVALS_MIN)[number];

/** Shared with the delivery engine (allowProbe). */
export interface PresenceSettings {
  discreet: boolean;
  intervalMin: BeaconInterval;
}

export interface PresenceDeps {
  me: WavepodIdentity;
  radio: RadioInterface;
  engine: DeliveryEngine;
  contacts: ContactsRepository;
  meta: MetaRepository;
  settings: PresenceSettings;
  scheduler: Scheduler;
  random?: () => number;
  log?: (line: string) => void;
}

const DISCREET = 'presence_discreet';
const INTERVAL = 'presence_interval_min';
/** Radio hints closer than this to the last signal are ignored (packet bursts). */
const HEARD_THROTTLE_MS = 30_000;
/** First beacon after the module becomes ready. */
const FIRST_BEACON_MS = [5_000, 30_000];

export class PresenceService {
  private subscriptions: Unsubscribe[] = [];
  private cancelBeacon: (() => void) | null = null;
  private lastSignal = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  lastBeaconAt: number | null = null;
  nextBeaconAt: number | null = null;

  constructor(private readonly d: PresenceDeps) {}

  get settings(): Readonly<PresenceSettings> {
    return this.d.settings;
  }

  async start() {
    const discreet = await this.d.meta.get(DISCREET);
    const interval = Number(await this.d.meta.get(INTERVAL));
    this.d.settings.discreet = discreet === '1';
    if ((BEACON_INTERVALS_MIN as readonly number[]).includes(interval)) {
      this.d.settings.intervalMin = interval as BeaconInterval;
    }
    const r = this.d.radio;
    this.subscriptions = [
      r.onReceive(p => this.serial(() => this.onPacket(p))),
      r.onConnectionState(s => {
        if (s === 'ready') {
          this.serial(() => this.sendPendingHellos());
          this.scheduleBeacon(this.firstBeaconDelay());
        } else {
          this.unscheduleBeacon();
        }
      }),
      this.d.engine.onEvent(e => {
        if (e.kind === 'hello') {
          this.serial(async () => {
            await this.d.contacts.setBeaconKey(e.contactId, e.beaconKey);
            this.log(`beacon key received from ${e.contactId}`);
          });
        } else if (e.kind === 'contact') {
          // New contacts get our Hello as soon as they are known.
          this.serial(() => this.sendPendingHellos());
        }
      }),
    ];
    if (r.onHeard) {
      this.subscriptions.push(
        r.onHeard((n, at) => this.serial(() => this.onHeard(n, at))),
      );
    }
    await this.sendPendingHellos();
    if (r.connectionState === 'ready')
      this.scheduleBeacon(this.firstBeaconDelay());
  }

  stop() {
    this.subscriptions.forEach(u => u());
    this.subscriptions = [];
    this.unscheduleBeacon();
  }

  /** Waits for queued work (tests). */
  idle() {
    return this.queue.then(() => undefined);
  }

  async setDiscreet(discreet: boolean) {
    this.d.settings.discreet = discreet;
    await this.d.meta.set(DISCREET, discreet ? '1' : '0');
    if (discreet) this.unscheduleBeacon();
    else if (this.d.radio.connectionState === 'ready') {
      this.scheduleBeacon(this.firstBeaconDelay());
    }
  }

  async setInterval(minutes: BeaconInterval) {
    this.d.settings.intervalMin = minutes;
    await this.d.meta.set(INTERVAL, String(minutes));
    if (this.nextBeaconAt !== null) this.scheduleBeacon(this.intervalDelay());
  }

  // ---------------------------------------------------------------- internals

  private serial<T>(fn: () => Promise<T>) {
    const run = this.queue.then(fn);
    this.queue = run.catch(e => this.log(`presence error: ${String(e)}`));
    return run;
  }

  private async onPacket(p: RadioPacket) {
    if (!isBeacon(p.payload)) return;
    const now = this.d.scheduler.now();
    const known = (await this.d.contacts.list()).filter(c => c.beaconKey);
    const contact = matchBeacon(p.payload, known, now);
    if (!contact) return;
    this.lastSignal.set(contact.id, now);
    await this.d.engine.signal(contact.id, p.from, now);
  }

  private async onHeard(nodeNum: number, at: number) {
    const now = this.d.scheduler.now();
    const when = Math.min(at, now);
    for (const c of await this.d.contacts.findByNodeNum(nodeNum)) {
      const last = Math.max(this.lastSignal.get(c.id) ?? 0, c.lastSeenAt ?? 0);
      if (when - last < HEARD_THROTTLE_MS) continue;
      this.lastSignal.set(c.id, when);
      await this.d.engine.signal(c.id, nodeNum, when);
    }
  }

  private async sendPendingHellos() {
    const now = this.d.scheduler.now();
    for (const c of await this.d.contacts.list()) {
      if (c.helloSentAt !== null) continue;
      await this.d.contacts.markHelloSent(c.id, now);
      await this.d.engine.sendHello(c.id, this.d.me.beaconKey);
      this.log(`hello queued for ${c.name}`);
    }
  }

  private firstBeaconDelay() {
    const [lo, hi] = FIRST_BEACON_MS;
    return Math.round(lo + (this.d.random ?? Math.random)() * (hi - lo));
  }

  private intervalDelay() {
    return nextBeaconDelay(this.d.settings.intervalMin * 60_000, this.d.random);
  }

  private scheduleBeacon(delayMs: number) {
    this.unscheduleBeacon();
    if (this.d.settings.discreet) return;
    const at = this.d.scheduler.now() + delayMs;
    this.nextBeaconAt = at;
    this.cancelBeacon = this.d.scheduler.schedule(at, () => {
      this.cancelBeacon = null;
      this.serial(() => this.beacon());
    });
  }

  private unscheduleBeacon() {
    this.cancelBeacon?.();
    this.cancelBeacon = null;
    this.nextBeaconAt = null;
  }

  private async beacon() {
    if (this.d.settings.discreet || this.d.radio.connectionState !== 'ready') {
      this.nextBeaconAt = null;
      return;
    }
    const now = this.d.scheduler.now();
    try {
      await this.d.radio.send(
        encodeBeacon(this.d.me.beaconKey, now),
        BROADCAST_ADDR,
        {
          wantAck: false,
        },
      );
      this.lastBeaconAt = now;
    } catch (e) {
      this.log(`beacon failed: ${String(e)}`);
    }
    this.scheduleBeacon(this.intervalDelay());
  }

  private log(line: string) {
    this.d.log?.(line);
  }
}
