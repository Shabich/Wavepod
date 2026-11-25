/**
 * End-to-end test against two simulated meshtasticd nodes (see tools/sim/README.md).
 * Runs the real stack (codec, encryption, Meshtastic adapter, delivery engine, SQLite)
 * over TCP instead of BLE.
 *
 *   npx tsx tools/sim/two-node-test.ts [count] [--outage]
 *
 * Phase 1: A sends `count` messages to B, all must be delivered.
 * Phase 2 (--outage): node B is stopped, A sends 3 messages, B comes back and says
 * hello; A's queue must drain within 2 minutes, without duplicates on B.
 */
import { execSync } from 'node:child_process';
import { MeshtasticAdapter } from '../../src/radio/meshtastic/MeshtasticAdapter';
import { DeliveryEngine } from '../../src/delivery/engine';
import type { DeliveryPolicy } from '../../src/delivery/policy';
import { generateIdentity, type Identity } from '../../src/crypto/envelope';
import { migrate } from '../../src/storage/migrations';
import { NodeSqliteDatabase } from '../../__tests__/nodeSqlite';
import { connectTcp } from './tcpLink';

const args = process.argv.slice(2);
const COUNT = Number(args.find(a => /^\d+$/.test(a)) ?? 20);
const OUTAGE = args.includes('--outage');
const A_ADDR = 'localhost:4403';
const B_ADDR = 'localhost:4404';

/** Short timings so the scenario runs in about a minute. */
const POLICY: DeliveryPolicy = {
  presenceWindowMs: 60_000,
  retryDelaysMs: [2_000, 4_000],
  probeIntervalMs: 30_000,
  ttlMs: 10 * 60_000,
  spacingMs: 300,
  dedupRetentionMs: 60 * 60_000,
};

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor(
  cond: () => Promise<boolean> | boolean,
  ms: number,
  what: string,
) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(100);
  }
}

async function connect(addr: string) {
  const [host, port] = addr.split(':');
  const adapter = new MeshtasticAdapter(await connectTcp(host, Number(port)));
  await adapter.start();
  await waitFor(
    () => adapter.connectionState === 'ready',
    15_000,
    `${addr} ready`,
  );
  return adapter;
}

interface Side {
  name: string;
  me: Identity;
  db: NodeSqliteDatabase;
  adapter: MeshtasticAdapter;
  engine: DeliveryEngine;
  peerId: string;
}

async function side(
  name: string,
  addr: string,
  me: Identity,
  db: NodeSqliteDatabase,
) {
  const adapter = await connect(addr);
  const engine = new DeliveryEngine({ radio: adapter, me, db, policy: POLICY });
  engine.onEvent(e => {
    if (e.kind === 'log' && process.env.VERBOSE)
      console.log(`  [${name}] ${e.line}`);
  });
  engine.start();
  return { name, me, db, adapter, engine, peerId: '' } as Side;
}

async function status(s: Side, id: number) {
  return (await s.engine.messages.get(s.peerId, 'out', id))?.status;
}

async function inbox(s: Side) {
  return (await s.engine.messages.listForContact(s.peerId)).filter(
    m => m.direction === 'in',
  );
}

async function main() {
  const dbA = new NodeSqliteDatabase();
  const dbB = new NodeSqliteDatabase();
  await migrate(dbA);
  await migrate(dbB);
  const idA = generateIdentity();
  const idB = generateIdentity();

  const a = await side('A', A_ADDR, idA, dbA);
  let b = await side('B', B_ADDR, idB, dbB);
  console.log(
    `A ${hex(a.adapter.localNode!)} · B ${hex(
      b.adapter.localNode!,
    )} · firmware ${a.adapter.firmwareVersion}`,
  );

  // Contacts as a QR exchange would create them (task 04), both "seen" now.
  a.peerId = (
    await a.engine.contacts.upsert({
      publicKey: idB.publicKey,
      name: 'B',
      nodeNum: b.adapter.localNode,
    })
  ).id;
  b.peerId = (
    await b.engine.contacts.upsert({
      publicKey: idA.publicKey,
      name: 'A',
      nodeNum: a.adapter.localNode,
    })
  ).id;
  await a.engine.signal(a.peerId, b.adapter.localNode!);
  await b.engine.signal(b.peerId, a.adapter.localNode!);

  // Phase 1
  const t1 = Date.now();
  const ids: number[] = [];
  for (let i = 1; i <= COUNT; i++) {
    ids.push(
      await a.engine.sendText(
        a.peerId,
        `message ${i}/${COUNT} · rendez-vous au refuge`,
      ),
    );
  }
  try {
    await waitFor(
      async () =>
        (
          await Promise.all(ids.map(id => status(a, id)))
        ).every(s => s === 'delivered'),
      60_000,
      'phase 1 delivery',
    );
  } catch {
    // reported below
  }
  const delivered1 = (await Promise.all(ids.map(id => status(a, id)))).filter(
    s => s === 'delivered',
  ).length;
  const received1 = (await inbox(b)).length;
  console.log(
    `Phase 1 : ${delivered1}/${COUNT} livrés, ${received1}/${COUNT} reçus par B, ${(
      (Date.now() - t1) /
      1000
    ).toFixed(1)} s`,
  );
  let ok = delivered1 === COUNT && received1 === COUNT;

  if (OUTAGE) {
    console.log('Phase 2 : B hors de portée (nœud arrêté)');
    b.engine.stop();
    execSync('docker stop wp-node-b', { stdio: 'ignore' });
    const outIds: number[] = [];
    for (const t of ['un', 'deux', 'trois'])
      outIds.push(
        await a.engine.sendText(a.peerId, `pendant la coupure : ${t}`),
      );
    await sleep(10_000); // bursts (0 s, +2 s, +4 s) exhausted
    const during = await Promise.all(outIds.map(id => status(a, id)));
    console.log(`  pendant la coupure : ${during.join(', ')}`);
    ok = ok && during.every(s => s !== 'delivered' && s !== 'failed');

    console.log('  retour de B');
    execSync('docker start wp-node-b', { stdio: 'ignore' });
    await sleep(4_000);
    b = { ...(await side('B', B_ADDR, idB, dbB)), peerId: b.peerId };
    const back = Date.now();
    await b.engine.sendText(b.peerId, 'je suis de retour');
    try {
      await waitFor(
        async () =>
          (
            await Promise.all(outIds.map(id => status(a, id)))
          ).every(s => s === 'delivered'),
        120_000,
        'queue drain',
      );
    } catch {
      // reported below
    }
    const after = await Promise.all(outIds.map(id => status(a, id)));
    const texts = (await inbox(b))
      .map(m => m.body)
      .filter(t => t.startsWith('pendant la coupure'));
    const unique = new Set(texts).size;
    console.log(
      `  après retour : ${after.join(', ')} en ${(
        (Date.now() - back) /
        1000
      ).toFixed(1)} s · B a reçu ${
        texts.length
      } message(s), ${unique} distinct(s)`,
    );
    ok =
      ok &&
      after.every(s => s === 'delivered') &&
      texts.length === 3 &&
      unique === 3;
  }

  console.log(ok ? '\nOK' : '\nÉCHEC');
  a.engine.stop();
  b.engine.stop();
  await a.adapter.stop();
  await b.adapter.stop();
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
