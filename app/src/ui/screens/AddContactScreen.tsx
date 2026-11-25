import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppServices } from '../../app/services';
import type { ScannedContact } from '../../contacts/service';
import { CardError, MAX_NAME_BYTES } from '../../contacts/card';
import { Header, PrimaryButton } from '../components';
import { QrScanner } from '../QrScanner';
import { ui } from '../theme';

const ERRORS: Record<string, string> = {
  'not a Wavepod contact link': 'Ce n’est pas un QR Wavepod.',
  'invalid signature': 'Ce QR a été modifié : il est refusé.',
  'this is your own card': 'C’est ton propre QR.',
};

export function AddContactScreen({
  s,
  back,
  openChat,
  initialLink,
}: {
  s: AppServices;
  back: () => void;
  openChat: (contactId: string) => void;
  initialLink?: string;
}) {
  const [pasted, setPasted] = useState('');
  const [scanned, setScanned] = useState<ScannedContact | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState(0);

  const inspect = useCallback(
    async (link: string) => {
      setError(null);
      try {
        const result = await s.contacts.inspect(link);
        setScanned(result);
        setName(result.existing?.name ?? result.card.name);
      } catch (e) {
        const msg = e instanceof CardError ? e.message : String(e);
        setError(ERRORS[msg] ?? 'QR illisible ou abîmé.');
        setScanKey(k => k + 1); // re-arm the scanner
      }
    },
    [s],
  );

  useEffect(() => {
    if (initialLink) inspect(initialLink);
  }, [initialLink, inspect]);

  const confirm = async (verified: boolean) => {
    if (!scanned) return;
    const c = await s.contacts.add(scanned, name);
    if (verified) await s.contacts.setVerified(c.id, true);
    openChat(c.id);
  };

  if (scanned) {
    return (
      <ScrollView contentContainerStyle={ui.screen}>
        <Header
          title={scanned.existing ? 'Mettre à jour' : 'Nouveau contact'}
          onBack={() => setScanned(null)}
        />
        <Text style={ui.muted}>Nom du contact</Text>
        <TextInput
          style={ui.input}
          value={name}
          onChangeText={setName}
          maxLength={MAX_NAME_BYTES}
        />
        <View style={ui.card}>
          <Text style={ui.muted}>Empreinte de sécurité</Text>
          <Text style={ui.safety}>{scanned.safetyNumber}</Text>
          <Text style={ui.muted}>
            Elle doit être identique sur vos deux téléphones (dans la
            conversation, touche le nom du contact). Si c’est le cas, personne
            ne s’est glissé entre vous.
          </Text>
        </View>
        <Text style={ui.muted}>
          {scanned.moduleName
            ? `Module : ${scanned.moduleName}`
            : 'Ce QR ne contient pas de module : vos messages partiront quand son module aura été vu.'}
        </Text>
        <PrimaryButton title="Ajouter" onPress={() => confirm(false)} />
        <PrimaryButton
          title="Ajouter, empreinte vérifiée"
          kind="secondary"
          onPress={() => confirm(true)}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[ui.screen, styles.content]}
      keyboardShouldPersistTaps="handled"
    >
      <Header title="Ajouter un contact" onBack={back} />
      <Text style={ui.muted}>
        Scanne le QR affiché sur le téléphone de ton contact.
      </Text>
      {initialLink && !error ? (
        <Text style={ui.muted}>Vérification du lien…</Text>
      ) : (
        <QrScanner key={scanKey} onCode={inspect} />
      )}
      {error && <Text style={ui.error}>{error}</Text>}
      <Text style={ui.muted}>Ou colle un lien wavepod://</Text>
      <TextInput
        style={ui.input}
        value={pasted}
        onChangeText={setPasted}
        placeholder="wavepod://add#…"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <PrimaryButton
        title="Valider le lien"
        kind="secondary"
        disabled={!pasted.trim()}
        onPress={() => inspect(pasted)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
});
