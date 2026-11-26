import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppServices } from '../../app/services';
import type { Contact } from '../../storage/contacts';
import { Avatar, Logo, PrimaryButton } from '../components';
import { lastSeenLabel } from '../format';
import { useEngineTick, useModuleState } from '../hooks';
import { colors, ui } from '../theme';
import type { Navigate } from '../navigation';
import { MetaRepository } from '../../storage/meta';

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
  const [steps, setSteps] = useState<{
    name: boolean;
    module: boolean;
    contact: boolean;
  } | null>(null);

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

      // "Pour commencer" until the three steps were done once.
      const meta = new MetaRepository(s.db);
      if ((await meta.get('onboarding_done')) === '1') {
        setSteps(null);
        return;
      }
      const status = await s.modules.status();
      const done = {
        name: (await s.contacts.displayName()) !== '',
        module:
          status !== null &&
          status.firmware !== 'too-old' &&
          status.plan.changes.length === 0,
        contact: list.length > 0,
      };
      if (done.name && done.module && done.contact) {
        await meta.set('onboarding_done', '1');
        setSteps(null);
      } else {
        setSteps(done);
      }
    })();
  }, [s, tick, moduleState]);

  return (
    <View style={ui.screen}>
      <View style={styles.brand}>
        <Logo size={44} />
        <Text style={styles.wordmark}>Wavepod</Text>
      </View>

      {steps && (
        <View style={ui.card}>
          <Text style={ui.heading}>Pour commencer</Text>
          <Step
            done={steps.name}
            label="Choisis ton pseudo"
            onPress={() => go({ name: 'myQr' })}
          />
          <Step
            done={steps.module}
            label="Connecte et configure ton module"
            onPress={() => go({ name: 'module' })}
          />
          <Step
            done={steps.contact}
            label="Ajoute ton premier contact"
            onPress={() => go({ name: 'addContact' })}
          />
        </View>
      )}

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
            style={({ pressed }) => [
              styles.contact,
              pressed && styles.contactPressed,
            ]}
          >
            <Avatar name={item.name} />
            <View style={styles.flex}>
              <Text style={ui.body}>
                {item.name}
                {item.verified ? '  ✓' : ''}
              </Text>
              <Text style={ui.muted}>{lastSeenLabel(item.lastSeenAt)}</Text>
            </View>
            {pending[item.id] > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {pending[item.id]} en attente
                </Text>
              </View>
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

function Step({
  done,
  label,
  onPress,
}: {
  done: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={done}>
      <Text style={[ui.body, done && styles.stepDone]}>
        {done ? '✓' : '○'} {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepDone: { color: colors.slate, textDecorationLine: 'line-through' },
  flex: { flex: 1 },
  module: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  dotOk: { backgroundColor: colors.success },
  actions: { gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.night,
    letterSpacing: -0.5,
  },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
  },
  contactPressed: { backgroundColor: colors.mist },
  badge: {
    backgroundColor: colors.mist,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: colors.primaryDark, fontSize: 12, fontWeight: '600' },
  diag: { textAlign: 'center', color: colors.slate },
});
