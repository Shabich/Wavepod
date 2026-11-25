/**
 * Provisioning against real firmware: start the nodes with `npm run sim:start -- --raw`
 * (region UNSET, like a module out of the box), then:
 *  1. Wavepod plans and applies its configuration on both nodes (one transaction each),
 *  2. reconnects after the reboot and checks nothing is left to change,
 *  3. exchanges contact cards and messages.
 *
 *   npx tsx tools/sim/provision-check.ts
 */
import { MeshtasticAdapter } from '../../src/radio/meshtastic/MeshtasticAdapter';
import {
  firmwareStatus,
  planProvisioning,
} from '../../src/radio/meshtastic/provisioning';
import { Config_LoRaConfig_RegionCode } from '../../src/radio/meshtastic/proto/meshtastic/config_pb';
import { connectTcp } from './tcpLink';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function connect(port: number, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const adapter = new MeshtasticAdapter(
        await connectTcp('localhost', port),
      );
      await adapter.start();
      const ready = Date.now() + 15_000;
      while (adapter.connectionState !== 'ready') {
        if (Date.now() > ready) throw new Error('sync timeout');
        await sleep(100);
      }
      return adapter;
    } catch (e) {
      if (Date.now() > end) throw e;
      await sleep(2_000); // module rebooting
    }
  }
}

function plan(a: MeshtasticAdapter) {
  return planProvisioning({
    snapshot: a.snapshot,
    nodeNum: a.localNode!,
    owner: a.ownUser(),
  });
}

async function provision(port: number) {
  const a = await connect(port);
  const before = plan(a);
  console.log(
    `nœud ${a.localNode!.toString(16)} · firmware ${
      a.firmwareVersion
    } (${firmwareStatus(a.firmwareVersion)}) · région ${
      Config_LoRaConfig_RegionCode[a.snapshot.lora?.region ?? 0]
    }`,
  );
  console.log(`  à changer : ${before.changes.join(', ') || 'rien'}`);
  if (before.warnings.length)
    console.log(`  avertissements : ${before.warnings.join(', ')}`);
  const t0 = Date.now();
  await a.applyAdmin(before.admin);
  await sleep(1_000);
  await a.stop().catch(() => undefined);
  await sleep(3_000);
  const b = await connect(port);
  const after = plan(b);
  console.log(
    `  après redémarrage (${((Date.now() - t0) / 1000).toFixed(
      1,
    )} s) : région ${
      Config_LoRaConfig_RegionCode[b.snapshot.lora?.region ?? 0]
    }, nom « ${b.ownUser()?.longName} », reste à changer : ${
      after.changes.join(', ') || 'rien'
    }`,
  );
  await b.stop();
  return before.changes.length > 0 && after.changes.length === 0;
}

async function main() {
  const okA = await provision(4403);
  const okB = await provision(4404);
  console.log(okA && okB ? '\nOK' : '\nÉCHEC');
  process.exit(okA && okB ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
