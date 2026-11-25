/**
 * Translation between Meshtastic ToRadio/FromRadio protobufs and plain events.
 * Pure functions, no BLE, so it can be tested without a module.
 */
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  DataSchema,
  FromRadioSchema,
  MeshPacketSchema,
  RoutingSchema,
  Routing_Error,
  ToRadioSchema,
  UserSchema,
  type MeshPacket,
} from './proto/meshtastic/mesh_pb';
import {
  AdminMessageSchema,
  SharedContactSchema,
  type AdminMessage,
} from './proto/meshtastic/admin_pb';
import type { Config } from './proto/meshtastic/config_pb';
import type { ModuleConfig } from './proto/meshtastic/module_config_pb';
import { PortNum } from './proto/meshtastic/portnums_pb';
import { DEFAULT_HOP_LIMIT, WAVEPOD_PORTNUM } from './constants';

export interface NodeSummary {
  num: number;
  longName: string;
  shortName: string;
  lastHeard: number;
  snr: number;
  /** Module PKI public key (32 bytes), empty if unknown. */
  publicKey: Uint8Array;
  /** Raw User protobuf, kept to build SharedContact cards. */
  userBytes: Uint8Array | null;
}

export type RadioEvent =
  | { kind: 'myInfo'; myNodeNum: number }
  | { kind: 'nodeInfo'; node: NodeSummary }
  | { kind: 'configComplete'; configId: number }
  | { kind: 'firmware'; version: string }
  | {
      kind: 'wavepodPacket';
      from: number;
      to: number;
      packetId: number;
      payload: Uint8Array;
      rxTime?: number;
      rxSnr: number;
      rxRssi?: number;
      hopStart: number;
      hopLimit: number;
    }
  | { kind: 'routing'; requestId: number; from: number; error: Routing_Error }
  | { kind: 'queueStatus'; free: number; maxlen: number }
  | { kind: 'config'; config: Config }
  | { kind: 'moduleConfig'; moduleConfig: ModuleConfig }
  | { kind: 'rebooted' }
  | { kind: 'ignored'; reason: string };

export function encodeWantConfig(configId: number): Uint8Array {
  return toBinary(
    ToRadioSchema,
    create(ToRadioSchema, {
      payloadVariant: { case: 'wantConfigId', value: configId },
    }),
  );
}

export interface OutgoingPacket {
  id: number;
  to: number;
  payload: Uint8Array;
  wantAck: boolean;
  hopLimit?: number;
  channel?: number;
}

export function encodePacket(p: OutgoingPacket): Uint8Array {
  const packet = create(MeshPacketSchema, {
    id: p.id,
    to: p.to,
    wantAck: p.wantAck,
    hopLimit: p.hopLimit ?? DEFAULT_HOP_LIMIT,
    channel: p.channel ?? 0,
    payloadVariant: {
      case: 'decoded',
      value: create(DataSchema, {
        portnum: WAVEPOD_PORTNUM as PortNum,
        payload: p.payload,
      }),
    },
  });
  return toBinary(
    ToRadioSchema,
    create(ToRadioSchema, {
      payloadVariant: { case: 'packet', value: packet },
    }),
  );
}

export function decodeFromRadio(bytes: Uint8Array): RadioEvent {
  const msg = fromBinary(FromRadioSchema, bytes);
  const v = msg.payloadVariant;
  switch (v.case) {
    case 'myInfo':
      return { kind: 'myInfo', myNodeNum: v.value.myNodeNum };
    case 'nodeInfo':
      return {
        kind: 'nodeInfo',
        node: {
          num: v.value.num,
          longName: v.value.user?.longName ?? '',
          shortName: v.value.user?.shortName ?? '',
          lastHeard: v.value.lastHeard,
          snr: v.value.snr,
          publicKey: v.value.user?.publicKey ?? new Uint8Array(0),
          userBytes: v.value.user ? toBinary(UserSchema, v.value.user) : null,
        },
      };
    case 'configCompleteId':
      return { kind: 'configComplete', configId: v.value };
    case 'metadata':
      return { kind: 'firmware', version: v.value.firmwareVersion };
    case 'queueStatus':
      return {
        kind: 'queueStatus',
        free: v.value.free,
        maxlen: v.value.maxlen,
      };
    case 'config':
      return { kind: 'config', config: v.value };
    case 'moduleConfig':
      return { kind: 'moduleConfig', moduleConfig: v.value };
    case 'rebooted':
      return { kind: 'rebooted' };
    case 'packet':
      return decodeMeshPacket(v.value);
    default:
      return { kind: 'ignored', reason: v.case ?? 'empty' };
  }
}

function decodeMeshPacket(packet: MeshPacket): RadioEvent {
  if (packet.payloadVariant.case !== 'decoded') {
    // Encrypted for a channel we do not hold: nothing the app can do with it.
    return { kind: 'ignored', reason: 'encrypted packet' };
  }
  const data = packet.payloadVariant.value;
  if (data.portnum === PortNum.ROUTING_APP) {
    const routing = fromBinary(RoutingSchema, data.payload);
    const error =
      routing.variant.case === 'errorReason'
        ? routing.variant.value
        : Routing_Error.NONE;
    return {
      kind: 'routing',
      requestId: data.requestId,
      from: packet.from,
      error,
    };
  }
  if ((data.portnum as number) === WAVEPOD_PORTNUM) {
    return {
      kind: 'wavepodPacket',
      from: packet.from,
      to: packet.to,
      packetId: packet.id,
      payload: data.payload,
      rxTime: packet.rxTime,
      rxSnr: packet.rxSnr,
      rxRssi: packet.rxRssi,
      hopStart: packet.hopStart,
      hopLimit: packet.hopLimit,
    };
  }
  return { kind: 'ignored', reason: `port ${data.portnum}` };
}

export function routingErrorName(error: Routing_Error): string {
  return Routing_Error[error] ?? `ERROR_${error}`;
}

/** Meshtastic SharedContact (same bytes as the meshtastic.org/v/# links). */
export function encodeSharedContact(
  nodeNum: number,
  userBytes: Uint8Array,
): Uint8Array {
  return toBinary(
    SharedContactSchema,
    create(SharedContactSchema, {
      nodeNum,
      user: fromBinary(UserSchema, userBytes),
      manuallyVerified: true,
    }),
  );
}

export interface SharedContactInfo {
  nodeNum: number;
  longName: string;
  shortName: string;
  publicKey: Uint8Array;
}

export function decodeSharedContact(bytes: Uint8Array): SharedContactInfo {
  const c = fromBinary(SharedContactSchema, bytes);
  if (!c.nodeNum || !c.user) throw new Error('incomplete shared contact');
  return {
    nodeNum: c.nodeNum,
    longName: c.user.longName,
    shortName: c.user.shortName,
    publicKey: c.user.publicKey,
  };
}

/**
 * AdminMessage.add_contact sent to our own module: stores the contact's node and
 * PKI public key in its NodeDB, so it can send PKI direct messages right away.
 */
export function encodeAddContact(
  myNodeNum: number,
  packetId: number,
  sharedContact: Uint8Array,
): Uint8Array {
  return encodeAdmin(
    myNodeNum,
    packetId,
    create(AdminMessageSchema, {
      payloadVariant: {
        case: 'addContact',
        value: fromBinary(SharedContactSchema, sharedContact),
      },
    }),
  );
}

/** Any AdminMessage addressed to our own module (local admin, no session key needed). */
export function encodeAdmin(
  myNodeNum: number,
  packetId: number,
  admin: AdminMessage,
): Uint8Array {
  const packet = create(MeshPacketSchema, {
    id: packetId,
    to: myNodeNum,
    wantAck: false,
    payloadVariant: {
      case: 'decoded',
      value: create(DataSchema, {
        portnum: PortNum.ADMIN_APP,
        payload: toBinary(AdminMessageSchema, admin),
        wantResponse: false,
      }),
    },
  });
  return toBinary(
    ToRadioSchema,
    create(ToRadioSchema, {
      payloadVariant: { case: 'packet', value: packet },
    }),
  );
}
