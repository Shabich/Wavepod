import { decide, type OutboxEntry } from '../src/delivery/schedule';
import { DEFAULT_POLICY as P } from '../src/delivery/policy';

const MIN = 60_000;
const T0 = 1_000_000_000;

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  contactId: 'c',
  messageId: 1,
  envelope: new Uint8Array(),
  createdAt: T0,
  expiresAt: T0 + P.ttlMs,
  attempts: 0,
  burstAttempts: 0,
  lastAttemptAt: null,
  packetId: null,
  forced: false,
  ...over,
});

const seen = (at: number | null, over = {}) => ({
  lastSeenAt: at,
  lastProbeAt: null,
  nodeNum: 42,
  ...over,
});

describe('decide', () => {
  it('sends at once to a contact seen recently', () => {
    expect(decide(entry(), seen(T0 - 5 * MIN), true, T0, P)).toEqual({
      kind: 'send',
      probe: false,
    });
  });

  it('waits without emitting for a contact not seen recently', () => {
    const d = decide(entry(), seen(T0 - 30 * MIN), true, T0, P);
    expect(d).toEqual({ kind: 'wait', until: T0 + P.probeIntervalMs });
  });

  it('waits when the contact has no radio address', () => {
    expect(decide(entry(), seen(T0, { nodeNum: null }), true, T0, P)).toEqual({
      kind: 'wait',
      until: T0 + P.ttlMs,
    });
  });

  it('follows the retry schedule inside a burst', () => {
    const e = entry({ burstAttempts: 1, attempts: 1, lastAttemptAt: T0 });
    expect(decide(e, seen(T0), true, T0 + 10_000, P)).toEqual({
      kind: 'wait',
      until: T0 + 30_000,
    });
    expect(decide(e, seen(T0), true, T0 + 30_000, P).kind).toBe('send');
    const e3 = entry({ burstAttempts: 3, lastAttemptAt: T0 });
    expect(decide(e3, seen(T0), true, T0 + 5 * MIN - 1, P).kind).toBe('wait');
    expect(decide(e3, seen(T0), true, T0 + 5 * MIN, P).kind).toBe('send');
  });

  it('keeps retrying a burst even if the contact is no longer seen', () => {
    const e = entry({ burstAttempts: 2, lastAttemptAt: T0 });
    expect(decide(e, seen(null), true, T0 + 2 * MIN, P).kind).toBe('send');
  });

  it('goes back to waiting after an exhausted burst, even if seen recently', () => {
    const e = entry({ burstAttempts: 4, attempts: 4, lastAttemptAt: T0 });
    expect(decide(e, seen(T0), true, T0 + MIN, P)).toEqual({
      kind: 'wait',
      until: T0 + P.probeIntervalMs,
    });
  });

  it('probes with the oldest entry only', () => {
    const at = T0 + P.probeIntervalMs;
    expect(decide(entry(), seen(null), true, at, P)).toEqual({
      kind: 'send',
      probe: true,
    });
    expect(decide(entry(), seen(null), false, at, P)).toEqual({
      kind: 'wait',
      until: T0 + P.ttlMs,
    });
  });

  it('spaces probes from the last probe of the contact', () => {
    const lastProbe = T0 + 3 * 60 * MIN;
    const d = decide(
      entry(),
      seen(null, { lastProbeAt: lastProbe }),
      true,
      lastProbe + MIN,
      P,
    );
    expect(d).toEqual({ kind: 'wait', until: lastProbe + P.probeIntervalMs });
  });

  it('starts a burst on manual resend even if the contact is unreachable', () => {
    expect(decide(entry({ forced: true }), seen(null), false, T0, P)).toEqual({
      kind: 'send',
      probe: false,
    });
  });

  it('expires at the TTL, whatever the state', () => {
    expect(decide(entry(), seen(T0), true, T0 + P.ttlMs, P)).toEqual({
      kind: 'expire',
    });
    const inBurst = entry({
      burstAttempts: 1,
      lastAttemptAt: T0 + P.ttlMs - 1,
    });
    expect(decide(inBurst, seen(T0), true, T0 + P.ttlMs, P).kind).toBe(
      'expire',
    );
  });

  it('never schedules a wake-up after the TTL', () => {
    const e = entry({ expiresAt: T0 + 10 * MIN });
    expect(decide(e, seen(null), true, T0, P)).toEqual({
      kind: 'wait',
      until: T0 + 10 * MIN,
    });
  });
});
