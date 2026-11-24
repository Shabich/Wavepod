import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  DataSchema,
  FromRadioSchema,
  MeshPacketSchema,
  MyNodeInfoSchema,
  NodeInfoSchema,
  RoutingSchema,
  Routing_Error,
  ToRadioSchema,
  UserSchema,
} from '../src/radio/meshtastic/proto/meshtastic/mesh_pb';
import { PortNum } from '../src/radio/meshtastic/proto/meshtastic/portnums_pb';
import {
  decodeFromRadio,
  encodePacket,
  encodeWantConfig,
} from '../src/radio/meshtastic/framing';
import {
  MeshtasticAdapter,
  type BleLink,
} from '../src/radio/meshtastic/MeshtasticAdapter';
import { WAVEPOD_PORTNUM } from '../src/radio/meshtastic/constants';
import { tick } from './helpers';

type FromRadioInit = Parameters<typeof create<typeof FromRadioSchema>>[1];
const fromRadio = (init: FromRadioInit) =>
  toBinary(FromRadioSchema, create(FromRadioSchema, init));

const wavepodPacket = (from: number, id: number, payload: Uint8Array) =>
  fromRadio({
    payloadVariant: {
      case: 'packet',
      value: create(MeshPacketSchema, {
        from,
        to: 0x1111,
        id,
        hopStart: 3,
        hopLimit: 2,
        payloadVariant: {
          case: 'decoded',
          value: create(DataSchema, {
            portnum: WAVEPOD_PORTNUM as PortNum,
            payload,
          }),
        },
      }),
    },
  });

const routing = (from: number, requestId: number, error: Routing_Error) =>
  fromRadio({
    payloadVariant: {
      case: 'packet',
      value: create(MeshPacketSchema, {
        from,
        to: 0x1111,
        payloadVariant: {
          case: 'decoded',
          value: create(DataSchema, {
            portnum: PortNum.ROUTING_APP,
            requestId,
            payload: toBinary(
              RoutingSchema,
              create(RoutingSchema, {
                variant: { case: 'errorReason', value: error },
              }),
            ),
          }),
        },
      }),
    },
  });

describe('framing', () => {
  it('encodes want_config_id', () => {
    const msg = fromBinary(ToRadioSchema, encodeWantConfig(1234));
    expect(msg.payloadVariant).toEqual({ case: 'wantConfigId', value: 1234 });
  });

  it('encodes a Wavepod packet on the private port', () => {
    const msg = fromBinary(
      ToRadioSchema,
      encodePacket({
        id: 9,
        to: 0x2222,
        payload: new Uint8Array([1, 2]),
        wantAck: true,
      }),
    );
    expect(msg.payloadVariant.case).toBe('packet');
    const p = msg.payloadVariant.value as ReturnType<
      typeof create<typeof MeshPacketSchema>
    >;
    expect(p).toMatchObject({ id: 9, to: 0x2222, wantAck: true, hopLimit: 3 });
    expect(p.payloadVariant.case).toBe('decoded');
    const data = p.payloadVariant.value as ReturnType<
      typeof create<typeof DataSchema>
    >;
    expect(data.portnum).toBe(256);
    expect(Array.from(data.payload)).toEqual([1, 2]);
  });

  it('decodes Wavepod packets, routing acks and node infos', () => {
    expect(
      decodeFromRadio(wavepodPacket(0x2222, 5, new Uint8Array([9]))),
    ).toMatchObject({
      kind: 'wavepodPacket',
      from: 0x2222,
      packetId: 5,
      hopStart: 3,
      hopLimit: 2,
    });
    expect(decodeFromRadio(routing(0x2222, 5, Routing_Error.NONE))).toEqual({
      kind: 'routing',
      requestId: 5,
      from: 0x2222,
      error: Routing_Error.NONE,
    });
    const node = fromRadio({
      payloadVariant: {
        case: 'nodeInfo',
        value: create(NodeInfoSchema, {
          num: 0x2222,
          user: create(UserSchema, { longName: 'Équipe B', shortName: 'B' }),
        }),
      },
    });
    expect(decodeFromRadio(node)).toMatchObject({
      kind: 'nodeInfo',
      node: { num: 0x2222, longName: 'Équipe B' },
    });
  });

  it('ignores other ports', () => {
    const text = fromRadio({
      payloadVariant: {
        case: 'packet',
        value: create(MeshPacketSchema, {
          payloadVariant: {
            case: 'decoded',
            value: create(DataSchema, { portnum: PortNum.TEXT_MESSAGE_APP }),
          },
        }),
      },
    });
    expect(decodeFromRadio(text).kind).toBe('ignored');
  });
});

class FakeLink implements BleLink {
  queue: Uint8Array[] = [];
  written: Uint8Array[] = [];
  fromNum?: () => void;
  onWrite?: (bytes: Uint8Array) => void;
  async writeToRadio(bytes: Uint8Array) {
    this.written.push(bytes);
    this.onWrite?.(bytes);
  }
  async readFromRadio() {
    return this.queue.shift() ?? new Uint8Array(0);
  }
  onFromNum(l: () => void) {
    this.fromNum = l;
    return () => undefined;
  }
  onDisconnected() {
    return () => undefined;
  }
  async disconnect() {}
}

describe('MeshtasticAdapter', () => {
  async function readyAdapter() {
    const link = new FakeLink();
    link.onWrite = bytes => {
      const msg = fromBinary(ToRadioSchema, bytes);
      if (msg.payloadVariant.case === 'wantConfigId') {
        link.queue.push(
          fromRadio({
            payloadVariant: {
              case: 'myInfo',
              value: create(MyNodeInfoSchema, { myNodeNum: 0x1111 }),
            },
          }),
          fromRadio({
            payloadVariant: {
              case: 'configCompleteId',
              value: msg.payloadVariant.value,
            },
          }),
        );
      }
    };
    const adapter = new MeshtasticAdapter(link);
    await adapter.start();
    return { link, adapter };
  }

  it('becomes ready after config_complete_id with the matching id', async () => {
    const { adapter } = await readyAdapter();
    expect(adapter.connectionState).toBe('ready');
    expect(adapter.localNode).toBe(0x1111);
  });

  it('refuses to send before ready', async () => {
    const adapter = new MeshtasticAdapter(new FakeLink());
    await expect(adapter.send(new Uint8Array([1]), 2)).rejects.toThrow(
      'not ready',
    );
  });

  it('drains on FromNum and emits packets and acks', async () => {
    const { link, adapter } = await readyAdapter();
    const packets: number[] = [];
    const acks: Array<{ packetId: number; ok: boolean; error?: string }> = [];
    adapter.onReceive(p => packets.push(p.packetId));
    adapter.onAck(a => acks.push(a));

    const id = await adapter.send(new Uint8Array([7]), 0x2222);
    link.queue.push(
      wavepodPacket(0x2222, 77, new Uint8Array([1])),
      routing(0x2222, id, Routing_Error.NONE),
    );
    link.queue.push(routing(0x2222, 99, Routing_Error.MAX_RETRANSMIT));
    link.fromNum?.();
    await tick();

    expect(packets).toEqual([77]);
    expect(acks).toEqual([
      { packetId: id, from: 0x2222, ok: true, error: undefined },
      { packetId: 99, from: 0x2222, ok: false, error: 'MAX_RETRANSMIT' },
    ]);
  });
});
