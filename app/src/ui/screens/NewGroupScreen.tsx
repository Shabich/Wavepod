import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import type { Contact } from '../../storage/contacts';
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME } from '../../groups/codec';
import { ProfileService } from '../../profile/service';
import { Header, PrimaryButton, ProfileAvatar } from '../components';
import { useStyles, useTheme, type Colors } from '../theme';

const bytes = (t: string) => new TextEncoder().encode(t).length;

export function NewGroupScreen({
  s,
  back,
  openGroup,
}: {
  s: AppServices;
  back: () => void;
  openGroup: (groupId: string) => void;
}) {
  const { ui, colors, scheme } = useTheme();
  const styles = useStyles(makeStyles);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const max = MAX_GROUP_MEMBERS - 1;

  useEffect(() => {
    s.engine.contacts.listVisible().then(setContacts);
  }, [s]);

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < max) next.add(id);
      return next;
    });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const g = await s.groups.createGroup(name, [...selected]);
      openGroup(g.id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <View style={ui.screen}>
      <Header title="Nouveau groupe" onBack={back} />
      <TextInput
        style={ui.input}
        value={name}
        onChangeText={t => bytes(t) <= MAX_GROUP_NAME && setName(t)}
        placeholder="Nom du groupe (« Cordée », « Famille »…)"
        placeholderTextColor={colors.placeholder}
        keyboardAppearance={scheme}
      />
      <Text style={ui.muted}>
        Membres : {selected.size}/{max}. Chacun recevra la clé du groupe par
        message chiffré, dès qu’il sera à portée.
      </Text>
      <FlatList
        style={styles.flex}
        data={contacts}
        keyExtractor={c => c.id}
        ListEmptyComponent={
          <Text style={ui.muted}>
            Ajoute d’abord des contacts avec leur QR.
          </Text>
        }
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(item.id)}
              style={styles.row}
            >
              <ProfileAvatar avatar={ProfileService.avatarOf(item)} size={40} />
              <Text style={[ui.body, styles.flex]}>{item.name}</Text>
              <View style={[styles.box, on && styles.boxOn]}>
                {on && <Text style={styles.check}>✓</Text>}
              </View>
            </Pressable>
          );
        }}
      />
      {error && <Text style={ui.error}>{error}</Text>}
      <PrimaryButton
        title="Créer le groupe"
        onPress={create}
        disabled={busy || !name.trim() || selected.size === 0}
      />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
    },
    box: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: { backgroundColor: c.primary, borderColor: c.primary },
    check: { color: c.onPrimary, fontWeight: '700' },
  });
