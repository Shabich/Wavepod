import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppServices } from '../../app/services';
import {
  requestBlePermissions,
  scanForModules,
  type FoundDevice,
} from '../../radio/meshtastic/bleLink';
import { Header, PrimaryButton } from '../components';
import { useModuleState } from '../hooks';
import { ui } from '../theme';

export function ModuleScreen({
  s,
  back,
}: {
  s: AppServices;
  back: () => void;
}) {
  const state = useModuleState(s);
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

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
    try {
      await s.connectModule(d.id, d.name);
      back();
    } catch (e) {
      setError(`Connexion impossible : ${String(e)}`);
    }
  };

  const adapter = s.hub.adapter;

  return (
    <View style={ui.screen}>
      <Header title="Module radio" onBack={back} />
      {state !== 'disconnected' && adapter ? (
        <View style={ui.card}>
          <Text style={ui.heading}>{s.moduleName()}</Text>
          <Text style={ui.muted}>
            {state === 'ready' ? 'Connecté' : 'Connexion…'} · firmware{' '}
            {adapter.firmwareVersion ?? '?'}
          </Text>
          <PrimaryButton
            title="Déconnecter"
            kind="secondary"
            onPress={() => s.disconnectModule()}
          />
        </View>
      ) : (
        <Text style={ui.muted}>
          Allume ton module et garde-le près du téléphone.
        </Text>
      )}
      {error && <Text style={ui.error}>{error}</Text>}
      <PrimaryButton
        title={scanning ? 'Recherche…' : 'Chercher un module'}
        onPress={scan}
        disabled={scanning}
      />
      <FlatList
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
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d5dd',
  },
});
