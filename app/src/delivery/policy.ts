/** Delivery timing rules (see WAVEPOD.md, "Livraison fiable"). */
export interface DeliveryPolicy {
  /** A contact heard within this window is considered reachable. */
  presenceWindowMs: number;
  /** Delays after attempt 1, 2, 3… of a burst. Burst size = 1 + retries. */
  retryDelaysMs: number[];
  /** Fallback probe for an unreachable contact (oldest waiting message only). */
  probeIntervalMs: number;
  /** A message not delivered within this time fails. */
  ttlMs: number;
  /** Minimum gap between two transmissions, to spare airtime. */
  spacingMs: number;
  /** How long incoming message ids are remembered for de-duplication. */
  dedupRetentionMs: number;
}

const MIN = 60_000;

export const DEFAULT_POLICY: DeliveryPolicy = {
  presenceWindowMs: 25 * MIN,
  retryDelaysMs: [30_000, 2 * MIN, 5 * MIN],
  probeIntervalMs: 90 * MIN,
  ttlMs: 24 * 60 * MIN,
  spacingMs: 3_000,
  dedupRetentionMs: 48 * 60 * MIN,
};

export const burstSize = (p: DeliveryPolicy) => 1 + p.retryDelaysMs.length;
