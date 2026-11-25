/**
 * End-to-end test against two simulated meshtasticd nodes (see tools/sim/README.md).
 * Runs the real Wavepod stack (codec, encryption, Meshtastic adapter, prototype session)
 * over TCP instead of BLE, sends N messages A -> B and waits for app-level acks.
 *
 *   npx tsx tools/sim/two-node-test.ts [count] [hostA:port] [hostB:port]
 */
import { MeshtasticAdapter } from '../../src/radio/meshtastic/MeshtasticAdapter';
import { PrototypeSession } from '../../src/prototype/PrototypeSession';
import { connectTcp } from './tcpLink';

const [countArg, addrA = 'localhost:4403', addrB = 'localhost:4404'] =
  process.argv.slice(2);
const COUNT = Number(countArg ?? 20);
const TIMEOUT_MS = 30_000;

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

async function open(addr: string) {
  const [host, port] = addr.split(':');
  const adapter = new MeshtasticAdapter(await connectTcp(host, Number(port)));
  await adapter.start();
  await waitFor(
    () => adapter.connectionState === 'ready',
    10_000,
    `${addr} ready`,
  );
  return adapter;
}

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

async function main() {
  const a = await open(addrA);
  const b = await open(addrB);
  console.log(
    `A ${hex(a.localNode!)} fw ${a.firmwareVersion} · B ${hex(
      b.localNode!,
    )} fw ${b.firmwareVersion}`,
  );

  const sa = new PrototypeSession(a, 'A');
  const sb = new PrototypeSession(b, 'B');
  sa.peerNode = b.localNode;

  const started = Date.now();
  for (let i = 1; i <= COUNT; i++) {
    const msg = await sa.sendText(
      `message ${i}/${COUNT} · rendez-vous au refuge`,
    );
    const t0 = Date.now();
    try {
      await waitFor(
        () => msg.status === 'delivered' || msg.status === 'failed',
        TIMEOUT_MS,
        `message ${i}`,
      );
    } catch {
      // reported below
    }
    console.log(
      `${String(i).padStart(2)} ${msg.status?.padEnd(9)} ${Date.now() - t0} ms${
        msg.error ? ` (${msg.error})` : ''
      }`,
    );
  }

  const delivered = sa.messages.filter(m => m.status === 'delivered').length;
  const received = sb.messages.filter(m => m.direction === 'in').length;
  console.log(
    `\n${delivered}/${COUNT} livrés (accusé applicatif), ${received}/${COUNT} reçus et déchiffrés par B, ${Math.round(
      (Date.now() - started) / 1000,
    )} s`,
  );
  if (delivered < COUNT) {
    console.log('\nJournal A :\n' + sa.log.slice(0, 15).join('\n'));
    console.log('\nJournal B :\n' + sb.log.slice(0, 15).join('\n'));
  }
  sa.dispose();
  sb.dispose();
  await a.stop();
  await b.stop();
  process.exit(delivered === COUNT && received === COUNT ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
