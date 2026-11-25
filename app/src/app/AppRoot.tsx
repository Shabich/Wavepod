/**
 * Startup: loads the identity and opens the encrypted database before showing the app.
 * On a BootstrapError the user can reset (old data is unreadable without the keys).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  BootstrapError,
  bootstrap,
  resetAll,
  type Bootstrapped,
} from '../storage/bootstrap';
import { KeychainSecretStore, OpSqliteFactory } from '../storage/native';
import { AppNavigator } from '../ui/AppNavigator';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; app: Bootstrapped }
  | { kind: 'error'; error: string; recoverable: boolean };

const secrets = new KeychainSecretStore();
const files = new OpSqliteFactory();

export function AppRoot() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const start = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', app: await bootstrap(secrets, files) });
    } catch (e) {
      setState({
        kind: 'error',
        error:
          e instanceof BootstrapError
            ? e.kind === 'keys-missing'
              ? 'Les clés de cet appareil sont introuvables : les anciens messages ne peuvent plus être lus.'
              : 'La base locale ne peut pas être déchiffrée.'
            : String(e),
        recoverable: e instanceof BootstrapError,
      });
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const confirmReset = () =>
    Alert.alert(
      'Repartir de zéro ?',
      'Une nouvelle identité sera créée. Les anciens messages et contacts seront supprimés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réinitialiser',
          style: 'destructive',
          onPress: async () => {
            await resetAll(secrets, files);
            start();
          },
        },
      ],
    );

  if (state.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{state.error}</Text>
        {state.recoverable && (
          <Button title="Repartir de zéro" onPress={confirmReset} />
        )}
      </View>
    );
  }
  return <AppNavigator identity={state.app.identity} db={state.app.db} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  error: { color: '#b00020', textAlign: 'center' },
});
