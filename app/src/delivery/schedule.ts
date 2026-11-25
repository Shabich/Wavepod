/**
 * Pure send decision for one outbox entry. No I/O, no clock: everything is passed in.
 *
 * Lifecycle of an entry:
 *   waiting ──(contact seen recently)──▶ burst: attempt, +30 s, +2 min, +5 min
 *   burst exhausted ──▶ waiting again (not failed): only a new signal from the contact
 *   or the periodic probe sends it again. TTL expiry ──▶ failed.
 */
import { burstSize, type DeliveryPolicy } from './policy';

export interface OutboxEntry {
  contactId: string;
  messageId: number;
  envelope: Uint8Array;
  createdAt: number;
  expiresAt: number;
  /** Attempts since creation (statistics). */
  attempts: number;
  /** Attempts in the current burst. 0 = waiting; burstSize = exhausted. */
  burstAttempts: number;
  lastAttemptAt: number | null;
  packetId: number | null;
  /** Manual resend: start a burst now even if the contact was not seen recently. */
  forced: boolean;
}

export interface ContactState {
  lastSeenAt: number | null;
  lastProbeAt: number | null;
  /** Radio address; without one there is nowhere to send. */
  nodeNum: number | null;
}

export type Decision =
  | { kind: 'expire' }
  | { kind: 'send'; probe: boolean }
  /** until = null: nothing scheduled, wait for a signal from the contact. */
  | { kind: 'wait'; until: number | null };

export function decide(
  entry: OutboxEntry,
  contact: ContactState,
  isOldestForContact: boolean,
  now: number,
  policy: DeliveryPolicy,
): Decision {
  if (now >= entry.expiresAt) return { kind: 'expire' };
  if (contact.nodeNum === null) return { kind: 'wait', until: entry.expiresAt };

  const max = burstSize(policy);

  // Inside a burst: follow the retry schedule, whatever the presence says.
  if (entry.burstAttempts > 0 && entry.burstAttempts < max) {
    const due =
      (entry.lastAttemptAt ?? now) +
      policy.retryDelaysMs[entry.burstAttempts - 1];
    return now >= due
      ? { kind: 'send', probe: false }
      : { kind: 'wait', until: Math.min(due, entry.expiresAt) };
  }

  // Waiting, never tried in this burst: start one if the contact was heard recently.
  const recentlySeen =
    contact.lastSeenAt !== null &&
    now - contact.lastSeenAt <= policy.presenceWindowMs;
  if (entry.burstAttempts === 0 && (recentlySeen || entry.forced)) {
    return { kind: 'send', probe: false };
  }

  // Unreachable (or burst exhausted): only the oldest entry probes, periodically.
  if (!isOldestForContact) return { kind: 'wait', until: entry.expiresAt };
  const base = Math.max(
    contact.lastProbeAt ?? 0,
    entry.lastAttemptAt ?? 0,
    entry.createdAt,
  );
  const due = base + policy.probeIntervalMs;
  if (now >= due) return { kind: 'send', probe: true };
  return { kind: 'wait', until: Math.min(due, entry.expiresAt) };
}
