/**
 * Checks AdminMessage.add_contact against a real firmware: inject a fake contact into
 * node A, re-sync, and verify the node and its PKI key are in A's NodeDB.
 *
 *   npx tsx tools/sim/add-contact-check.ts [host:port]
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { randomBytes } from '@noble/hashes/utils.js';
import { MeshtasticAdapter } from '../../src/radio/meshtastic/MeshtasticAdapter';
import { encodeSharedContact } from '../../src/radio/meshtastic/framing';
import { UserSchema } from '../../src/radio/meshtastic/proto/meshtastic/mesh_pb';
import { connectTcp } from './tcpLink';

const [host, port] = (process.argv[2] ?? 'localhost:4403').split(':');
const FAKE_NODE = 0x5a5a0000 + Math.floor(Math.random() * 0xffff);
const key = randomBytes(32);

async function synced() {
  const adapter = new MeshtasticAdapter(await connectTcp(host, Number(port)));
  await adapter.start();
  const end = Date.now() + 15_000;
  while (adapter.connectionState !== 'ready') {
    if (Date.now() > end) throw new Error('not ready');
    await new Promise(r => setTimeout(r, 100));
  }
  return adapter;
}

async function main() {
  const a = await synced();
  const own = a.ownSharedContact();
  console.log(`own SharedContact: ${own ? `${own.length} bytes` : 'missing'}`);

  const user = toBinary(
    UserSchema,
    create(UserSchema, {
      id: `!${FAKE_NODE.toString(16)}`,
      longName: 'Contact Wavepod test',
      shortName: 'WPT',
      publicKey: key,
    }),
  );
  await a.addContact(encodeSharedContact(FAKE_NODE, user));
  await new Promise(r => setTimeout(r, 1500));
  await a.stop();

  const b = await synced();
  const node = b.nodes.get(FAKE_NODE);
  const keyOk =
    !!node &&
    node.publicKey.length === 32 &&
    node.publicKey.every((v, i) => v === key[i]);
  console.log(
    node
      ? `node ${FAKE_NODE.toString(16)} found: "${node.longName}", public key ${
          keyOk ? 'matches' : 'MISMATCH'
        }`
      : `node ${FAKE_NODE.toString(16)} NOT found`,
  );
  await b.stop();
  process.exit(own && node && keyOk ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
