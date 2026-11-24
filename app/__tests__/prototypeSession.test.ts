import type {
  ConnectionState,
  RadioAck,
  RadioInterface,
  RadioPacket,
  SendOptions,
} from '../src/radio/RadioInterface';
import { PrototypeSession } from '../src/prototype/PrototypeSession';
import { containsBytes, tick, utf8 } from './helpers';

/** Two in-memory radios on a shared "air". Optionally drops or duplicates packets. */
class FakeRadio implements RadioInterface {
  connectionState: ConnectionState = 'ready';
  peer!: FakeRadio;
  private rx = new Set<(p: RadioPacket) => void>();
  private ax = new Set<(a: RadioAck) => void>();
  sent: Uint8Array[] = [];
  drop = false;
  duplicate = false;
  private nextId = 1;
  constructor(readonly localNode: number) {}

  async send(
    payload: Uint8Array,
    destination: number,
    options: SendOptions = {},
  ) {
    const packetId = this.localNode * 1000 + this.nextId++;
    this.sent.push(payload);
    if (!this.drop && destination === this.peer.localNode) {
      const deliver = () =>
        this.peer.rx.forEach(l =>
          l({ from: this.localNode, to: destination, packetId, payload }),
        );
      deliver();
      if (this.duplicate) deliver();
      if (options.wantAck)
        this.ax.forEach(l => l({ packetId, from: destination, ok: true }));
    }
    return packetId;
  }
  onReceive(l: (p: RadioPacket) => void) {
    this.rx.add(l);
    return () => this.rx.delete(l);
  }
  onAck(l: (a: RadioAck) => void) {
    this.ax.add(l);
    return () => this.ax.delete(l);
  }
  onConnectionState() {
    return () => undefined;
  }
}

function pair() {
  const ra = new FakeRadio(0xa);
  const rb = new FakeRadio(0xb);
  ra.peer = rb;
  rb.peer = ra;
  const a = new PrototypeSession(ra, 'A');
  const b = new PrototypeSession(rb, 'B');
  a.peerNode = 0xb;
  return { ra, rb, a, b };
}

describe('PrototypeSession', () => {
  it('delivers an encrypted text and gets an app-level ack', async () => {
    const { ra, a, b } = pair();
    const msg = await a.sendText('Je fais demi-tour');
    await tick();
    expect(b.messages).toHaveLength(1);
    expect(b.messages[0]).toMatchObject({
      direction: 'in',
      text: 'Je fais demi-tour',
    });
    expect(b.peerNode).toBe(0xa);
    expect(msg.status).toBe('delivered');
    expect(containsBytes(ra.sent[0], utf8('demi-tour'))).toBe(false);
  });

  it('marks module ack when the app ack is lost', async () => {
    const { rb, a } = pair();
    rb.drop = true;
    const msg = await a.sendText('hello');
    await tick();
    expect(msg.status).toBe('moduleAck');
  });

  it('stays sent when nothing comes back', async () => {
    const { ra, a } = pair();
    ra.drop = true;
    const msg = await a.sendText('hello');
    expect(msg.status).toBe('sent');
  });

  it('ignores duplicates but acks them again', async () => {
    const { ra, rb, a, b } = pair();
    ra.duplicate = true;
    await a.sendText('une fois');
    await tick();
    expect(b.messages).toHaveLength(1);
    expect(rb.sent).toHaveLength(2);
  });

  it('drops packets with an unknown key hint or a broken tag', async () => {
    const { ra, a, b } = pair();
    await a.sendText('x');
    await tick();
    const inject = (payload: Uint8Array) =>
      (b as unknown as { handlePacket(p: RadioPacket): void }).handlePacket({
        from: 0xa,
        to: 0xb,
        packetId: 1,
        payload,
      });

    const wrongHint = new Uint8Array(ra.sent[0]);
    wrongHint[1] ^= 0xff;
    inject(wrongHint);
    expect(b.log[0]).toContain('unknown key hint');

    const broken = new Uint8Array(ra.sent[0]);
    broken[broken.length - 1] ^= 1;
    inject(broken);
    expect(b.log[0]).toContain('decrypt failed');
    expect(b.messages).toHaveLength(1);
  });

  it('keeps delivered when the radio ack arrives before the write resolves', async () => {
    const { ra, a } = pair();
    // FakeRadio delivers and acks synchronously inside send(), before it resolves.
    const msg = await a.sendText('rapide');
    await tick();
    expect(msg.status).toBe('delivered');
    expect(ra.sent).toHaveLength(1);
  });
});
