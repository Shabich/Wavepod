import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  CARD_URL_PREFIX,
  CardError,
  decodeCard,
  encodeCard,
  fromBase64Url,
  toBase64Url,
} from '../src/contacts/card';
import { ContactService } from '../src/contacts/service';
import { identityFromMasterSeed, newMasterSeed } from '../src/crypto/identity';
import { DeliveryEngine } from '../src/delivery/engine';
import {
  decodeSharedContact,
  encodeAddContact,
  encodeSharedContact,
} from '../src/radio/meshtastic/framing';
import {
  ToRadioSchema,
  UserSchema,
  type MeshPacket,
} from '../src/radio/meshtastic/proto/meshtastic/mesh_pb';
import { AdminMessageSchema } from '../src/radio/meshtastic/proto/meshtastic/admin_pb';
import { PortNum } from '../src/radio/meshtastic/proto/meshtastic/portnums_pb';
import { RadioHub } from '../src/radio/RadioHub';
import { migrate } from '../src/storage/migrations';
import { MetaRepository } from '../src/storage/meta';
import { NodeSqliteDatabase } from './nodeSqlite';
import { bytesEqual } from './helpers';

const user = (n: string) =>
  toBinary(
    UserSchema,
    create(UserSchema, {
      id: '!cafe0001',
      longName: n,
      shortName: 'CF',
      publicKey: new Uint8Array(32).fill(7),
    }),
  );

describe('contact card', () => {
  const me = identityFromMasterSeed(newMasterSeed());
  const card = {
    boxPublicKey: me.box.publicKey,
    signPublicKey: me.sign.publicKey,
    name: 'Léa 🐬',
    meshContact: encodeSharedContact(0xcafe0001, user('Module de Léa')),
  };

  it('round-trips through a link', () => {
    const link = encodeCard(card, me.sign.secretKey);
    expect(link.startsWith(CARD_URL_PREFIX)).toBe(true);
    expect(link).toMatch(/^wavepod:\/\/add#[A-Za-z0-9_-]+$/);
    const back = decodeCard(link);
    expect(back.name).toBe('Léa 🐬');
    expect(bytesEqual(back.boxPublicKey, card.boxPublicKey)).toBe(true);
    expect(decodeSharedContact(back.meshContact!)).toMatchObject({
      nodeNum: 0xcafe0001,
      longName: 'Module de Léa',
    });
  });

  it('works without a module and fits in a QR code', () => {
    const link = encodeCard({ ...card, meshContact: null }, me.sign.secretKey);
    expect(decodeCard(link).meshContact).toBeNull();
    const full = encodeCard(card, me.sign.secretKey);
    expect(full.length).toBeLessThan(500); // QR version ~15 at medium correction
  });

  it('rejects any modified byte', () => {
    const link = encodeCard(card, me.sign.secretKey);
    const bytes = fromBase64Url(link.slice(CARD_URL_PREFIX.length));
    for (const i of [1, 40, 66, bytes.length - 70, bytes.length - 1]) {
      const copy = bytes.slice();
      copy[i] ^= 1;
      expect(() => decodeCard(CARD_URL_PREFIX + toBase64Url(copy))).toThrow(
        CardError,
      );
    }
  });

  it('rejects a card signed by another key', () => {
    const other = identityFromMasterSeed(newMasterSeed());
    expect(() => decodeCard(encodeCard(card, other.sign.secretKey))).toThrow(
      'invalid signature',
    );
  });

  it('rejects other links, truncation and unknown versions', () => {
    expect(() => decodeCard('https://meshtastic.org/v/#abc')).toThrow(
      'not a Wavepod',
    );
    const link = encodeCard(card, me.sign.secretKey);
    expect(() => decodeCard(link.slice(0, -10))).toThrow(CardError);
    const bytes = fromBase64Url(link.slice(CARD_URL_PREFIX.length));
    bytes[0] = 2;
    expect(() => decodeCard(CARD_URL_PREFIX + toBase64Url(bytes))).toThrow(
      'version',
    );
  });

  it('validates names', () => {
    expect(() =>
      encodeCard({ ...card, name: '  ' }, me.sign.secretKey),
    ).toThrow('empty');
    expect(() =>
      encodeCard({ ...card, name: 'x'.repeat(41) }, me.sign.secretKey),
    ).toThrow('too long');
  });

  it('base64url round-trips and accepts standard base64', () => {
    for (let n = 0; n < 10; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => 250 - i * 7);
      expect(Array.from(fromBase64Url(toBase64Url(b)))).toEqual(Array.from(b));
    }
    expect(Array.from(fromBase64Url('+/8='))).toEqual([0xfb, 0xff]);
  });
});

describe('add_contact', () => {
  it('builds an admin packet to our own node', () => {
    const shared = encodeSharedContact(0xcafe0001, user('X'));
    const msg = fromBinary(ToRadioSchema, encodeAddContact(0x1111, 7, shared));
    const packet = msg.payloadVariant.value as MeshPacket;
    expect(packet.to).toBe(0x1111);
    const data = packet.payloadVariant.value as {
      portnum: number;
      payload: Uint8Array;
    };
    expect(data.portnum).toBe(PortNum.ADMIN_APP);
    const admin = fromBinary(AdminMessageSchema, data.payload);
    expect(admin.payloadVariant.case).toBe('addContact');
    const contact = admin.payloadVariant.value as {
      nodeNum: number;
      user: { publicKey: Uint8Array };
    };
    expect(contact.nodeNum).toBe(0xcafe0001);
    expect(contact.user.publicKey).toEqual(new Uint8Array(32).fill(7));
  });
});

describe('ContactService', () => {
  async function setup() {
    const db = new NodeSqliteDatabase();
    await migrate(db);
    const me = identityFromMasterSeed(newMasterSeed());
    const engine = new DeliveryEngine({
      radio: new RadioHub(),
      me: me.box,
      db,
    });
    const injected: Uint8Array[] = [];
    let module: {
      ownSharedContact(): Uint8Array | null;
      addContact(b: Uint8Array): Promise<void>;
    } | null = {
      ownSharedContact: () => encodeSharedContact(0x1111, user('Mon module')),
      addContact: async b => {
        injected.push(b);
      },
    };
    const service = new ContactService(
      me,
      engine.contacts,
      new MetaRepository(db),
      engine,
      () => module,
    );
    engine.start();
    return {
      me,
      engine,
      service,
      injected,
      setModule: (m: typeof module) => (module = m),
    };
  }

  it('creates my card with my module and display name', async () => {
    const { service, me } = await setup();
    await service.setDisplayName('  Tom ');
    const { link, includesModule } = await service.myCardLink();
    expect(includesModule).toBe(true);
    const card = decodeCard(link);
    expect(card.name).toBe('Tom');
    expect(bytesEqual(card.boxPublicKey, me.box.publicKey)).toBe(true);
    expect(decodeSharedContact(card.meshContact!).nodeNum).toBe(0x1111);
  });

  it('adds a scanned contact, injects its module and marks it present', async () => {
    const a = await setup();
    const b = await setup();
    await b.service.setDisplayName('Bea');
    const scanned = await a.service.inspect(
      (
        await b.service.myCardLink()
      ).link,
    );
    expect(scanned.safetyNumber).toBe(
      (await b.service.inspect((await a.service.myCardLink()).link))
        .safetyNumber,
    );
    expect(scanned.existing).toBeNull();
    const c = await a.service.add(scanned);
    await a.engine.idle();
    expect(c).toMatchObject({ name: 'Bea', nodeNum: 0x1111, verified: false });
    expect(c.lastSeenAt).not.toBeNull();
    expect(a.injected).toHaveLength(1);
    expect(
      (await a.service.inspect((await b.service.myCardLink()).link)).existing
        ?.id,
    ).toBe(c.id);
  });

  it('refuses my own card', async () => {
    const { service } = await setup();
    await expect(
      service.inspect((await service.myCardLink()).link),
    ).rejects.toThrow('own card');
  });

  it('re-injects every contact into a newly connected module', async () => {
    const a = await setup();
    const b = await setup();
    const c = await setup();
    a.setModule(null);
    await a.service.add(
      await a.service.inspect((await b.service.myCardLink()).link),
    );
    await a.service.add(
      await a.service.inspect((await c.service.myCardLink()).link),
    );
    expect(a.injected).toHaveLength(0);
    a.setModule({
      ownSharedContact: () => null,
      addContact: async x => {
        a.injected.push(x);
      },
    });
    expect(await a.service.syncModule()).toBe(2);
    expect(a.injected).toHaveLength(2);
  });
});
