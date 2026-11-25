/**
 * BleLink over the meshtasticd TCP API (Node.js only, for development and tests).
 * Frames pushed by the node are queued; readFromRadio pops them like the BLE
 * FromRadio characteristic, and each new frame triggers a FromNum-like notification.
 */
import net from 'node:net';
import type { BleLink } from '../../src/radio/meshtastic/MeshtasticAdapter';
import {
  FrameDecoder,
  encodeFrame,
} from '../../src/radio/meshtastic/streamFraming';

export async function connectTcp(host: string, port: number): Promise<BleLink> {
  const socket = net.createConnection({ host, port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.setNoDelay(true);

  const decoder = new FrameDecoder();
  const queue: Uint8Array[] = [];
  const fromNum = new Set<() => void>();
  const closed = new Set<() => void>();

  socket.on('data', chunk => {
    const frames = decoder.push(new Uint8Array(chunk));
    if (frames.length === 0) return;
    queue.push(...frames);
    fromNum.forEach(l => l());
  });
  socket.on('close', () => closed.forEach(l => l()));

  return {
    async writeToRadio(bytes) {
      await new Promise<void>((resolve, reject) =>
        socket.write(encodeFrame(bytes), e => (e ? reject(e) : resolve())),
      );
    },
    async readFromRadio() {
      return queue.shift() ?? new Uint8Array(0);
    },
    onFromNum(l) {
      fromNum.add(l);
      return () => fromNum.delete(l);
    },
    onDisconnected(l) {
      closed.add(l);
      return () => closed.delete(l);
    },
    async disconnect() {
      socket.end();
    },
  };
}
