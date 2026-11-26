import { randomBytes } from '@noble/hashes/utils.js';
import {
  MAX_GROUP_TEXT,
  decodeGroupAck,
  decodeGroupCopy,
  decodeGroupText,
  decodeInvite,
  decodeRoster,
  encodeGroupAck,
  encodeGroupCopy,
  encodeGroupText,
  encodeInvite,
  encodeRoster,
  truncateUtf8,
} from '../src/groups/codec';
import { GroupService } from '../src/groups/service';
import { DeliveryEngine } from '../src/delivery/engine';
import { MessageType, decodeHeader } from '../src/protocol/codec';
import {
  identityFromMasterSeed,
  newMasterSeed,
  type WavepodIdentity,
} from '../src/crypto/identity';
import { migrate } from '../src/storage/migrations';
import { GroupsRepository, ME } from '../src/storage/groups';
import { NodeSqliteDatabase } from './nodeSqlite';
import { tick } from './helpers';
import { Air, Clock, FakeRadio } from './fakes';

const MIN = 60_000;
const id8 = 'a1b2c3d4e5f60718';

describe('group codec', () => {
  it('round-trips every body', () => {
    const key = randomBytes(32);
    expect(
      decodeInvite(encodeInvite({ groupId: id8, key, name: 'Cordée 🧗' })),
    ).toEqual({
      groupId: id8,
      key,
      name: 'Cordée 🧗',
    });
    const members = [0, 1, 2].map(i => ({
      publicKey: randomBytes(32),
      nodeNum: 0xcc000000 + i,
      avatar: { icon: i, color: 7 - i },
      name: `Membre ${i}`,
    }));
    const roster = encodeRoster(id8, members);
    expect(roster.length).toBeLessThanOrEqual(169);
    expect(decodeRoster(roster)).toEqual({ groupId: id8, members });
    expect(decodeGroupText(encodeGroupText(id8, 'salut'))).toEqual({
      senderId: id8,
      text: 'salut',
    });
    expect(decodeGroupAck(encodeGroupAck(id8, [1, 0xffffffff]))).toEqual({
      ackerId: id8,
      messageIds: [1, 0xffffffff],
    });
    const copy = {
      groupId: id8,
      messageId: 42,
      senderId: id8,
      text: 'x'.repeat(MAX_GROUP_TEXT),
    };
    expect(encodeGroupCopy(copy).length).toBe(169);
    expect(decodeGroupCopy(encodeGroupCopy(copy))).toEqual(copy);
  });

  it('truncates roster names on character boundaries', () => {
    expect(truncateUtf8('ééééééééé', 12)).toBe('éééééé');
    const long = encodeRoster(id8, [
      {
        publicKey: randomBytes(32),
        nodeNum: 1,
        avatar: { icon: 0, color: 0 },
        name: 'Alexandre-Émile',
      },
    ]);
    // 'É' takes 2 bytes: 'Alexandre-É' is exactly 12 bytes.
    expect(decodeRoster(long).members[0].name).toBe('Alexandre-É');
  });

  it('rejects malformed bodies and oversized text', () => {
    expect(() => encodeGroupText(id8, 'x'.repeat(MAX_GROUP_TEXT + 1))).toThrow(
      'too long',
    );
    const roster = encodeRoster(id8, [
      {
        publicKey: randomBytes(32),
        nodeNum: 1,
        avatar: { icon: 0, color: 0 },
        name: 'a',
      },
    ]);
    expect(() => decodeRoster(roster.slice(0, -1))).toThrow();
    expect(() => decodeInvite(new Uint8Array(10))).toThrow();
  });
});

interface Phone {
  id: WavepodIdentity;
  radio: FakeRadio;
  engine: DeliveryEngine;
  groups: GroupService;
  repo: GroupsRepository;
  db: NodeSqliteDatabase;
}

async function setup() {
  const clock = new Clock();
  const air = new Air();
  const phone = async (node: number, name: string): Promise<Phone> => {
    const db = new NodeSqliteDatabase();
    await migrate(db);
    const id = identityFromMasterSeed(newMasterSeed());
    const radio = new FakeRadio(node, air);
    const engine = new DeliveryEngine({
      radio,
      me: id.box,
      db,
      scheduler: clock,
    });
    const repo = new GroupsRepository(db);
    const groups = new GroupService({
      me: id,
      radio,
      engine,
      contacts: engine.contacts,
      groups: repo,
      myProfile: async () => ({ name, avatar: { icon: node % 30, color: 1 } }),
      scheduler: clock,
    });
    return { id, radio, engine, groups, repo, db };
  };
  const a = await phone(0xa, 'Alex');
  const b = await phone(0xb, 'Bea');
  const c = await phone(0xc, 'Chloé');
  // A knows B and C; B and C only know A (they will learn each other from the roster).
  const link = async (x: Phone, y: Phone, node: number, name: string) => {
    const contact = await x.engine.contacts.upsert({
      publicKey: y.id.box.publicKey,
      name,
      nodeNum: node,
    });
    await x.engine.contacts.markSeen(contact.id, node, clock.t);
    return contact.id;
  };
  const aB = await link(a, b, 0xb, 'Bea');
  const aC = await link(a, c, 0xc, 'Chloé');
  await link(b, a, 0xa, 'Alex');
  await link(c, a, 0xa, 'Alex');
  const all = [a, b, c];
  clock.settle = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.all(all.flatMap(p => [p.engine.idle(), p.groups.idle()]));
      await tick();
    }
  };
  for (const p of all) {
    p.engine.start();
    await p.groups.start();
  }
  const group = await a.groups.createGroup('Cordée', [aB, aC]);
  await clock.advance(MIN);
  return { clock, a, b, c, group, aB, aC };
}

const broadcasts = (p: Phone) =>
  p.radio.sent.filter(s => {
    try {
      return decodeHeader(s.payload).type === MessageType.GroupMessage;
    } catch {
      return false;
    }
  });

const texts = async (p: Phone, groupId: string) =>
  (await p.repo.messages(groupId)).map(m => m.body);

describe('GroupService', () => {
  it('invites members, who learn each other as hidden contacts', async () => {
    const { b, c, group } = await setup();
    for (const p of [b, c]) {
      const g = await p.repo.get(group.id);
      expect(g?.name).toBe('Cordée');
      expect(await p.repo.members(group.id)).toHaveLength(2);
    }
    const cOnB = await b.engine.contacts.get(c.id.contactId);
    expect(cOnB).toMatchObject({ hidden: true, name: 'Chloé', nodeNum: 0xc });
    expect((await b.engine.contacts.listVisible()).map(x => x.name)).toEqual([
      'Alex',
    ]);
  });

  it('delivers with one broadcast and collects every ack', async () => {
    const { clock, a, b, c, group } = await setup();
    const id = await a.groups.send(group.id, 'On part à 8 h');
    await clock.settle();
    expect(broadcasts(a)).toHaveLength(1);
    expect(await texts(b, group.id)).toEqual(['On part à 8 h']);
    expect(await texts(c, group.id)).toEqual(['On part à 8 h']);
    expect(await a.groups.deliveryOf(group.id, id)).toEqual({
      delivered: 2,
      total: 2,
    });
    // No DM copy afterwards.
    const before = a.radio.sent.length;
    await clock.advance(10 * MIN);
    expect(a.radio.sent.length).toBe(before);
  });

  it('sends a DM copy to a member who missed the broadcast', async () => {
    const { clock, a, c, group, aC } = await setup();
    c.radio.inRange = false;
    const id = await a.groups.send(group.id, 'Rendez-vous au col');
    await clock.advance(MIN);
    expect(await a.groups.deliveryOf(group.id, id)).toEqual({
      delivered: 1,
      total: 2,
    });
    await clock.advance(2 * MIN); // fallback delay: copy queued, C still away
    expect(await texts(c, group.id)).toEqual([]);
    c.radio.inRange = true;
    await a.engine.signal(aC, 0xc); // C heard again
    // The copy left while C was away: its retry schedule (+30 s, +2 min…) brings it.
    await clock.advance(3 * MIN);
    expect(await texts(c, group.id)).toEqual(['Rendez-vous au col']);
    expect(await a.groups.deliveryOf(group.id, id)).toEqual({
      delivered: 2,
      total: 2,
    });
  });

  it('a late ack cancels the pending copy', async () => {
    const { clock, a, c, group, aC } = await setup();
    c.radio.inRange = false;
    const id = await a.groups.send(group.id, 'tard');
    await clock.advance(3 * MIN); // copy queued but C unreachable
    const copyQueued = (await a.repo.receipts(group.id, id)).find(
      r => r.memberId === aC,
    );
    expect(copyQueued?.copyId).not.toBeNull();
    // C gets the broadcast some other way (e.g. relayed later) and acks it.
    c.radio.inRange = true;
    const sentBefore = a.radio.sent.length;
    await (
      c.groups as unknown as { onPacket(p: unknown): Promise<void> }
    ).onPacket({
      from: 0xa,
      to: 0xffffffff,
      packetId: 1,
      payload: broadcasts(a)[0].payload,
    });
    await clock.settle();
    expect(await a.groups.deliveryOf(group.id, id)).toEqual({
      delivered: 2,
      total: 2,
    });
    await a.engine.signal(aC, 0xc);
    await clock.advance(5 * MIN);
    // The copy was cancelled: C still has the message once.
    expect(await texts(c, group.id)).toEqual(['tard']);
    expect(a.radio.sent.length - sentBefore).toBeLessThanOrEqual(0);
  });

  it('lets a member write to the group without knowing the others', async () => {
    const { clock, b, c, group } = await setup();
    const id = await b.groups.send(group.id, 'Je suis au refuge');
    await clock.settle();
    expect(await texts(c, group.id)).toEqual(['Je suis au refuge']);
    const msg = (await c.repo.messages(group.id))[0];
    expect(msg.sender).toBe(b.id.contactId);
    expect(await b.groups.deliveryOf(group.id, id)).toEqual({
      delivered: 2,
      total: 2,
    });
  });

  it('stores a repeated broadcast once', async () => {
    const { clock, a, b, group } = await setup();
    await a.groups.send(group.id, 'une fois');
    await clock.settle();
    await (
      b.groups as unknown as { onPacket(p: unknown): Promise<void> }
    ).onPacket({
      from: 0xa,
      to: 0xffffffff,
      packetId: 2,
      payload: broadcasts(a)[0].payload,
    });
    await clock.settle();
    expect(await texts(b, group.id)).toEqual(['une fois']);
  });

  it('refuses oversized text and unknown members', async () => {
    const { a, group } = await setup();
    await expect(
      a.groups.send(group.id, 'x'.repeat(MAX_GROUP_TEXT + 1)),
    ).rejects.toThrow();
    await expect(
      a.groups.createGroup('X', ['0000000000000000']),
    ).rejects.toThrow('unknown contact');
  });

  it('still sends the copy after an app restart', async () => {
    const { clock, a, c, group } = await setup();
    c.radio.inRange = false;
    const id = await a.groups.send(group.id, 'après redémarrage');
    await clock.advance(30_000);
    a.groups.stop(); // app killed before the fallback delay
    const restarted = new GroupService({
      me: a.id,
      radio: a.radio,
      engine: a.engine,
      contacts: a.engine.contacts,
      groups: a.repo,
      myProfile: async () => ({ name: 'Alex', avatar: { icon: 0, color: 0 } }),
      scheduler: clock,
    });
    await restarted.start();
    await clock.advance(2 * MIN);
    await restarted.idle();
    const receipt = (await a.repo.receipts(group.id, id)).find(
      r => r.memberId === c.id.contactId,
    );
    expect(receipt?.copyId).not.toBeNull();
  });

  it('own messages are stored as sent by me', async () => {
    const { a, group } = await setup();
    await a.groups.send(group.id, 'moi');
    expect((await a.repo.messages(group.id))[0].sender).toBe(ME);
  });
});
