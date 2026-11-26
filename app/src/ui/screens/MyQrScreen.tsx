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
import { useStyles, useTheme, type Colors } from '../theme';

export function MyQrScreen({ s, back }: { s: AppServices; back: () => void }) {
  const { colors, scheme, ui } = useTheme();
  const styles = useStyles(makeStyles);
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
    backgroundColor?: string;
  }>;

  return (
    <ScrollView contentContainerStyle={[ui.screen, styles.content]}>
      <Header title="Mon QR" onBack={back} />
      <Text style={ui.muted}>
        Ton pseudo, visible par la personne qui te scanne
      </Text>
      <TextInput
        placeholderTextColor={colors.placeholder}
        keyboardAppearance={scheme}
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
          <QRCode
            value={card.link}
            size={260}
            ecl="M"
            color={colors.qrForeground}
            backgroundColor={colors.qrBackground}
          />
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

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    content: { flexGrow: 1 },
    // White frame in both modes: cameras read dark modules on a light background.
    qr: {
      alignSelf: 'center',
      padding: 14,
      marginVertical: 8,
      borderRadius: 16,
      backgroundColor: c.qrBackground,
    },
  });
