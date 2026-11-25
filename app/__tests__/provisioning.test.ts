import { create } from '@bufbuild/protobuf';
import {
  firmwareStatus,
  makeBackup,
  neutralNames,
  planProvisioning,
  restoreMessages,
  type ModuleSnapshot,
} from '../src/radio/meshtastic/provisioning';
import {
  Config_DeviceConfigSchema,
  Config_DeviceConfig_Role,
  Config_LoRaConfigSchema,
  Config_LoRaConfig_ModemPreset,
  Config_LoRaConfig_RegionCode,
  Config_PositionConfigSchema,
  Config_PositionConfig_GpsMode,
} from '../src/radio/meshtastic/proto/meshtastic/config_pb';
import { ModuleConfig_TelemetryConfigSchema } from '../src/radio/meshtastic/proto/meshtastic/module_config_pb';
import {
  UserSchema,
  type User,
} from '../src/radio/meshtastic/proto/meshtastic/mesh_pb';
import type { AdminMessage } from '../src/radio/meshtastic/proto/meshtastic/admin_pb';

const NODE = 0xcc003f2a;

/** Applies admin messages to a snapshot, like the firmware would. */
function apply(
  snap: ModuleSnapshot,
  owner: User | undefined,
  admin: AdminMessage[],
) {
  const s: ModuleSnapshot = { ...snap };
  let o = owner;
  for (const m of admin) {
    const v = m.payloadVariant;
    if (v.case === 'setConfig') {
      const c = v.value.payloadVariant;
      if (c.case === 'lora') s.lora = c.value;
      if (c.case === 'device') s.device = c.value;
      if (c.case === 'position') s.position = c.value;
    } else if (v.case === 'setModuleConfig') {
      const c = v.value.payloadVariant;
      if (c.case === 'telemetry') s.telemetry = c.value;
    } else if (v.case === 'setOwner') {
      o = v.value;
    }
  }
  return { snapshot: s, owner: o };
}

const freshModule = (): { snapshot: ModuleSnapshot; owner: User } => ({
  snapshot: {
    lora: create(Config_LoRaConfigSchema, {
      region: Config_LoRaConfig_RegionCode.UNSET,
      usePreset: true,
      modemPreset: Config_LoRaConfig_ModemPreset.LONG_FAST,
      hopLimit: 3,
      txEnabled: true,
      txPower: 17,
    }),
    device: create(Config_DeviceConfigSchema, {
      role: Config_DeviceConfig_Role.CLIENT,
      nodeInfoBroadcastSecs: 10800,
    }),
    position: create(Config_PositionConfigSchema, {
      gpsMode: Config_PositionConfig_GpsMode.ENABLED,
      positionBroadcastSmartEnabled: true,
    }),
    telemetry: create(ModuleConfig_TelemetryConfigSchema, {
      deviceTelemetryEnabled: true,
      deviceUpdateInterval: 1800,
    }),
  },
  owner: create(UserSchema, {
    id: '!cc003f2a',
    longName: 'Meshtastic 3f2a',
    shortName: '3f2a',
    publicKey: new Uint8Array(32).fill(1),
  }),
});

describe('planProvisioning', () => {
  it('configures a fresh module without warnings', () => {
    const { snapshot, owner } = freshModule();
    const plan = planProvisioning({ snapshot, nodeNum: NODE, owner });
    expect(plan.warnings).toEqual([]);
    expect(plan.changes).toEqual([
      'région Europe 868 MHz',
      'position et GPS désactivés',
      'télémétrie non diffusée',
      'nom neutre WP-3F2A',
    ]);
    expect(plan.admin).toHaveLength(4);
  });

  it('is idempotent: nothing left to do after applying', () => {
    const { snapshot, owner } = freshModule();
    const plan = planProvisioning({ snapshot, nodeNum: NODE, owner });
    const after = apply(snapshot, owner, plan.admin);
    const again = planProvisioning({ ...after, nodeNum: NODE });
    expect(again.changes).toEqual([]);
    expect(again.admin).toEqual([]);
  });

  it('keeps unrelated settings and the module key', () => {
    const { snapshot, owner } = freshModule();
    const after = apply(
      snapshot,
      owner,
      planProvisioning({ snapshot, nodeNum: NODE, owner }).admin,
    );
    expect(after.snapshot.lora?.txPower).toBe(17);
    expect(after.owner?.publicKey).toEqual(new Uint8Array(32).fill(1));
    expect(after.owner?.id).toBe('!cc003f2a');
  });

  it('warns about a module set up for another use', () => {
    const { snapshot, owner } = freshModule();
    snapshot.lora!.region = Config_LoRaConfig_RegionCode.US;
    snapshot.lora!.usePreset = false;
    snapshot.device!.role = Config_DeviceConfig_Role.ROUTER;
    owner.longName = 'Relais du toit';
    const plan = planProvisioning({ snapshot, nodeNum: NODE, owner });
    expect(plan.warnings).toEqual([
      'région actuelle : US',
      'réglages radio personnalisés',
      'rôle actuel : ROUTER',
      'nom actuel du module : « Relais du toit »',
    ]);
    expect(plan.changes).toContain('rôle client (module de poche)');
  });

  it('accepts CLIENT_MUTE and slower NodeInfo as already fine', () => {
    const { snapshot, owner } = freshModule();
    snapshot.device!.role = Config_DeviceConfig_Role.CLIENT_MUTE;
    snapshot.device!.nodeInfoBroadcastSecs = 6 * 3600;
    const plan = planProvisioning({ snapshot, nodeNum: NODE, owner });
    expect(
      plan.changes.some(c => c.includes('rôle') || c.includes('annonce')),
    ).toBe(false);
  });

  it('works when nothing was received from the module', () => {
    const plan = planProvisioning({ snapshot: {}, nodeNum: NODE });
    expect(plan.changes).toContain('région Europe 868 MHz');
    expect(plan.changes).toContain('émission activée');
  });

  it('builds neutral names from the node number', () => {
    expect(neutralNames(0x12340abc)).toEqual({
      longName: 'WP-0ABC',
      shortName: '0ABC',
    });
  });
});

describe('firmwareStatus', () => {
  it.each([
    ['2.7.26.54e0d8d', 'ok'],
    ['2.6.0', 'ok'],
    ['2.5.20.abc', 'too-old'],
    ['1.3.0', 'too-old'],
    [undefined, 'unknown'],
    ['dev', 'unknown'],
  ])('%s → %s', (v, expected) => {
    expect(firmwareStatus(v)).toBe(expected);
  });
});

describe('backup', () => {
  it('restores the original sections', () => {
    const { snapshot, owner } = freshModule();
    const backup = makeBackup(snapshot, owner);
    const changed = apply(
      snapshot,
      owner,
      planProvisioning({ snapshot, nodeNum: NODE, owner }).admin,
    );
    const restored = apply(
      changed.snapshot,
      changed.owner,
      restoreMessages(JSON.parse(JSON.stringify(backup))),
    );
    expect(restored.snapshot.lora?.region).toBe(
      Config_LoRaConfig_RegionCode.UNSET,
    );
    expect(restored.snapshot.position?.gpsMode).toBe(
      Config_PositionConfig_GpsMode.ENABLED,
    );
    expect(restored.snapshot.telemetry?.deviceTelemetryEnabled).toBe(true);
    expect(restored.owner?.longName).toBe('Meshtastic 3f2a');
  });
});
