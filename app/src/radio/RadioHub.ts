/**
 * Stable RadioInterface for the app's lifetime. The current Meshtastic adapter can be
 * attached, detached or replaced (reconnection, other module) without recreating the
 * delivery engine: with nothing attached the hub is simply 'disconnected'.
 */
import type {
  ConnectionState,
  RadioAck,
  RadioInterface,
  RadioPacket,
  SendOptions,
  Unsubscribe,
} from './RadioInterface';
import type { MeshtasticAdapter } from './meshtastic/MeshtasticAdapter';

type L<T> = (v: T) => void;

export class RadioHub implements RadioInterface {
  private current: MeshtasticAdapter | null = null;
  private detachers: Unsubscribe[] = [];
  private readonly rx = new Set<L<RadioPacket>>();
  private readonly ax = new Set<L<RadioAck>>();
  private readonly sx = new Set<L<ConnectionState>>();
  private lastState: ConnectionState = 'disconnected';

  get adapter() {
    return this.current;
  }

  get connectionState(): ConnectionState {
    return this.current?.connectionState ?? 'disconnected';
  }

  get localNode() {
    return this.current?.localNode;
  }

  attach(adapter: MeshtasticAdapter) {
    this.detach();
    this.current = adapter;
    this.detachers = [
      adapter.onReceive(p => this.rx.forEach(l => l(p))),
      adapter.onAck(a => this.ax.forEach(l => l(a))),
      adapter.onConnectionState(() => this.emitState()),
    ];
    this.emitState();
  }

  detach() {
    this.detachers.forEach(u => u());
    this.detachers = [];
    this.current = null;
    this.emitState();
  }

  send(payload: Uint8Array, destination: number, options?: SendOptions) {
    if (!this.current) return Promise.reject(new Error('no module connected'));
    return this.current.send(payload, destination, options);
  }

  onReceive(l: L<RadioPacket>) {
    this.rx.add(l);
    return () => this.rx.delete(l);
  }

  onAck(l: L<RadioAck>) {
    this.ax.add(l);
    return () => this.ax.delete(l);
  }

  onConnectionState(l: L<ConnectionState>) {
    this.sx.add(l);
    return () => this.sx.delete(l);
  }

  private emitState() {
    const s = this.connectionState;
    if (s === this.lastState) return;
    this.lastState = s;
    this.sx.forEach(l => l(s));
  }
}
