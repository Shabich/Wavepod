import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppServices } from '../../app/services';
import type { Contact } from '../../storage/contacts';
import { PrimaryButton } from '../components';
import { lastSeenLabel } from '../format';
import { useEngineTick, useModuleState } from '../hooks';
import { MUTED, OCEAN, OK, ui } from '../theme';
import type { Navigate } from '../navigation';

const MODULE_LABEL = {
  disconnected: 'Aucun module connecté',
  connecting: 'Connexion au module…',
  syncing: 'Synchronisation…',
  ready: 'Module connecté',
} as const;

export function HomeScreen({ s, go }: { s: AppServices; go: Navigate }) {
  const tick = useEngineTick(s);
  const moduleState = useModuleState(s);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const list = await s.engine.contacts.list();
      setContacts(list);
      const counts: Record<string, number> = {};
      for (const c of list) {
        const msgs = await s.engine.messages.listForContact(c.id, 50);
        counts[c.id] = msgs.filter(
          m =>
            m.direction === 'out' &&
            ['pending', 'sent', 'moduleAck'].includes(m.status),
        ).length;
      }
      setPending(counts);
    })();
  }, [s, tick]);

  return (
    <View style={ui.screen}>
      <Text style={ui.title}>Wavepod</Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => go({ name: 'module' })}
        style={[ui.card, styles.module]}
      >
        <View style={[styles.dot, moduleState === 'ready' && styles.dotOk]} />
        <View style={styles.flex}>
          <Text style={ui.heading}>{MODULE_LABEL[moduleState]}</Text>
          <Text style={ui.muted}>
            {s.moduleName() ?? 'Toucher pour choisir un module'}
          </Text>
        </View>
      </Pressable>

      <View style={[ui.row, styles.actions]}>
        <View style={styles.flex}>
          <PrimaryButton title="Mon QR" onPress={() => go({ name: 'myQr' })} />
        </View>
        <View style={styles.flex}>
          <PrimaryButton
            title="Ajouter"
            kind="secondary"
            onPress={() => go({ name: 'addContact' })}
          />
        </View>
      </View>

      <Text style={ui.heading}>Contacts</Text>
      <FlatList
        data={contacts}
        keyExtractor={c => c.id}
        ListEmptyComponent={
          <Text style={ui.muted}>
            Aucun contact. Montre ton QR à quelqu’un à côté de toi, puis scanne
            le sien.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => go({ name: 'chat', contactId: item.id })}
            style={styles.contact}
          >
            <View style={styles.flex}>
              <Text style={ui.body}>
                {item.name}
                {item.verified ? '  ✓' : ''}
              </Text>
              <Text style={ui.muted}>{lastSeenLabel(item.lastSeenAt)}</Text>
            </View>
            {pending[item.id] > 0 && (
              <Text style={styles.pending}>{pending[item.id]} en attente</Text>
            )}
          </Pressable>
        )}
      />

      <Pressable onPress={() => go({ name: 'diagnostics' })}>
        <Text style={[ui.muted, styles.diag]}>Diagnostic</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  module: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#d0d5dd' },
  dotOk: { backgroundColor: OK },
  actions: { gap: 12 },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d5dd',
  },
  pending: { color: OCEAN, fontSize: 13 },
  diag: { textAlign: 'center', color: MUTED },
});
