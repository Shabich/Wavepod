import { DeliveryEngine } from '../src/delivery/engine';
import {
  PresenceService,
  type PresenceSettings,
} from '../src/presence/service';
import { isBeacon, encodeBeacon } from '../src/presence/beacon';
import { BROADCAST_ADDR } from '../src/radio/meshtastic/constants';
import {
  identityFromMasterSeed,
  newMasterSeed,
  type WavepodIdentity,
} from '../src/crypto/identity';
import { migrate } from '../src/storage/migrations';
import { MetaRepository } from '../src/storage/meta';
import { NodeSqliteDatabase } from './nodeSqlite';
import { tick } from './helpers';
import { Air, Clock, FakeRadio } from './fakes';

const MIN = 60_000;

interface Phone {
  id: WavepodIdentity;
  radio: FakeRadio;
  engine: DeliveryEngine;
  presence: PresenceService;
  settings: PresenceSettings;
  meta: MetaRepository;
  db: NodeSqliteDatabase;
  peerId: string;
}

async function setup(opts: { discreetA?: boolean; seen?: boolean } = {}) {
  const clock = new Clock();
  const air = new Air();
  let r = 0.5;
  const random = () => (r = ((r * 9301 + 49297) % 233280) / 233280);
  const phone = async (node: number): Promise<Phone> => {
    const db = new NodeSqliteDatabase();
    await migrate(db);
    const id = identityFromMasterSeed(newMasterSeed());
    const radio = new FakeRadio(node, air);
    const settings: PresenceSettings = { discreet: false, intervalMin: 20 };
    const engine = new DeliveryEngine({
      radio,
      me: id.box,
      db,
      scheduler: clock,
      allowProbe: () => !settings.discreet,
    });
    const meta = new MetaRepository(db);
    const presence = new PresenceService({
      me: id,
      radio,
      engine,
      contacts: engine.contacts,
      meta,
      settings,
      scheduler: clock,
      random,
    });
    return { id, radio, engine, presence, settings, meta, db, peerId: '' };
  };
  const a = await phone(0xa);
  const b = await phone(0xb);
  if (opts.discreetA) await a.meta.set('presence_discreet', '1');
  a.peerId = (
    await a.engine.contacts.upsert({
      publicKey: b.id.box.publicKey,
      name: 'B',
      nodeNum: 0xb,
    })
  ).id;
  b.peerId = (
    await b.engine.contacts.upsert({
      publicKey: a.id.box.publicKey,
      name: 'A',
      nodeNum: 0xa,
    })
  ).id;
  if (opts.seen !== false) {
    await a.engine.contacts.markSeen(a.peerId, 0xb, clock.t);
    await b.engine.contacts.markSeen(b.peerId, 0xa, clock.t);
  }
  clock.settle = async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.all([
        a.engine.idle(),
        b.engine.idle(),
        a.presence.idle(),
        b.presence.idle(),
      ]);
      await tick();
    }
  };
  for (const p of [a, b]) {
    p.engine.start();
    await p.presence.start();
  }
  await clock.settle();
  return { clock, a, b };
}

const beacons = (p: Phone) =>
  p.radio.sent.filter(s => isBeacon(s.payload)).length;

describe('PresenceService', () => {
  it('exchanges beacon keys with a Hello after adding a contact', async () => {
    const { clock, a, b } = await setup();
    await clock.advance(MIN);
    expect((await a.engine.contacts.get(a.peerId))?.beaconKey).toEqual(
      b.id.beaconKey,
    );
    expect((await b.engine.contacts.get(b.peerId))?.beaconKey).toEqual(
      a.id.beaconKey,
    );
    // Hello is not a chat message.
    expect(await a.engine.messages.listForContact(a.peerId)).toEqual([]);
    // Sent only once.
    const helloCount = a.radio.sent.length;
    await clock.advance(MIN);
    expect(
      a.radio.sent.filter(s => !isBeacon(s.payload)).length,
    ).toBeLessThanOrEqual(helloCount);
  });

  it('beacons at the chosen interval with jitter', async () => {
    const { clock, a } = await setup();
    await clock.advance(3 * 60 * MIN);
    // 20 min ± 25 % over 3 h, plus the first beacon after connection.
    expect(beacons(a)).toBeGreaterThanOrEqual(8);
    expect(beacons(a)).toBeLessThanOrEqual(13);
    expect(
      a.radio.sent
        .filter(s => isBeacon(s.payload))
        .every(s => s.to === BROADCAST_ADDR),
    ).toBe(true);
  });

  it('refreshes "seen" from a contact beacon', async () => {
    const { clock, a } = await setup();
    await clock.advance(MIN); // keys exchanged, first beacons sent
    const before = (await a.engine.contacts.get(a.peerId))!.lastSeenAt!;
    await clock.advance(30 * MIN);
    const after = (await a.engine.contacts.get(a.peerId))!.lastSeenAt!;
    expect(after).toBeGreaterThan(before);
  });

  it('a beacon makes waiting messages leave', async () => {
    const { clock, a, b } = await setup({ seen: false });
    await clock.advance(MIN);
    // Keys could not be exchanged yet (nobody seen): give B's key directly.
    await a.engine.contacts.setBeaconKey(a.peerId, b.id.beaconKey);
    const id = await a.engine.sendText(a.peerId, 'tu es là ?');
    await clock.settle();
    expect((await a.engine.messages.get(a.peerId, 'out', id))?.status).toBe(
      'pending',
    );
    await clock.advance(30 * MIN); // B beacons
    expect((await a.engine.messages.get(a.peerId, 'out', id))?.status).toBe(
      'delivered',
    );
  });

  it('discreet mode: no spontaneous transmission (beacon, probe), for hours', async () => {
    const { clock, a, b } = await setup({ discreetA: true, seen: false });
    expect(a.presence.settings.discreet).toBe(true);
    b.radio.inRange = false; // nobody to answer: anything A sends would be spontaneous
    const start = a.radio.sent.length;
    await a.engine.sendText(a.peerId, 'en attente');
    await clock.advance(5 * 60 * MIN);
    expect(a.radio.sent.length - start).toBe(0);
  });

  it('discreet mode still answers a contact who shows up', async () => {
    const { clock, a, b } = await setup({ discreetA: true, seen: false });
    const id = await a.engine.sendText(a.peerId, 'quand tu passes');
    await clock.advance(30 * MIN);
    expect((await a.engine.messages.get(a.peerId, 'out', id))?.status).toBe(
      'pending',
    );
    await b.engine.sendText(b.peerId, 'coucou'); // B is not discreet and reaches A
    await b.engine.signal(b.peerId, 0xa);
    await clock.advance(MIN);
    expect((await a.engine.messages.get(a.peerId, 'out', id))?.status).toBe(
      'delivered',
    );
    expect(beacons(a)).toBe(0);
  });

  it('switching discreet off resumes beacons', async () => {
    const { clock, a } = await setup({ discreetA: true });
    await clock.advance(60 * MIN);
    expect(beacons(a)).toBe(0);
    await a.presence.setDiscreet(false);
    await clock.advance(60 * MIN);
    expect(beacons(a)).toBeGreaterThan(0);
    expect(await a.meta.get('presence_discreet')).toBe('0');
  });

  it('any packet heard from the contact module refreshes "seen"', async () => {
    const { clock, a } = await setup({ seen: false });
    a.radio.hx.forEach(l => l(0xb, clock.now()));
    await clock.settle();
    expect((await a.engine.contacts.get(a.peerId))?.lastSeenAt).toBe(
      clock.now(),
    );
    // Old last_heard from the module does not move "seen" backwards.
    a.radio.hx.forEach(l => l(0xb, clock.now() - 60 * MIN));
    await clock.settle();
    expect((await a.engine.contacts.get(a.peerId))?.lastSeenAt).toBe(
      clock.now(),
    );
  });

  it('ignores beacons from strangers', async () => {
    const { clock, a } = await setup({ seen: false });
    const stranger = identityFromMasterSeed(newMasterSeed());
    const air = (a.radio as unknown as { air: Air }).air;
    const s = new FakeRadio(0xc, air);
    await s.send(encodeBeacon(stranger.beaconKey, clock.now()), BROADCAST_ADDR);
    await clock.settle();
    expect((await a.engine.contacts.get(a.peerId))?.lastSeenAt).toBeNull();
  });

  it('stops beaconing while the module is disconnected', async () => {
    const { clock, a } = await setup();
    await clock.advance(MIN);
    const n = beacons(a);
    a.radio.setState('disconnected');
    await clock.advance(2 * 60 * MIN);
    expect(beacons(a)).toBe(n);
    a.radio.setState('ready');
    await clock.advance(MIN);
    expect(beacons(a)).toBe(n + 1);
  });

  it('persists the interval', async () => {
    const { a } = await setup();
    await a.presence.setInterval(30);
    expect(await a.meta.get('presence_interval_min')).toBe('30');
    expect(a.presence.settings.intervalMin).toBe(30);
  });
});
