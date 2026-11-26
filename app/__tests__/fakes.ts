/** Shared test doubles: simulated clock and in-memory radios on a shared "air". */
import type {
  ConnectionState,
  RadioAck,
  RadioInterface,
  RadioPacket,
  SendOptions,
} from '../src/radio/RadioInterface';
import type { Scheduler } from '../src/delivery/engine';
import { BROADCAST_ADDR } from '../src/radio/meshtastic/constants';

export class Clock implements Scheduler {
  t = 1_700_000_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private id = 0;
  settle: () => Promise<void> = async () => undefined;
  now() {
    return this.t;
  }
  schedule(at: number, fn: () => void) {
    const id = this.id++;
    this.timers.push({ at, fn, id });
    return () => {
      this.timers = this.timers.filter(x => x.id !== id);
    };
  }
  async advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
      await this.settle();
    }
    this.t = target;
    await this.settle();
  }
}

/** Radios sharing one "air": unicast to a node, or broadcast to everyone. */
export class Air {
  radios: FakeRadio[] = [];
}

export class FakeRadio implements RadioInterface {
  connectionState: ConnectionState = 'ready';
  sent: { to: number; payload: Uint8Array }[] = [];
  inRange = true;
  private rx = new Set<(p: RadioPacket) => void>();
  private ax = new Set<(a: RadioAck) => void>();
  private sx = new Set<(s: ConnectionState) => void>();
  hx = new Set<(n: number, at: number) => void>();
  private next = 1;
  constructor(readonly localNode: number, private readonly air: Air) {
    air.radios.push(this);
  }
  async send(payload: Uint8Array, to: number, o: SendOptions = {}) {
    if (this.connectionState !== 'ready') throw new Error('not ready');
    const packetId = this.localNode * 100_000 + this.next++;
    this.sent.push({ to, payload });
    Promise.resolve().then(() => {
      for (const r of this.air.radios) {
        if (r === this || !this.inRange || !r.inRange) continue;
        if (to !== BROADCAST_ADDR && to !== r.localNode) continue;
        if (o.wantAck)
          this.ax.forEach(l => l({ packetId, from: r.localNode, ok: true }));
        r.rx.forEach(l => l({ from: this.localNode, to, packetId, payload }));
      }
    });
    return packetId;
  }
  setState(s: ConnectionState) {
    this.connectionState = s;
    this.sx.forEach(l => l(s));
  }
  onReceive(l: (p: RadioPacket) => void) {
    this.rx.add(l);
    return () => this.rx.delete(l);
  }
  onAck(l: (a: RadioAck) => void) {
    this.ax.add(l);
    return () => this.ax.delete(l);
  }
  onConnectionState(l: (s: ConnectionState) => void) {
    this.sx.add(l);
    return () => this.sx.delete(l);
  }
  onHeard(l: (n: number, at: number) => void) {
    this.hx.add(l);
    return () => this.hx.delete(l);
  }
}
