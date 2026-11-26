/**
 * Presence against real firmware: two nodes exchange contact cards, then beacon
 * keys (Hello), then A's broadcast beacon must refresh "seen" on B.
 *
 *   npm run sim:start && npx tsx tools/sim/presence-check.ts
 */
import { MeshtasticAdapter } from '../../src/radio/meshtastic/MeshtasticAdapter';
import { RadioHub } from '../../src/radio/RadioHub';
import { DeliveryEngine, realScheduler } from '../../src/delivery/engine';
import {
  PresenceService,
  type PresenceSettings,
} from '../../src/presence/service';
import { ContactService } from '../../src/contacts/service';
import {
  identityFromMasterSeed,
  newMasterSeed,
} from '../../src/crypto/identity';
import { migrate } from '../../src/storage/migrations';
import { MetaRepository } from '../../src/storage/meta';
import { NodeSqliteDatabase } from '../../__tests__/nodeSqlite';
import { connectTcp } from './tcpLink';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function phone(port: number) {
  const db = new NodeSqliteDatabase();
  await migrate(db);
  const id = identityFromMasterSeed(newMasterSeed());
  const hub = new RadioHub();
  const adapter = new MeshtasticAdapter(await connectTcp('localhost', port));
  hub.attach(adapter);
  await adapter.start();
  while (adapter.connectionState !== 'ready') await sleep(100);
  const settings: PresenceSettings = { discreet: false, intervalMin: 15 };
  const engine = new DeliveryEngine({
    radio: hub,
    me: id.box,
    db,
    allowProbe: () => !settings.discreet,
  });
  engine.start();
  const meta = new MetaRepository(db);
  const contacts = new ContactService(
    id,
    engine.contacts,
    meta,
    engine,
    () => adapter,
  );
  const presence = new PresenceService({
    me: id,
    radio: hub,
    engine,
    contacts: engine.contacts,
    meta,
    settings,
    scheduler: realScheduler,
  });
  return { id, hub, adapter, engine, contacts, presence, db };
}

async function main() {
  const a = await phone(4403);
  const b = await phone(4404);
  await a.contacts.setDisplayName('Alice');
  await b.contacts.setDisplayName('Bruno');
  const onA = await a.contacts.add(
    await a.contacts.inspect((await b.contacts.myCardLink()).link),
  );
  const onB = await b.contacts.add(
    await b.contacts.inspect((await a.contacts.myCardLink()).link),
  );
  // Beacons only after the keys are known: start presence (queues Hellos, first beacon in 5–30 s).
  await a.presence.start();
  await b.presence.start();

  const t0 = Date.now();
  let keys = false;
  while (Date.now() - t0 < 30_000) {
    const kA = (await a.engine.contacts.get(onA.id))?.beaconKey;
    const kB = (await b.engine.contacts.get(onB.id))?.beaconKey;
    if (kA && kB) {
      keys = true;
      break;
    }
    await sleep(200);
  }
  console.log(
    `clés de balise échangées : ${keys} (${((Date.now() - t0) / 1000).toFixed(
      1,
    )} s)`,
  );

  // Wait for A's first beacon (5–30 s after start) and its recognition by B.
  const t1 = Date.now();
  while (Date.now() - t1 < 45_000 && b.presence.beaconsHeard === 0)
    await sleep(200);
  const seen = (await b.engine.contacts.get(onB.id))?.lastSeenAt ?? 0;
  console.log(
    b.presence.beaconsHeard > 0
      ? `balise de A émise à +${(
          (a.presence.lastBeaconAt! - t1) /
          1000
        ).toFixed(1)} s, reconnue par B (${
          b.presence.beaconsHeard
        }), « vu » mis à jour : ${seen >= b.presence.lastBeaconHeardAt! - 1000}`
      : 'balise de A non reconnue par B',
  );
  console.log(
    `temps d'antenne A sur l'heure : ${(a.hub.airtime.usedMs() / 1000).toFixed(
      2,
    )} s, ${a.hub.airtime.count()} émission(s)`,
  );
  const ok =
    keys &&
    b.presence.beaconsHeard > 0 &&
    seen >= b.presence.lastBeaconHeardAt! - 1000;
  console.log(ok ? '\nOK' : '\nÉCHEC');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
