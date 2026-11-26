import {
  AirtimeMeter,
  LONG_FAST,
  onAirBytes,
  timeOnAirMs,
} from '../src/radio/airtime';
import {
  BEACON_WINDOW_MS,
  beaconToken,
  encodeBeacon,
  isBeacon,
  matchBeacon,
  nextBeaconDelay,
} from '../src/presence/beacon';
import { identityFromMasterSeed, newMasterSeed } from '../src/crypto/identity';
import { decodeHeader } from '../src/protocol/codec';

describe('timeOnAirMs', () => {
  it('matches the reference value for SF7/125 kHz, 10 bytes (41.2 ms)', () => {
    const ms = timeOnAirMs(10, {
      spreadingFactor: 7,
      bandwidthHz: 125_000,
      codingRate: 1,
      preambleSymbols: 8,
      explicitHeader: true,
      crc: true,
    });
    expect(ms).toBeCloseTo(41.216, 2);
  });

  it('uses low data rate optimisation for SF12/125 kHz', () => {
    const ms = timeOnAirMs(20, {
      spreadingFactor: 12,
      bandwidthHz: 125_000,
      codingRate: 1,
      preambleSymbols: 8,
      explicitHeader: true,
      crc: true,
    });
    // Tsym 32.768 ms > 16 ms: DE=1. 12.25 + 8 + ceil(160/40)*5=28 symbols → 40.25 * 32.768
    expect(ms).toBeCloseTo(1318.9, 0);
  });

  it('gives LongFast orders of magnitude consistent with WAVEPOD.md', () => {
    // beacon: 31 bytes on air ≈ 0.48 s (preamble alone 166 ms)
    expect(timeOnAirMs(onAirBytes(9, false))).toBeCloseTo(477.2, 0);
    const dm = timeOnAirMs(onAirBytes(60, true));
    expect(dm).toBeGreaterThan(500);
    expect(dm).toBeLessThan(1000);
    expect(LONG_FAST.spreadingFactor).toBe(11);
  });
});

describe('AirtimeMeter', () => {
  it('sums the last hour only', () => {
    let t = 0;
    const m = new AirtimeMeter(() => t);
    m.record(40, true);
    t = 30 * 60_000;
    m.record(40, true);
    const two = m.usedMs();
    expect(m.count()).toBe(2);
    t = 61 * 60_000;
    expect(m.count()).toBe(1);
    expect(m.usedMs()).toBeCloseTo(two / 2, 5);
    expect(m.usedShare()).toBeCloseTo(m.usedMs() / 360_000, 8);
  });
});

describe('beacon', () => {
  const a = identityFromMasterSeed(newMasterSeed());
  const b = identityFromMasterSeed(newMasterSeed());
  const contacts = [
    { name: 'A', beaconKey: a.beaconKey },
    { name: 'B', beaconKey: b.beaconKey },
    { name: 'C', beaconKey: null },
  ];
  const now = 1_700_000_000_000;

  it('is 9 bytes, recognised and attributed to the right contact', () => {
    const beacon = encodeBeacon(b.beaconKey, now);
    expect(beacon.length).toBe(9);
    expect(isBeacon(beacon)).toBe(true);
    expect(matchBeacon(beacon, contacts, now)?.name).toBe('B');
  });

  it('tolerates one window of clock drift, not more', () => {
    const beacon = encodeBeacon(a.beaconKey, now);
    expect(matchBeacon(beacon, contacts, now + BEACON_WINDOW_MS)?.name).toBe(
      'A',
    );
    expect(matchBeacon(beacon, contacts, now - BEACON_WINDOW_MS)?.name).toBe(
      'A',
    );
    expect(
      matchBeacon(beacon, contacts, now + 3 * BEACON_WINDOW_MS),
    ).toBeNull();
  });

  it('changes token every window and rejects unknown or forged beacons', () => {
    expect(beaconToken(a.beaconKey, 1)).not.toEqual(
      beaconToken(a.beaconKey, 2),
    );
    const stranger = identityFromMasterSeed(newMasterSeed());
    expect(
      matchBeacon(encodeBeacon(stranger.beaconKey, now), contacts, now),
    ).toBeNull();
    const forged = encodeBeacon(a.beaconKey, now);
    forged[5] ^= 1;
    expect(matchBeacon(forged, contacts, now)).toBeNull();
  });

  it('is not mistaken for an encrypted envelope', () => {
    expect(() => decodeHeader(encodeBeacon(a.beaconKey, now))).toThrow(
      'too short',
    );
  });

  it('derives a stable beacon key from the seed', () => {
    const seed = newMasterSeed();
    expect(identityFromMasterSeed(seed).beaconKey).toEqual(
      identityFromMasterSeed(seed).beaconKey,
    );
    expect(a.beaconKey.length).toBe(16);
  });

  it('jitters the interval by ±25 %', () => {
    expect(nextBeaconDelay(20 * 60_000, () => 0)).toBe(15 * 60_000);
    expect(nextBeaconDelay(20 * 60_000, () => 1)).toBe(25 * 60_000);
  });
});
