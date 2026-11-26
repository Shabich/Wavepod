/**
 * Supervision against real firmware: connect to node A, stop its container
 * (module off / out of range), start it again, and check the ModuleManager
 * reconnects by itself.
 *
 *   npx tsx tools/sim/reconnect-check.ts
 */
import { execSync } from 'node:child_process';
import { ModuleManager } from '../../src/app/moduleManager';
import { RadioHub } from '../../src/radio/RadioHub';
import { MetaRepository } from '../../src/storage/meta';
import { migrate } from '../../src/storage/migrations';
import { NodeSqliteDatabase } from '../../__tests__/nodeSqlite';
import { connectTcp } from './tcpLink';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const db = new NodeSqliteDatabase();
  await migrate(db);
  const hub = new RadioHub();
  const m = new ModuleManager({
    connectLink: () => connectTcp('localhost', 4403),
    hub,
    meta: new MetaRepository(db),
    log: l => console.log(`  [manager] ${l}`),
    backoffMs: [1_000, 2_000, 5_000],
  });
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  m.onStateChange(s =>
    console.log(`${at()} état : ${s} (radio ${hub.connectionState})`),
  );

  await m.connect('sim-a', 'Nœud A');
  console.log(`${at()} nœud ${hub.localNode?.toString(16)} prêt`);

  execSync('docker stop wp-node-a', { stdio: 'ignore' });
  console.log(`${at()} nœud arrêté`);
  await sleep(15_000);
  execSync('docker start wp-node-a', { stdio: 'ignore' });
  console.log(`${at()} nœud relancé`);

  const end = Date.now() + 60_000;
  while (m.state !== 'connected' || hub.connectionState !== 'ready') {
    if (Date.now() > end) break;
    await sleep(200);
  }
  const ok = m.state === 'connected' && hub.connectionState === 'ready';
  console.log(ok ? `\nOK, reconnecté à ${at()}` : '\nÉCHEC');
  await m.disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
