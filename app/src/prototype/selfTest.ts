/**
 * Runtime self-test shown on the prototype home screen. Proves that crypto,
 * protobuf and the UTF-8 polyfill work on the device's JS engine (Hermes), not only in Jest.
 */
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  deriveSessionKey,
  generateIdentity,
  open,
  seal,
} from '../crypto/envelope';
import { MessageType, decodeText, encodeText } from '../protocol/codec';
import {
  NodeInfoSchema,
  UserSchema,
} from '../radio/meshtastic/proto/meshtastic/mesh_pb';

export function runSelfTest(): { ok: boolean; detail: string } {
  const started = Date.now();
  try {
    const a = generateIdentity();
    const b = generateIdentity();
    const text = 'Test dauphin 🐬 éàü';
    const env = seal(
      MessageType.Text,
      encodeText(text),
      a.publicKey,
      deriveSessionKey(a, b.publicKey),
    );
    const back = decodeText(
      open(env, deriveSessionKey(b, a.publicKey)).plaintext,
    );
    if (back !== text) throw new Error('crypto round-trip mismatch');

    const node = create(NodeInfoSchema, {
      num: 42,
      user: create(UserSchema, { longName: 'Équipe B' }),
    });
    const decoded = fromBinary(NodeInfoSchema, toBinary(NodeInfoSchema, node));
    if (decoded.user?.longName !== 'Équipe B')
      throw new Error('protobuf mismatch');

    return { ok: true, detail: `autotest OK (${Date.now() - started} ms)` };
  } catch (e) {
    return { ok: false, detail: `autotest en échec : ${String(e)}` };
  }
}
