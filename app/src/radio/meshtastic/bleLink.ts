/**
 * BleLink implementation on react-native-ble-plx.
 * The BleManager is created lazily so importing this module has no native side effect;
 * call initBle() at app start so iOS can restore the BLE state after relaunching
 * the app in the background.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type {
  BleManager as BleManagerType,
  Device,
  Subscription,
} from 'react-native-ble-plx';
import type { Unsubscribe } from '../RadioInterface';
import type { BleLink } from './MeshtasticAdapter';
import {
  FROMNUM_UUID,
  FROMRADIO_UUID,
  MESH_SERVICE_UUID,
  TORADIO_UUID,
} from './constants';
import { base64ToBytes, bytesToBase64 } from './base64';

let manager: BleManagerType | undefined;

/** CoreBluetooth state restoration key (iOS 'bluetooth-central' background mode). */
const RESTORE_ID = 'wavepod-ble';

function getManager(log?: (line: string) => void): BleManagerType {
  if (!manager) {
    const { BleManager } =
      require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    manager = new BleManager({
      restoreStateIdentifier: RESTORE_ID,
      // iOS relaunched the app in the background with BLE state: the module manager
      // then reconnects to the remembered module, which resolves at once since the
      // peripheral is already connected at system level.
      restoreStateFunction: restored => {
        const n = restored?.connectedPeripherals?.length ?? 0;
        log?.(`BLE state restored (${n} connected peripheral(s))`);
      },
    });
  }
  return manager;
}

/** Creates the BLE manager early (must run at app start for iOS restoration). */
export function initBle(log?: (line: string) => void) {
  getManager(log);
}

export interface FoundDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  // Android 12+ (API 31) uses BLUETOOTH_SCAN/CONNECT; older versions need location for BLE scans.
  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(result).every(
    r => r === PermissionsAndroid.RESULTS.GRANTED,
  );
}

/** Scans for Meshtastic modules. Returns a stop function. */
export function scanForModules(
  onFound: (d: FoundDevice) => void,
  onError: (e: Error) => void,
) {
  const m = getManager();
  m.startDeviceScan([MESH_SERVICE_UUID], null, (error, device) => {
    if (error) {
      onError(error);
      return;
    }
    if (device)
      onFound({
        id: device.id,
        name: device.name ?? device.localName ?? device.id,
        rssi: device.rssi,
      });
  });
  return () => m.stopDeviceScan();
}

/**
 * Connects to a known module. No timeout: on iOS a pending connection request is
 * handled by the system and completes when the module comes back in range; on
 * Android autoConnect does the same. Cancel with cancelModuleConnection().
 */
export async function connectToModule(deviceId: string): Promise<BleLink> {
  const m = getManager();
  m.stopDeviceScan();
  let device: Device = await m.connectToDevice(deviceId, {
    requestMTU: 512,
    autoConnect: Platform.OS === 'android',
  });
  device = await device.discoverAllServicesAndCharacteristics();
  return new PlxBleLink(device);
}

export async function cancelModuleConnection(deviceId: string): Promise<void> {
  await getManager()
    .cancelDeviceConnection(deviceId)
    .catch(() => undefined);
}

class PlxBleLink implements BleLink {
  constructor(private readonly device: Device) {}

  async writeToRadio(bytes: Uint8Array): Promise<void> {
    await this.device.writeCharacteristicWithResponseForService(
      MESH_SERVICE_UUID,
      TORADIO_UUID,
      bytesToBase64(bytes),
    );
  }

  async readFromRadio(): Promise<Uint8Array> {
    const c = await this.device.readCharacteristicForService(
      MESH_SERVICE_UUID,
      FROMRADIO_UUID,
    );
    return c.value ? base64ToBytes(c.value) : new Uint8Array(0);
  }

  onFromNum(listener: () => void): Unsubscribe {
    const sub: Subscription = this.device.monitorCharacteristicForService(
      MESH_SERVICE_UUID,
      FROMNUM_UUID,
      error => {
        if (!error) listener();
      },
    );
    return () => sub.remove();
  }

  onDisconnected(listener: () => void): Unsubscribe {
    const sub = this.device.onDisconnected(() => listener());
    return () => sub.remove();
  }

  async disconnect(): Promise<void> {
    await this.device.cancelConnection();
  }
}
