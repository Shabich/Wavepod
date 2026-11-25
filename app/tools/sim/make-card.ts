/**
 * Prints a Wavepod contact link for a fake contact, to test the add-contact flow
 * without a second phone (e.g. xcrun simctl openurl booted "$(npx tsx tools/sim/make-card.ts)").
 *
 *   npx tsx tools/sim/make-card.ts [name] [nodeNumHex]
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { randomBytes } from '@noble/hashes/utils.js';
import { encodeCard } from '../../src/contacts/card';
import {
  identityFromMasterSeed,
  newMasterSeed,
} from '../../src/crypto/identity';
import { encodeSharedContact } from '../../src/radio/meshtastic/framing';
import { UserSchema } from '../../src/radio/meshtastic/proto/meshtastic/mesh_pb';

const name = process.argv[2] ?? 'Bruno';
const node = parseInt(process.argv[3] ?? 'b0b0b0b0', 16);
const id = identityFromMasterSeed(newMasterSeed());
const user = toBinary(
  UserSchema,
  create(UserSchema, {
    id: `!${node.toString(16)}`,
    longName: `Module de ${name}`,
    shortName: name.slice(0, 4).toUpperCase(),
    publicKey: randomBytes(32),
  }),
);
console.log(
  encodeCard(
    {
      boxPublicKey: id.box.publicKey,
      signPublicKey: id.sign.publicKey,
      name,
      meshContact: encodeSharedContact(node, user),
    },
    id.sign.secretKey,
  ),
);
