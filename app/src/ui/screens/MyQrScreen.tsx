import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import { MAX_NAME_BYTES } from '../../contacts/card';
import { Header, PrimaryButton } from '../components';
import { useModuleState } from '../hooks';
import { colors, ui } from '../theme';

export function MyQrScreen({ s, back }: { s: AppServices; back: () => void }) {
  const moduleState = useModuleState(s);
  const [name, setName] = useState('');
  const [card, setCard] = useState<{
    link: string;
    includesModule: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    s.contacts.displayName().then(setName);
  }, [s]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setCard(await s.contacts.myCardLink());
    } catch (e) {
      setError(String(e));
    }
  }, [s]);

  useEffect(() => {
    refresh();
  }, [refresh, moduleState]);

  const saveName = async () => {
    await s.contacts.setDisplayName(name);
    refresh();
  };

  // Lazy: react-native-svg is a native module, not loaded until needed.
  const QRCode = require('react-native-qrcode-svg')
    .default as React.ComponentType<{
    value: string;
    size: number;
    ecl?: 'L' | 'M' | 'Q' | 'H';
    color?: string;
  }>;

  return (
    <ScrollView contentContainerStyle={[ui.screen, styles.content]}>
      <Header title="Mon QR" onBack={back} />
      <Text style={ui.muted}>
        Ton pseudo, visible par la personne qui te scanne
      </Text>
      <TextInput
        style={ui.input}
        value={name}
        onChangeText={setName}
        onBlur={saveName}
        onSubmitEditing={saveName}
        placeholder="Ton pseudo"
        maxLength={MAX_NAME_BYTES}
        returnKeyType="done"
      />
      <View style={styles.qr}>
        {card && (
          <QRCode value={card.link} size={260} ecl="M" color={colors.night} />
        )}
      </View>
      {card && !card.includesModule && (
        <Text style={ui.error}>
          Connecte ton module avant de montrer ce QR : sans lui, ton contact ne
          pourra pas t’écrire tout de suite.
        </Text>
      )}
      {error && <Text style={ui.error}>{error}</Text>}
      <Text style={ui.muted}>
        Fais scanner ce code à la personne à côté de toi, puis scanne le sien.
        Tes clés ne quittent jamais ton téléphone : ce code ne contient que des
        informations publiques.
      </Text>
      {card && (
        <PrimaryButton
          title="Partager le lien"
          kind="secondary"
          onPress={() => Share.share({ message: card.link })}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  qr: { alignItems: 'center', paddingVertical: 12 },
});
