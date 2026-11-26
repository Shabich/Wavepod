/**
 * Groups against real firmware (two nodes): A creates a group with B, B gets the
 * invite and roster; A's broadcast reaches B, B's ack comes back to A ("1/1").
 *
 *   npm run sim:start && npx tsx tools/sim/group-check.ts
 */
import { MeshtasticAdapter } from '../../src/radio/meshtastic/MeshtasticAdapter';
import { RadioHub } from '../../src/radio/RadioHub';
import { DeliveryEngine, realScheduler } from '../../src/delivery/engine';
import { ContactService } from '../../src/contacts/service';
import { GroupService } from '../../src/groups/service';
import { GroupsRepository } from '../../src/storage/groups';
import {
  identityFromMasterSeed,
  newMasterSeed,
} from '../../src/crypto/identity';
import { migrate } from '../../src/storage/migrations';
import { MetaRepository } from '../../src/storage/meta';
import { NodeSqliteDatabase } from '../../__tests__/nodeSqlite';
import { connectTcp } from './tcpLink';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function phone(port: number, name: string) {
  const db = new NodeSqliteDatabase();
  await migrate(db);
  const id = identityFromMasterSeed(newMasterSeed());
  const hub = new RadioHub();
  const adapter = new MeshtasticAdapter(await connectTcp('localhost', port));
  hub.attach(adapter);
  await adapter.start();
  while (adapter.connectionState !== 'ready') await sleep(100);
  const engine = new DeliveryEngine({ radio: hub, me: id.box, db });
  engine.start();
  const meta = new MetaRepository(db);
  const contacts = new ContactService(
    id,
    engine.contacts,
    meta,
    engine,
    () => adapter,
  );
  await contacts.setDisplayName(name);
  const repo = new GroupsRepository(db);
  const groups = new GroupService({
    me: id,
    radio: hub,
    engine,
    contacts: engine.contacts,
    groups: repo,
    myProfile: async () => ({ name, avatar: { icon: 0, color: 0 } }),
    scheduler: realScheduler,
  });
  await groups.start();
  return { id, hub, engine, contacts, groups, repo };
}

async function waitFor(cond: () => Promise<boolean>, ms: number) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return false;
    await sleep(200);
  }
  return true;
}

async function main() {
  const a = await phone(4403, 'Alex');
  const b = await phone(4404, 'Bea');
  const bOnA = await a.contacts.add(
    await a.contacts.inspect((await b.contacts.myCardLink()).link),
  );
  await b.contacts.add(
    await b.contacts.inspect((await a.contacts.myCardLink()).link),
  );

  const t0 = Date.now();
  const group = await a.groups.createGroup('Cordée', [bOnA.id]);
  const invited = await waitFor(
    async () => (await b.repo.get(group.id)) !== null,
    30_000,
  );
  console.log(
    `invitation reçue par B : ${invited} (${((Date.now() - t0) / 1000).toFixed(
      1,
    )} s)`,
  );

  const t1 = Date.now();
  const msgId = await a.groups.send(group.id, 'On part à 8 h');
  const got = await waitFor(
    async () => (await b.repo.messages(group.id)).length === 1,
    30_000,
  );
  const acked = await waitFor(
    async () => (await a.groups.deliveryOf(group.id, msgId)).delivered === 1,
    30_000,
  );
  const sentByA = a.hub.airtime.count();
  console.log(
    `message de groupe reçu par B : ${got}, accusé revenu à A : ${acked} (${(
      (Date.now() - t1) /
      1000
    ).toFixed(1)} s) · livré ${JSON.stringify(
      await a.groups.deliveryOf(group.id, msgId),
    )}`,
  );
  console.log(
    `émissions de A : ${sentByA}, ${(a.hub.airtime.usedMs() / 1000).toFixed(
      1,
    )} s d'antenne`,
  );
  const ok = invited && got && acked;
  console.log(ok ? '\nOK' : '\nÉCHEC');
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
