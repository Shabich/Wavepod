import type {
  ConnectionState,
  RadioAck,
  RadioInterface,
  RadioPacket,
  SendOptions,
} from '../src/radio/RadioInterface';
import { DeliveryEngine, type Scheduler } from '../src/delivery/engine';
import { DEFAULT_POLICY as P } from '../src/delivery/policy';
import { generateIdentity, type Identity } from '../src/crypto/envelope';
import { migrate } from '../src/storage/migrations';
import { NodeSqliteDatabase } from './nodeSqlite';
import { tick } from './helpers';

const MIN = 60_000;

class FakeClock implements Scheduler {
  t = 1_700_000_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 0;
  settle: () => Promise<void> = async () => undefined;
  now() {
    return this.t;
  }
  schedule(at: number, fn: () => void) {
    const id = this.nextId++;
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

class FakeRadio implements RadioInterface {
  connectionState: ConnectionState = 'ready';
  peer!: FakeRadio;
  /** Radio link between the two modules. */
  inRange = true;
  /** Phone connected to its module: when false, received packets are lost. */
  phoneConnected = true;
  sent: { to: number; payload: Uint8Array; wantAck: boolean }[] = [];
  private rx = new Set<(p: RadioPacket) => void>();
  private ax = new Set<(a: RadioAck) => void>();
  private sx = new Set<(s: ConnectionState) => void>();
  private nextId = 1;
  constructor(readonly localNode: number) {}

  async send(payload: Uint8Array, to: number, o: SendOptions = {}) {
    if (this.connectionState !== 'ready') throw new Error('not ready');
    const packetId = this.localNode * 100_000 + this.nextId++;
    this.sent.push({ to, payload, wantAck: !!o.wantAck });
    const peer = this.peer;
    Promise.resolve().then(() => {
      if (!this.inRange || to !== peer.localNode) {
        if (o.wantAck)
          this.emitAck({
            packetId,
            from: this.localNode,
            ok: false,
            error: 'MAX_RETRANSMIT',
          });
        return;
      }
      if (o.wantAck) this.emitAck({ packetId, from: peer.localNode, ok: true });
      if (peer.phoneConnected) {
        peer.rx.forEach(l =>
          l({ from: this.localNode, to, packetId, payload }),
        );
      }
    });
    return packetId;
  }
  setState(s: ConnectionState) {
    this.connectionState = s;
    this.sx.forEach(l => l(s));
  }
  private emitAck(a: RadioAck) {
    this.ax.forEach(l => l(a));
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
}

interface Side {
  id: Identity;
  radio: FakeRadio;
  db: NodeSqliteDatabase;
  engine: DeliveryEngine;
  peerId: string;
}

async function setup(opts: { seen?: boolean } = {}) {
  const clock = new FakeClock();
  const make = async (node: number): Promise<Side> => {
    const db = new NodeSqliteDatabase();
    await migrate(db);
    const id = generateIdentity();
    const radio = new FakeRadio(node);
    return {
      id,
      radio,
      db,
      engine: new DeliveryEngine({ radio, me: id, db, scheduler: clock }),
      peerId: '',
    };
  };
  const a = await make(0xa);
  const b = await make(0xb);
  a.radio.peer = b.radio;
  b.radio.peer = a.radio;
  a.peerId = (
    await a.engine.contacts.upsert({
      publicKey: b.id.publicKey,
      name: 'B',
      nodeNum: 0xb,
    })
  ).id;
  b.peerId = (
    await b.engine.contacts.upsert({
      publicKey: a.id.publicKey,
      name: 'A',
      nodeNum: 0xa,
    })
  ).id;
  if (opts.seen !== false) {
    await a.engine.contacts.markSeen(a.peerId, 0xb, clock.t);
    await b.engine.contacts.markSeen(b.peerId, 0xa, clock.t);
  }
  clock.settle = async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.all([a.engine.idle(), b.engine.idle()]);
      await tick();
    }
  };
  a.engine.start();
  b.engine.start();
  await clock.settle();
  return { clock, a, b };
}

const status = async (s: Side, messageId: number) =>
  (await s.engine.messages.get(s.peerId, 'out', messageId))?.status;
const inbox = async (s: Side) =>
  (await s.engine.messages.listForContact(s.peerId)).filter(
    m => m.direction === 'in',
  );
const textsSent = (r: FakeRadio) => r.sent.filter(s => s.wantAck).length;

describe('DeliveryEngine', () => {
  it('delivers to a reachable contact with both acks', async () => {
    const { clock, a, b } = await setup();
    const id = await a.engine.sendText(a.peerId, 'Je fais demi-tour');
    await clock.settle();
    expect(await status(a, id)).toBe('delivered');
    expect((await inbox(b)).map(m => m.body)).toEqual(['Je fais demi-tour']);
    // Outbox emptied: nothing more is ever sent.
    await clock.advance(3 * 60 * MIN);
    expect(textsSent(a.radio)).toBe(1);
  });

  it('marks module ack when the phone of the contact is away', async () => {
    const { clock, a, b } = await setup();
    b.radio.phoneConnected = false;
    const id = await a.engine.sendText(a.peerId, 'hello');
    await clock.settle();
    expect(await status(a, id)).toBe('moduleAck');
  });

  it('does not emit for a contact not seen recently', async () => {
    const { clock, a } = await setup({ seen: false });
    const id = await a.engine.sendText(a.peerId, 'tu es là ?');
    await clock.advance(30 * MIN);
    expect(await status(a, id)).toBe('pending');
    expect(textsSent(a.radio)).toBe(0);
  });

  it('retries a burst at +30 s, +2 min, +5 min, then waits', async () => {
    const { clock, a } = await setup();
    a.radio.inRange = false;
    const id = await a.engine.sendText(a.peerId, 'x');
    await clock.settle();
    expect(textsSent(a.radio)).toBe(1);
    await clock.advance(30_000);
    expect(textsSent(a.radio)).toBe(2);
    await clock.advance(2 * MIN);
    expect(textsSent(a.radio)).toBe(3);
    await clock.advance(5 * MIN);
    expect(textsSent(a.radio)).toBe(4);
    await clock.advance(60 * MIN);
    expect(textsSent(a.radio)).toBe(4); // back to waiting, not failed
    expect(await status(a, id)).toBe('sent');
  });

  it('drains the queue when the contact comes back, in order and without duplicates', async () => {
    const { clock, a, b } = await setup();
    a.radio.inRange = false;
    b.radio.inRange = false;
    const ids = [];
    for (const t of ['un', 'deux', 'trois'])
      ids.push(await a.engine.sendText(a.peerId, t));
    await clock.advance(10 * MIN); // bursts exhausted
    const before = textsSent(a.radio);

    // B comes back in range and says something: any signal drains A's queue.
    a.radio.inRange = true;
    b.radio.inRange = true;
    await b.engine.sendText(b.peerId, 'je suis de retour');
    await clock.advance(2 * MIN);

    for (const id of ids) expect(await status(a, id)).toBe('delivered');
    expect((await inbox(b)).map(m => m.body)).toEqual(['un', 'deux', 'trois']);
    expect(textsSent(a.radio) - before).toBe(3);
  });

  it('spaces consecutive transmissions', async () => {
    const { clock, a } = await setup();
    a.radio.inRange = false;
    await a.engine.sendText(a.peerId, '1');
    await a.engine.sendText(a.peerId, '2');
    await clock.settle();
    expect(textsSent(a.radio)).toBe(1);
    await clock.advance(P.spacingMs);
    expect(textsSent(a.radio)).toBe(2);
  });

  it('probes the oldest message only, every 90 minutes', async () => {
    const { clock, a } = await setup({ seen: false });
    a.radio.inRange = false;
    await a.engine.sendText(a.peerId, 'premier');
    await a.engine.sendText(a.peerId, 'second');
    await clock.advance(89 * MIN);
    expect(textsSent(a.radio)).toBe(0);
    await clock.advance(2 * MIN);
    expect(textsSent(a.radio)).toBe(1);
    await clock.advance(90 * MIN);
    expect(textsSent(a.radio)).toBe(2);
    // Both probes carried the oldest message.
    expect(a.radio.sent[0].payload).toEqual(a.radio.sent[1].payload);
  });

  it('a successful probe drains the rest of the queue', async () => {
    const { clock, a, b } = await setup({ seen: false });
    await a.engine.sendText(a.peerId, 'premier');
    await a.engine.sendText(a.peerId, 'second');
    await clock.advance(91 * MIN);
    expect((await inbox(b)).map(m => m.body)).toEqual(['premier', 'second']);
  });

  it('the probe breaks the deadlock when both sides are silent', async () => {
    const { clock, a, b } = await setup({ seen: false });
    const id = await a.engine.sendText(a.peerId, 'quelqu’un ?');
    await clock.advance(91 * MIN);
    expect(await status(a, id)).toBe('delivered');
    expect(await inbox(b)).toHaveLength(1);
  });

  it('fails at the TTL and can be resent manually', async () => {
    const { clock, a, b } = await setup({ seen: false });
    a.radio.inRange = false;
    const id = await a.engine.sendText(a.peerId, 'tard');
    await clock.advance(P.ttlMs + MIN);
    expect(await status(a, id)).toBe('failed');

    a.radio.inRange = true;
    await a.engine.resend(a.peerId, id);
    await clock.settle();
    expect(await status(a, id)).toBe('delivered');
    expect((await inbox(b)).map(m => m.body)).toEqual(['tard']);
  });

  it('cancels a pending message', async () => {
    const { clock, a } = await setup({ seen: false });
    const id = await a.engine.sendText(a.peerId, 'oups');
    await a.engine.cancel(a.peerId, id);
    await clock.advance(3 * 60 * MIN);
    expect(await a.engine.messages.get(a.peerId, 'out', id)).toBeNull();
    expect(textsSent(a.radio)).toBe(0);
  });

  it('stores a retransmitted message once but acks every copy', async () => {
    const { clock, a, b } = await setup();
    a.radio.inRange = true;
    // Lose the app ack: B's packets do not reach A.
    b.radio.inRange = false;
    await a.engine.sendText(a.peerId, 'une seule fois');
    await clock.advance(31_000);
    expect(textsSent(a.radio)).toBe(2);
    expect(await inbox(b)).toHaveLength(1);
    expect(b.radio.sent.filter(s => !s.wantAck)).toHaveLength(2);
  });

  it('keeps a delivered status when a late radio error arrives', async () => {
    const { clock, a } = await setup();
    const id = await a.engine.sendText(a.peerId, 'ok');
    await clock.settle();
    const packetId = 0xa * 100_000 + 1;
    (a.radio as unknown as { emitAck(x: RadioAck): void }).emitAck({
      packetId,
      from: 0xb,
      ok: false,
      error: 'MAX_RETRANSMIT',
    });
    await clock.settle();
    expect(await status(a, id)).toBe('delivered');
  });

  it('does not consume attempts while the radio is disconnected', async () => {
    const { clock, a } = await setup();
    a.radio.setState('disconnected');
    const id = await a.engine.sendText(a.peerId, 'plus tard');
    await clock.advance(20 * MIN);
    expect(textsSent(a.radio)).toBe(0);
    // Contact still counts as seen within the 25 min window.
    a.radio.setState('ready');
    await clock.settle();
    expect(await status(a, id)).toBe('delivered');
  });

  it('resumes the outbox after a restart', async () => {
    const { clock, a } = await setup({ seen: false });
    const id = await a.engine.sendText(a.peerId, 'persistant');
    a.engine.stop();

    // Same database, new engine instance (app restarted).
    const engine2 = new DeliveryEngine({
      radio: a.radio,
      me: a.id,
      db: a.db,
      scheduler: clock,
    });
    const prev = clock.settle;
    clock.settle = async () => {
      await prev();
      await engine2.idle();
    };
    engine2.start();
    await engine2.signal(a.peerId, 0xb);
    await clock.settle();
    expect((await engine2.messages.get(a.peerId, 'out', id))?.status).toBe(
      'delivered',
    );
  });

  it('ignores packets from unknown senders', async () => {
    const { clock, a, b } = await setup();
    const logs: string[] = [];
    b.engine.onEvent(e => e.kind === 'log' && logs.push(e.line));
    await b.engine.contacts.remove(b.peerId);
    await a.engine.sendText(a.peerId, 'qui suis-je ?');
    await clock.settle();
    expect(logs.some(l => l.includes('unknown sender'))).toBe(true);
    expect(await b.engine.messages.listForContact(b.peerId)).toEqual([]);
  });
});
