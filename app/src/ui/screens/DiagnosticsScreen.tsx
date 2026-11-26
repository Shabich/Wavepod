import React, { useEffect, useReducer, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppServices } from '../../app/services';
import { runSelfTest } from '../../diagnostics/cryptoSelfTest';
import { runStorageSelfTest } from '../../storage/selfTest';
import { Header } from '../components';
import { useStyles, useTheme, type Colors } from '../theme';

export function DiagnosticsScreen({
  s,
  back,
}: {
  s: AppServices;
  back: () => void;
}) {
  const { ui } = useTheme();
  const styles = useStyles(makeStyles);
  const [crypto] = useState(runSelfTest);
  const [storage, setStorage] = useState('test en cours…');
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    runStorageSelfTest().then(r => setStorage(r.detail));
    return s.onLog(bump);
  }, [s]);

  const adapter = s.hub.adapter;
  return (
    <View style={ui.screen}>
      <Header title="Diagnostic" onBack={back} />
      <Text style={ui.body}>Chiffrement : {crypto.detail}</Text>
      <Text style={ui.body}>Stockage : {storage}</Text>
      <Text style={ui.body}>Identité : {s.identity.contactId}</Text>
      <Text style={ui.body}>
        Module : {s.hub.connectionState}
        {adapter?.localNode !== undefined
          ? ` · nœud ${adapter.localNode.toString(16)} · firmware ${
              adapter.firmwareVersion ?? '?'
            }`
          : ''}
      </Text>
      <Text style={ui.heading}>Journal</Text>
      <ScrollView style={styles.log}>
        {s.log.map((l, i) => (
          <Text key={i} style={styles.line}>
            {l}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    log: { flex: 1 },
    line: { fontFamily: 'Menlo', fontSize: 11, color: c.text },
  });
