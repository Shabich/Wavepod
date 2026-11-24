/**
 * RadioInterface implementation over the Meshtastic BLE protocol.
 *
 * Sync sequence: write ToRadio{want_config_id}, then drain FromRadio until it returns empty.
 * The module answers my_info, metadata, node_info*, config, channels, config_complete_id,
 * then any packets it queued while the phone was away. Afterwards each FromNum
 * notification means "more to read".
 */
import type {
  ConnectionState,
  RadioAck,
  RadioInterface,
  RadioPacket,
  SendOptions,
  Unsubscribe,
} from '../RadioInterface';
import { randomMessageId } from '../../crypto/envelope';
import {
  decodeFromRadio,
  encodePacket,
  encodeWantConfig,
  routingErrorName,
  type NodeSummary,
  type RadioEvent,
} from './framing';
import { Routing_Error } from './proto/meshtastic/mesh_pb';

/** Byte-level BLE link to one Meshtastic module. */
export interface BleLink {
  writeToRadio(bytes: Uint8Array): Promise<void>;
  /** Reads one FromRadio message; resolves with an empty array when the queue is empty. */
  readFromRadio(): Promise<Uint8Array>;
  onFromNum(listener: () => void): Unsubscribe;
  onDisconnected(listener: () => void): Unsubscribe;
  disconnect(): Promise<void>;
}

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(l: Listener<T>): Unsubscribe {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(value: T) {
    this.listeners.forEach(l => l(value));
  }
}

export class MeshtasticAdapter implements RadioInterface {
  private state: ConnectionState = 'disconnected';
  private myNodeNum: number | undefined;
  private configId = 0;
  private draining = false;
  private drainAgain = false;
  private subscriptions: Unsubscribe[] = [];

  readonly nodes = new Map<number, NodeSummary>();
  firmwareVersion: string | undefined;

  private packets = new Emitter<RadioPacket>();
  private acks = new Emitter<RadioAck>();
  private states = new Emitter<ConnectionState>();
  private nodeChanges = new Emitter<NodeSummary>();
  private rawEvents = new Emitter<RadioEvent>();

  constructor(private readonly link: BleLink) {}

  get connectionState() {
    return this.state;
  }

  get localNode() {
    return this.myNodeNum;
  }

  async start(): Promise<void> {
    if (this.subscriptions.length === 0) {
      this.subscriptions.push(
        this.link.onFromNum(() => {
          void this.drain();
        }),
        this.link.onDisconnected(() => this.setState('disconnected')),
      );
    }
    await this.resync();
  }

  private async resync(): Promise<void> {
    this.setState('syncing');
    this.configId = randomMessageId() || 1;
    await this.link.writeToRadio(encodeWantConfig(this.configId));
    await this.drain();
  }

  async stop(): Promise<void> {
    this.subscriptions.forEach(u => u());
    this.subscriptions = [];
    await this.link.disconnect();
    this.setState('disconnected');
  }

  async send(
    payload: Uint8Array,
    destination: number,
    options: SendOptions = {},
  ): Promise<number> {
    if (this.state !== 'ready')
      throw new Error(`radio not ready (${this.state})`);
    const id = randomMessageId() || 1;
    await this.link.writeToRadio(
      encodePacket({
        id,
        to: destination,
        payload,
        wantAck: options.wantAck ?? true,
      }),
    );
    return id;
  }

  onReceive(l: Listener<RadioPacket>) {
    return this.packets.on(l);
  }
  onAck(l: Listener<RadioAck>) {
    return this.acks.on(l);
  }
  onConnectionState(l: Listener<ConnectionState>) {
    return this.states.on(l);
  }
  onNode(l: Listener<NodeSummary>) {
    return this.nodeChanges.on(l);
  }
  /** Every decoded event, for the prototype log. */
  onRawEvent(l: Listener<RadioEvent>) {
    return this.rawEvents.on(l);
  }

  /** Reads FromRadio until empty. Re-runs if a notification arrives meanwhile. */
  async drain(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        for (;;) {
          const bytes = await this.link.readFromRadio();
          if (bytes.length === 0) break;
          this.handle(bytes);
        }
      } while (this.drainAgain);
    } finally {
      this.draining = false;
    }
  }

  private handle(bytes: Uint8Array) {
    let event: RadioEvent;
    try {
      event = decodeFromRadio(bytes);
    } catch (e) {
      event = { kind: 'ignored', reason: `decode error: ${String(e)}` };
    }
    this.rawEvents.emit(event);
    switch (event.kind) {
      case 'myInfo':
        this.myNodeNum = event.myNodeNum;
        break;
      case 'firmware':
        this.firmwareVersion = event.version;
        break;
      case 'nodeInfo':
        this.nodes.set(event.node.num, event.node);
        this.nodeChanges.emit(event.node);
        break;
      case 'configComplete':
        if (event.configId === this.configId) this.setState('ready');
        break;
      case 'rebooted':
        // Module restarted: its state is gone, sync again.
        void this.resync();
        break;
      case 'wavepodPacket':
        this.packets.emit({
          from: event.from,
          to: event.to,
          packetId: event.packetId,
          payload: event.payload,
          rxTime: event.rxTime,
          rxSnr: event.rxSnr,
          rxRssi: event.rxRssi,
          hopStart: event.hopStart,
          hopLimit: event.hopLimit,
        });
        break;
      case 'routing':
        if (event.requestId !== 0) {
          const ok = event.error === Routing_Error.NONE;
          this.acks.emit({
            packetId: event.requestId,
            from: event.from,
            ok,
            error: ok ? undefined : routingErrorName(event.error),
          });
        }
        break;
      default:
        break;
    }
  }

  private setState(state: ConnectionState) {
    if (state === this.state) return;
    this.state = state;
    this.states.emit(state);
  }
}
