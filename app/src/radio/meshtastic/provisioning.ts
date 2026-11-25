/**
 * Module provisioning: compare the module's configuration with what Wavepod needs and
 * produce the admin messages to apply (see WAVEPOD.md, "Appairage et configuration").
 * Pure functions; the adapter sends the result in one edit transaction.
 *
 * Every set_config replaces a whole section, so each section is rebuilt from the
 * module's current values with only Wavepod's fields overridden.
 */
import { clone, create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  AdminMessageSchema,
  type AdminMessage,
} from './proto/meshtastic/admin_pb';
import {
  ConfigSchema,
  Config_DeviceConfigSchema,
  Config_DeviceConfig_Role,
  Config_LoRaConfigSchema,
  Config_LoRaConfig_ModemPreset,
  Config_LoRaConfig_RegionCode,
  Config_PositionConfigSchema,
  Config_PositionConfig_GpsMode,
  type Config_BluetoothConfig,
  type Config_DeviceConfig,
  type Config_LoRaConfig,
  type Config_PositionConfig,
} from './proto/meshtastic/config_pb';
import {
  ModuleConfigSchema,
  ModuleConfig_TelemetryConfigSchema,
  type ModuleConfig_TelemetryConfig,
} from './proto/meshtastic/module_config_pb';
import { UserSchema, type User } from './proto/meshtastic/mesh_pb';
import { base64ToBytes as fromB64, bytesToBase64 as toB64 } from './base64';

export interface ModuleSnapshot {
  lora?: Config_LoRaConfig;
  device?: Config_DeviceConfig;
  position?: Config_PositionConfig;
  bluetooth?: Config_BluetoothConfig;
  telemetry?: ModuleConfig_TelemetryConfig;
}

/** Oldest firmware Wavepod accepts: PKI direct messages (2.5) and add_contact / next hop (2.6). */
export const MIN_FIRMWARE = '2.6.0';
/** Versions exercised so far (simulation). */
export const TESTED_FIRMWARE = ['2.7.26'];

export const HOP_LIMIT = 3;
const NODEINFO_SECS = 3 * 60 * 60;
const TELEMETRY_SECS = 24 * 60 * 60;

export type FirmwareStatus = 'ok' | 'too-old' | 'unknown';

export function firmwareStatus(version: string | undefined): FirmwareStatus {
  const v = parseVersion(version);
  if (!v) return 'unknown';
  return compareVersions(v, parseVersion(MIN_FIRMWARE)!) >= 0
    ? 'ok'
    : 'too-old';
}

export interface ProvisioningPlan {
  /** Human-readable list of what will change (French, shown before applying). */
  changes: string[];
  /** Reasons to think the module was set up for another use (shown as a warning). */
  warnings: string[];
  admin: AdminMessage[];
}

export interface PlanInput {
  snapshot: ModuleSnapshot;
  nodeNum: number;
  /** Our own User (owner) from the NodeDB. */
  owner?: User;
}

const WAVEPOD_NAME = /^WP-[0-9A-F]{4}$/;
const DEFAULT_NAME = /^Meshtastic [0-9a-f]{4}$/i;

export function neutralNames(nodeNum: number) {
  const tag = (nodeNum & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return { longName: `WP-${tag}`, shortName: tag };
}

export function planProvisioning({
  snapshot,
  nodeNum,
  owner,
}: PlanInput): ProvisioningPlan {
  const changes: string[] = [];
  const warnings: string[] = [];
  const admin: AdminMessage[] = [];
  const setConfig = (
    variant: Parameters<typeof create<typeof ConfigSchema>>[1],
  ) =>
    admin.push(
      create(AdminMessageSchema, {
        payloadVariant: {
          case: 'setConfig',
          value: create(ConfigSchema, variant),
        },
      }),
    );

  // LoRa: region, preset, hops. Without a region the module never transmits.
  const lora = snapshot.lora
    ? clone(Config_LoRaConfigSchema, snapshot.lora)
    : create(Config_LoRaConfigSchema);
  const loraChanges: string[] = [];
  if (lora.region !== Config_LoRaConfig_RegionCode.EU_868) {
    if (lora.region !== Config_LoRaConfig_RegionCode.UNSET) {
      warnings.push(
        `région actuelle : ${Config_LoRaConfig_RegionCode[lora.region]}`,
      );
    }
    loraChanges.push('région Europe 868 MHz');
    lora.region = Config_LoRaConfig_RegionCode.EU_868;
  }
  if (
    !lora.usePreset ||
    lora.modemPreset !== Config_LoRaConfig_ModemPreset.LONG_FAST
  ) {
    if (!lora.usePreset) warnings.push('réglages radio personnalisés');
    loraChanges.push('profil radio LongFast');
    lora.usePreset = true;
    lora.modemPreset = Config_LoRaConfig_ModemPreset.LONG_FAST;
  }
  if (lora.hopLimit !== HOP_LIMIT) {
    loraChanges.push(`${HOP_LIMIT} relais maximum`);
    lora.hopLimit = HOP_LIMIT;
  }
  if (!lora.txEnabled) {
    loraChanges.push('émission activée');
    lora.txEnabled = true;
  }
  if (loraChanges.length) {
    changes.push(...loraChanges);
    setConfig({ payloadVariant: { case: 'lora', value: lora } });
  }

  // Device: plain client, NodeInfo no more often than every 3 h.
  const device = snapshot.device
    ? clone(Config_DeviceConfigSchema, snapshot.device)
    : create(Config_DeviceConfigSchema);
  const deviceChanges: string[] = [];
  const role = device.role;
  if (
    role !== Config_DeviceConfig_Role.CLIENT &&
    role !== Config_DeviceConfig_Role.CLIENT_MUTE
  ) {
    warnings.push(`rôle actuel : ${Config_DeviceConfig_Role[role] ?? role}`);
    deviceChanges.push('rôle client (module de poche)');
    device.role = Config_DeviceConfig_Role.CLIENT;
  }
  if (
    device.nodeInfoBroadcastSecs !== 0 &&
    device.nodeInfoBroadcastSecs < NODEINFO_SECS
  ) {
    deviceChanges.push('annonce du module toutes les 3 h');
    device.nodeInfoBroadcastSecs = NODEINFO_SECS;
  }
  if (deviceChanges.length) {
    changes.push(...deviceChanges);
    setConfig({ payloadVariant: { case: 'device', value: device } });
  }

  // Position: off by default (privacy).
  const position = snapshot.position
    ? clone(Config_PositionConfigSchema, snapshot.position)
    : create(Config_PositionConfigSchema);
  if (
    position.gpsMode !== Config_PositionConfig_GpsMode.DISABLED ||
    position.fixedPosition ||
    position.positionBroadcastSmartEnabled
  ) {
    changes.push('position et GPS désactivés');
    position.gpsMode = Config_PositionConfig_GpsMode.DISABLED;
    position.gpsEnabled = false;
    position.fixedPosition = false;
    position.positionBroadcastSmartEnabled = false;
    setConfig({ payloadVariant: { case: 'position', value: position } });
  }

  // Telemetry: not broadcast (airtime and privacy).
  const telemetry = snapshot.telemetry
    ? clone(ModuleConfig_TelemetryConfigSchema, snapshot.telemetry)
    : create(ModuleConfig_TelemetryConfigSchema);
  if (
    telemetry.deviceTelemetryEnabled ||
    telemetry.environmentMeasurementEnabled ||
    telemetry.airQualityEnabled ||
    telemetry.powerMeasurementEnabled ||
    telemetry.healthMeasurementEnabled ||
    telemetry.deviceUpdateInterval < TELEMETRY_SECS
  ) {
    changes.push('télémétrie non diffusée');
    telemetry.deviceTelemetryEnabled = false;
    telemetry.environmentMeasurementEnabled = false;
    telemetry.airQualityEnabled = false;
    telemetry.powerMeasurementEnabled = false;
    telemetry.healthMeasurementEnabled = false;
    telemetry.deviceUpdateInterval = TELEMETRY_SECS;
    admin.push(
      create(AdminMessageSchema, {
        payloadVariant: {
          case: 'setModuleConfig',
          value: create(ModuleConfigSchema, {
            payloadVariant: { case: 'telemetry', value: telemetry },
          }),
        },
      }),
    );
  }

  // Owner: neutral names, so NodeInfo does not reveal who carries the module.
  const names = neutralNames(nodeNum);
  if (
    !owner ||
    owner.longName !== names.longName ||
    owner.shortName !== names.shortName
  ) {
    if (
      owner &&
      !WAVEPOD_NAME.test(owner.longName) &&
      !DEFAULT_NAME.test(owner.longName)
    ) {
      warnings.push(`nom actuel du module : « ${owner.longName} »`);
    }
    changes.push(`nom neutre ${names.longName}`);
    const user = owner ? clone(UserSchema, owner) : create(UserSchema);
    user.longName = names.longName;
    user.shortName = names.shortName;
    admin.push(
      create(AdminMessageSchema, {
        payloadVariant: { case: 'setOwner', value: user },
      }),
    );
  }

  return { changes, warnings, admin };
}

// ---------------------------------------------------------------- backup / restore

/** Serialized copy of the sections Wavepod changes, kept to restore them later. */
export interface ModuleBackup {
  lora?: string;
  device?: string;
  position?: string;
  telemetry?: string;
  owner?: string;
}

export function makeBackup(
  snapshot: ModuleSnapshot,
  owner?: User,
): ModuleBackup {
  const b64 = (bytes: Uint8Array) => toB64(bytes);
  return {
    lora:
      snapshot.lora && b64(toBinary(Config_LoRaConfigSchema, snapshot.lora)),
    device:
      snapshot.device &&
      b64(toBinary(Config_DeviceConfigSchema, snapshot.device)),
    position:
      snapshot.position &&
      b64(toBinary(Config_PositionConfigSchema, snapshot.position)),
    telemetry:
      snapshot.telemetry &&
      b64(toBinary(ModuleConfig_TelemetryConfigSchema, snapshot.telemetry)),
    owner: owner && b64(toBinary(UserSchema, owner)),
  };
}

export function restoreMessages(backup: ModuleBackup): AdminMessage[] {
  const out: AdminMessage[] = [];
  const cfg = (variant: Parameters<typeof create<typeof ConfigSchema>>[1]) =>
    out.push(
      create(AdminMessageSchema, {
        payloadVariant: {
          case: 'setConfig',
          value: create(ConfigSchema, variant),
        },
      }),
    );
  if (backup.lora) {
    cfg({
      payloadVariant: {
        case: 'lora',
        value: fromBinary(Config_LoRaConfigSchema, fromB64(backup.lora)),
      },
    });
  }
  if (backup.device) {
    cfg({
      payloadVariant: {
        case: 'device',
        value: fromBinary(Config_DeviceConfigSchema, fromB64(backup.device)),
      },
    });
  }
  if (backup.position) {
    cfg({
      payloadVariant: {
        case: 'position',
        value: fromBinary(
          Config_PositionConfigSchema,
          fromB64(backup.position),
        ),
      },
    });
  }
  if (backup.telemetry) {
    out.push(
      create(AdminMessageSchema, {
        payloadVariant: {
          case: 'setModuleConfig',
          value: create(ModuleConfigSchema, {
            payloadVariant: {
              case: 'telemetry',
              value: fromBinary(
                ModuleConfig_TelemetryConfigSchema,
                fromB64(backup.telemetry),
              ),
            },
          }),
        },
      }),
    );
  }
  if (backup.owner) {
    out.push(
      create(AdminMessageSchema, {
        payloadVariant: {
          case: 'setOwner',
          value: fromBinary(UserSchema, fromB64(backup.owner)),
        },
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function parseVersion(v: string | undefined): number[] | null {
  const m = v?.match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a: number[], b: number[]) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
