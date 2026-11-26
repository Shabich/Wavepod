import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  ProfileError,
  decodeProfile,
  defaultAvatar,
  encodeProfile,
} from '../src/profile/avatar';
import { ProfileService } from '../src/profile/service';
import { DeliveryEngine } from '../src/delivery/engine';
import { MessageType } from '../src/protocol/codec';
import {
  identityFromMasterSeed,
  newMasterSeed,
  type WavepodIdentity,
} from '../src/crypto/identity';
import { migrate } from '../src/storage/migrations';
import { MetaRepository } from '../src/storage/meta';
import { decodeHeader } from '../src/protocol/codec';
import { NodeSqliteDatabase } from './nodeSqlite';
import { tick } from './helpers';
import { Air, Clock, FakeRadio } from './fakes';

const MIN = 60_000;

function contrast(a: string, b: string) {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map(
      i => parseInt(h.slice(i, i + 2), 16) / 255,
    );
    const f = (c: number) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('profile message', () => {
  const p = {
    avatar: { icon: 3, color: 5 },
    name: 'Léa 🐬',
    bio: 'Guide de rando, je réponds le soir',
  };

  it('round-trips and stays small', () => {
    const bytes = encodeProfile(p);
    expect(decodeProfile(bytes)).toEqual(p);
    expect(bytes.length).toBeLessThan(130);
  });

  it('enforces limits', () => {
    expect(() => encodeProfile({ ...p, name: ' ' })).toThrow(ProfileError);
    expect(() => encodeProfile({ ...p, name: 'x'.repeat(41) })).toThrow(
      'name too long',
    );
    expect(() => encodeProfile({ ...p, bio: 'é'.repeat(41) })).toThrow(
      'bio too long',
    );
    expect(encodeProfile({ ...p, bio: '' }).length).toBe(5 + 9);
  });

  it('rejects corrupted bodies', () => {
    const bytes = encodeProfile(p);
    expect(() => decodeProfile(bytes.slice(0, -1))).toThrow(ProfileError);
    const v2 = bytes.slice();
    v2[0] = 2;
    expect(() => decodeProfile(v2)).toThrow('unsupported');
  });

  it('falls back for avatar ids from a newer app', () => {
    const bytes = encodeProfile(p);
    bytes[1] = 250;
    bytes[2] = 99;
    expect(decodeProfile(bytes).avatar).toEqual({ icon: 0, color: 0 });
  });
});

describe('avatars', () => {
  it('keep white icons readable on every color', () => {
    for (const c of AVATAR_COLORS) {
      expect(contrast('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('have 30 icons and 8 colors (append only)', () => {
    expect(AVATAR_ICONS).toHaveLength(30);
    expect(AVATAR_ICONS[0]).toBe('fish');
    expect(AVATAR_COLORS[0]).toBe('#4F64AA');
  });

  it('give each contact a stable default', () => {
    expect(defaultAvatar('abc')).toEqual(defaultAvatar('abc'));
    const many = new Set(
      Array.from({ length: 40 }, (_, i) =>
        JSON.stringify(defaultAvatar(`c${i}`)),
      ),
    );
    expect(many.size).toBeGreaterThan(20);
  });
});

interface Phone {
  id: WavepodIdentity;
  radio: FakeRadio;
  engine: DeliveryEngine;
  profile: ProfileService;
  peerId: string;
}

async function setup() {
  const clock = new Clock();
  const air = new Air();
  const phone = async (node: number): Promise<Phone> => {
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
    const profile = new ProfileService({
      myId: id.contactId,
      engine,
      contacts: engine.contacts,
      meta: new MetaRepository(db),
      now: () => clock.now(),
    });
    return { id, radio, engine, profile, peerId: '' };
  };
  const a = await phone(0xa);
  const b = await phone(0xb);
  a.peerId = (
    await a.engine.contacts.upsert({
      publicKey: b.id.box.publicKey,
      name: 'Bea',
      nodeNum: 0xb,
    })
  ).id;
  b.peerId = (
    await b.engine.contacts.upsert({
      publicKey: a.id.box.publicKey,
      name: 'Alex',
      nodeNum: 0xa,
    })
  ).id;
  await b.engine.contacts.setRemoteNameIfMissing(b.peerId, 'Alex');
  await a.engine.contacts.markSeen(a.peerId, 0xb, clock.t);
  await b.engine.contacts.markSeen(b.peerId, 0xa, clock.t);
  clock.settle = async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.all([
        a.engine.idle(),
        b.engine.idle(),
        a.profile.idle(),
        b.profile.idle(),
      ]);
      await tick();
    }
  };
  for (const p of [a, b]) {
    p.engine.start();
    await p.profile.start();
  }
  await clock.settle();
  return { clock, a, b };
}

const profilePackets = (p: Phone) =>
  p.radio.sent.filter(s => {
    try {
      return decodeHeader(s.payload).type === MessageType.Profile;
    } catch {
      return false;
    }
  }).length;

describe('ProfileService', () => {
  it('sends nothing before a name is chosen', async () => {
    const { clock, a } = await setup();
    await clock.advance(MIN);
    expect(profilePackets(a)).toBe(0);
  });

  it('shares the profile with contacts, once per change', async () => {
    const { clock, a, b } = await setup();
    await a.profile.set({
      name: 'Alex',
      bio: 'Au refuge ce soir',
      avatar: { icon: 12, color: 2 },
    });
    await clock.advance(MIN);
    const seen = await b.engine.contacts.get(b.peerId);
    expect(seen).toMatchObject({
      name: 'Alex',
      bio: 'Au refuge ce soir',
      avatar: { icon: 12, color: 2 },
    });
    expect(profilePackets(a)).toBe(1);
    await clock.advance(30 * MIN);
    expect(profilePackets(a)).toBe(1);
    // 31 min later B is no longer "recently seen": a signal (beacon, message) brings it back.
    await a.engine.signal(a.peerId, 0xb);
    await a.profile.set({ avatar: { icon: 0, color: 7 } });
    await clock.advance(MIN);
    expect(profilePackets(a)).toBe(2);
    expect((await b.engine.contacts.get(b.peerId))?.avatar).toEqual({
      icon: 0,
      color: 7,
    });
  });

  it('keeps a local rename but still updates the avatar', async () => {
    const { clock, a, b } = await setup();
    await b.engine.contacts.rename(b.peerId, 'Alex (guide)');
    await a.profile.set({ name: 'Alexandre', avatar: { icon: 5, color: 1 } });
    await clock.advance(MIN);
    expect(await b.engine.contacts.get(b.peerId)).toMatchObject({
      name: 'Alex (guide)',
      remoteName: 'Alexandre',
      avatar: { icon: 5, color: 1 },
    });
  });

  it('follows the contact name when not renamed', async () => {
    const { clock, a, b } = await setup();
    await a.profile.set({ name: 'Alexandre' });
    await clock.advance(MIN);
    expect((await b.engine.contacts.get(b.peerId))?.name).toBe('Alexandre');
  });

  it('returns a default avatar until one is chosen', async () => {
    const { a } = await setup();
    expect((await a.profile.get()).avatar).toEqual(
      defaultAvatar(a.id.contactId),
    );
  });

  it('rejects an invalid profile without saving it', async () => {
    const { a } = await setup();
    await expect(a.profile.set({ name: 'x'.repeat(50) })).rejects.toThrow(
      'too long',
    );
    expect((await a.profile.get()).name).toBe('');
  });
});
