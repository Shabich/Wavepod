/**
 * Minimal boundary between Wavepod and the radio layer.
 * Only the Meshtastic adapter knows about protobuf; everything above this
 * interface deals with opaque byte payloads and node numbers.
 */

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'ready';

export interface RadioPacket {
  /** Radio-level sender address (Meshtastic node number). A routing hint, not an identity. */
  from: number;
  to: number;
  packetId: number;
  payload: Uint8Array;
  rxTime?: number;
  rxSnr?: number;
  rxRssi?: number;
  hopStart?: number;
  hopLimit?: number;
}

/** Radio-level acknowledgement: the destination module (or a relay) answered for a sent packet. */
export interface RadioAck {
  packetId: number;
  /** Node that produced the ack. Equal to the destination for a real delivery ack. */
  from: number;
  ok: boolean;
  error?: string;
}

export interface SendOptions {
  wantAck?: boolean;
}

export type Unsubscribe = () => void;

export interface RadioInterface {
  readonly connectionState: ConnectionState;
  /** Own radio address once known, otherwise undefined. */
  readonly localNode: number | undefined;
  /** Sends an opaque payload. Resolves with the radio packet id used to correlate acks. */
  send(
    payload: Uint8Array,
    destination: number,
    options?: SendOptions,
  ): Promise<number>;
  onReceive(listener: (packet: RadioPacket) => void): Unsubscribe;
  onAck(listener: (ack: RadioAck) => void): Unsubscribe;
  onConnectionState(listener: (state: ConnectionState) => void): Unsubscribe;
  /**
   * Optional: any radio activity from a node (any packet, or last_heard reported
   * by the module). A presence hint, not authenticated.
   */
  onHeard?(listener: (nodeNum: number, at: number) => void): Unsubscribe;
}
