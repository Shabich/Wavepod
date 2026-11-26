/**
 * LoRa time on air (Semtech SX127x/SX126x formula) and a sliding-hour meter,
 * to keep Wavepod's own transmissions well under the duty cycle.
 */

export interface LoraParams {
  spreadingFactor: number;
  bandwidthHz: number;
  /** 1 = 4/5 … 4 = 4/8 */
  codingRate: number;
  preambleSymbols: number;
  explicitHeader: boolean;
  crc: boolean;
}

/** Meshtastic LongFast: SF11, 250 kHz, 4/5, 16-symbol preamble. */
export const LONG_FAST: LoraParams = {
  spreadingFactor: 11,
  bandwidthHz: 250_000,
  codingRate: 1,
  preambleSymbols: 16,
  explicitHeader: true,
  crc: true,
};

/** EU_868 default sub-band 869.4–869.65 MHz: 10 % duty cycle (firmware RadioInterface.cpp). */
export const EU868_DUTY_CYCLE = 0.1;

/**
 * Bytes a Wavepod payload occupies on air: Meshtastic header (16) + encrypted
 * Data protobuf around it (~6), + PKI overhead (12) for direct messages. Approximation.
 */
export function onAirBytes(payloadLength: number, direct: boolean) {
  return payloadLength + 16 + 6 + (direct ? 12 : 0);
}

export function timeOnAirMs(
  payloadBytes: number,
  p: LoraParams = LONG_FAST,
): number {
  const tSym = (2 ** p.spreadingFactor / p.bandwidthHz) * 1000;
  const lowDataRateOptimize = tSym > 16 ? 1 : 0;
  const preamble = (p.preambleSymbols + 4.25) * tSym;
  const numerator =
    8 * payloadBytes -
    4 * p.spreadingFactor +
    28 +
    (p.crc ? 16 : 0) -
    (p.explicitHeader ? 0 : 20);
  const denominator = 4 * (p.spreadingFactor - 2 * lowDataRateOptimize);
  const payloadSymbols =
    8 + Math.max(Math.ceil(numerator / denominator) * (p.codingRate + 4), 0);
  return preamble + payloadSymbols * tSym;
}

/** Our own transmissions over the last hour. */
export class AirtimeMeter {
  private entries: { at: number; ms: number }[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly dutyCycle = EU868_DUTY_CYCLE,
  ) {}

  record(payloadLength: number, direct: boolean) {
    this.entries.push({
      at: this.now(),
      ms: timeOnAirMs(onAirBytes(payloadLength, direct)),
    });
    this.prune();
  }

  /** Milliseconds transmitted during the last hour. */
  usedMs(): number {
    this.prune();
    return this.entries.reduce((sum, e) => sum + e.ms, 0);
  }

  /** Share of the hourly duty-cycle budget used (0..1+). */
  usedShare(): number {
    return this.usedMs() / (3_600_000 * this.dutyCycle);
  }

  count(): number {
    this.prune();
    return this.entries.length;
  }

  private prune() {
    const limit = this.now() - 3_600_000;
    while (this.entries.length && this.entries[0].at < limit)
      this.entries.shift();
  }
}
