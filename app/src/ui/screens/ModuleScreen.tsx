import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import type { ModuleStatus } from '../../app/moduleManager';
import { MIN_FIRMWARE } from '../../radio/meshtastic/provisioning';
import {
  requestBlePermissions,
  scanForModules,
  type FoundDevice,
} from '../../radio/meshtastic/bleLink';
import { Header, PrimaryButton } from '../components';
import { useModuleState } from '../hooks';
import { useStyles, useTheme, type Colors } from '../theme';

type Busy = null | 'connecting' | 'provisioning' | 'restoring';

export function ModuleScreen({
  s,
  back,
}: {
  s: AppServices;
  back: () => void;
}) {
  const { colors, ui } = useTheme();
  const styles = useStyles(makeStyles);
  const state = useModuleState(s);
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ModuleStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const autoDone = useRef<number | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const refresh = useCallback(async () => {
    setStatus(await s.modules.status());
  }, [s]);

  useEffect(() => {
    refresh();
  }, [refresh, state]);

  const provision = useCallback(async () => {
    setBusy('provisioning');
    setError(null);
    try {
      await s.modules.provision();
    } catch (e) {
      setError(`Configuration interrompue : ${String(e)}`);
    } finally {
      setBusy(null);
      refresh();
    }
  }, [s, refresh]);

  // A fresh module (nothing to warn about) is configured without asking.
  useEffect(() => {
    const node = s.hub.localNode;
    if (
      !status ||
      busy ||
      node === undefined ||
      autoDone.current === node ||
      status.firmware !== 'ok' ||
      status.plan.changes.length === 0 ||
      status.plan.warnings.length > 0
    ) {
      return;
    }
    autoDone.current = node;
    provision();
  }, [status, busy, s, provision]);

  const scan = async () => {
    setError(null);
    if (!(await requestBlePermissions())) {
      setError('Wavepod a besoin du Bluetooth pour parler à ton module.');
      return;
    }
    setDevices([]);
    setScanning(true);
    stopRef.current = scanForModules(
      d =>
        setDevices(prev =>
          prev.some(p => p.id === d.id) ? prev : [...prev, d],
        ),
      e => {
        setError(e.message);
        setScanning(false);
      },
    );
  };

  const connect = async (d: FoundDevice) => {
    stopRef.current?.();
    setScanning(false);
    setError(null);
    setBusy('connecting');
    try {
      await s.connectModule(d.id, d.name);
    } catch (e) {
      setError(`Connexion impossible : ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const confirmRestore = () =>
    Alert.alert(
      'Restaurer la configuration d’origine ?',
      'Le module reprendra les réglages qu’il avait avant Wavepod, puis redémarrera.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Restaurer',
          style: 'destructive',
          onPress: async () => {
            setBusy('restoring');
            try {
              await s.modules.restore();
              autoDone.current = s.hub.localNode ?? null; // do not re-apply right away
            } catch (e) {
              setError(`Restauration interrompue : ${String(e)}`);
            } finally {
              setBusy(null);
              refresh();
            }
          },
        },
      ],
    );

  const adapter = s.hub.adapter;
  const connected = state !== 'disconnected' && adapter;

  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Header title="Module radio" onBack={back} />

      {busy && (
        <View style={[ui.card, ui.row]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={ui.body}>
            {busy === 'connecting'
              ? 'Connexion au module…'
              : busy === 'provisioning'
              ? 'Configuration du module… il va redémarrer, garde-le près du téléphone.'
              : 'Restauration… le module va redémarrer.'}
          </Text>
        </View>
      )}

      {connected && (
        <View style={ui.card}>
          <Text style={ui.heading}>{s.moduleName()}</Text>
          <Text style={ui.muted}>
            {state === 'ready' ? 'Connecté' : 'Connexion…'} · firmware{' '}
            {adapter.firmwareVersion ?? '?'}
          </Text>
        </View>
      )}

      {status && !busy && (
        <ModuleSetup status={status} onProvision={provision} />
      )}

      {error && <Text style={ui.error}>{error}</Text>}

      {connected && !busy && <BackgroundTips />}

      {connected && !busy ? (
        <>
          {status?.hasBackup && (
            <PrimaryButton
              title="Restaurer la configuration d’origine"
              kind="secondary"
              onPress={confirmRestore}
            />
          )}
          <PrimaryButton
            title="Déconnecter"
            kind="secondary"
            onPress={() => s.disconnectModule()}
          />
        </>
      ) : (
        !busy && (
          <>
            <Text style={ui.muted}>
              Allume ton module et garde-le près du téléphone.
            </Text>
            <PrimaryButton
              title={scanning ? 'Recherche…' : 'Chercher un module'}
              onPress={scan}
              disabled={scanning}
            />
            <FlatList
              scrollEnabled={false}
              data={devices}
              keyExtractor={d => d.id}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  style={styles.item}
                  onPress={() => connect(item)}
                >
                  <Text style={ui.body}>{item.name}</Text>
                  <Text style={ui.muted}>Signal {item.rssi ?? '?'} dBm</Text>
                </Pressable>
              )}
            />
          </>
        )
      )}
    </ScrollView>
  );
}

/** Keeping the BLE link alive with the screen off depends on the platform. */
function BackgroundTips() {
  const { ui } = useTheme();
  if (Platform.OS === 'android') {
    return (
      <View style={ui.card}>
        <Text style={ui.heading}>Écran éteint</Text>
        <Text style={ui.muted}>
          Pour recevoir tes messages quand le téléphone dort, autorise Wavepod à
          fonctionner sans restriction de batterie. Certains téléphones arrêtent
          sinon l’application au bout de quelques minutes.
        </Text>
        <PrimaryButton
          title="Réglages de batterie"
          kind="secondary"
          onPress={() =>
            Linking.sendIntent(
              'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
            ).catch(() => Linking.openSettings())
          }
        />
      </View>
    );
  }
  return (
    <View style={ui.card}>
      <Text style={ui.heading}>Écran éteint</Text>
      <Text style={ui.muted}>
        Wavepod reste connecté à ton module en arrière-plan. Ne le ferme pas en
        le balayant depuis le sélecteur d’apps : iOS couperait la connexion
        jusqu’à sa prochaine ouverture.
      </Text>
    </View>
  );
}

function ModuleSetup({
  status,
  onProvision,
}: {
  status: ModuleStatus;
  onProvision: () => void;
}) {
  const { ui } = useTheme();
  const styles = useStyles(makeStyles);
  if (status.firmware === 'too-old') {
    return (
      <View style={ui.card}>
        <Text style={ui.error}>
          Firmware trop ancien ({status.firmwareVersion}). Mets le module à jour
          (version {MIN_FIRMWARE} ou plus récente) avec le flasheur web
          Meshtastic.
        </Text>
      </View>
    );
  }
  if (status.plan.changes.length === 0) {
    return (
      <View style={ui.card}>
        <Text style={[ui.heading, styles.ok]}>Module prêt pour Wavepod</Text>
        <Text style={ui.muted}>
          Région Europe, position coupée, nom neutre.
        </Text>
      </View>
    );
  }
  return (
    <View style={ui.card}>
      <Text style={ui.heading}>Configuration pour Wavepod</Text>
      {status.firmware === 'unknown' && (
        <Text style={ui.muted}>Version du firmware inconnue.</Text>
      )}
      {status.plan.warnings.length > 0 && (
        <Text style={ui.error}>
          Ce module semble configuré pour un autre usage (
          {status.plan.warnings.join(' ; ')}). Sa configuration actuelle sera
          sauvegardée et pourra être restaurée.
        </Text>
      )}
      {status.plan.changes.map(c => (
        <Text key={c} style={ui.body}>
          • {c}
        </Text>
      ))}
      <PrimaryButton title="Configurer le module" onPress={onProvision} />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    item: {
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    ok: { color: c.success },
  });
