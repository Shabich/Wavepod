/** BLE UUIDs from meshtastic/firmware src/BluetoothCommon.h (v2.8.2). */
export const MESH_SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
export const TORADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
export const FROMRADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
export const FROMNUM_UUID = 'ed9da18c-a800-4f66-a670-aa7547e34453';

/**
 * Meshtastic port carrying Wavepod envelopes. PRIVATE_APP (256) is meant for development;
 * a dedicated port number in the 256-511 range should be requested before release.
 */
export const WAVEPOD_PORTNUM = 256;

export const BROADCAST_ADDR = 0xffffffff;
export const DEFAULT_HOP_LIMIT = 3;
