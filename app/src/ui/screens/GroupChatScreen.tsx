import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import { MAX_GROUP_TEXT } from '../../groups/codec';
import { ME, type Group, type GroupMessage } from '../../storage/groups';
import type { Contact } from '../../storage/contacts';
import { ProfileService } from '../../profile/service';
import {
  Header,
  LinkBanner,
  PrimaryButton,
  ProfileAvatar,
} from '../components';
import { timeLabel } from '../format';
import { useLink } from '../hooks';
import { radius, useStyles, useTheme, type Colors } from '../theme';

const bytes = (t: string) => new TextEncoder().encode(t).length;

interface Row extends GroupMessage {
  delivery?: { delivered: number; total: number };
}

export function GroupChatScreen({
  s,
  groupId,
  back,
}: {
  s: AppServices;
  groupId: string;
  back: () => void;
}) {
  const { ui, colors, scheme } = useTheme();
  const styles = useStyles(makeStyles);
  const link = useLink(s);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Contact[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    setGroup(await s.groupsRepo.get(groupId));
    const ids = await s.groupsRepo.members(groupId);
    const list = await Promise.all(ids.map(id => s.engine.contacts.get(id)));
    setMembers(list.filter((c): c is Contact => c !== null));
    const msgs = await s.groupsRepo.messages(groupId);
    setRows(
      await Promise.all(
        msgs.map(async m =>
          m.sender === ME
            ? {
                ...m,
                delivery: await s.groups.deliveryOf(groupId, m.messageId),
              }
            : m,
        ),
      ),
    );
  }, [s, groupId]);

  useEffect(() => {
    load();
    const off = s.groups.onChange(load);
    s.setOpenChat(`group:${groupId}`);
    return () => {
      off();
      s.setOpenChat(null);
    };
  }, [s, groupId, load]);

  const byId = new Map(members.map(m => [m.id, m]));

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await s.groups.send(groupId, text);
      setDraft('');
    } catch (e) {
      Alert.alert('Message non envoyé', String(e));
    }
  };

  if (!group) return <View style={ui.screen} />;
  const used = bytes(draft);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={ui.screen}>
        <Header title={group.name} onBack={back} />
        <View style={styles.members}>
          {members.map(m => (
            <ProfileAvatar
              key={m.id}
              avatar={ProfileService.avatarOf(m)}
              size={28}
            />
          ))}
          <Text style={ui.muted}>
            {members.length + 1} membres · {members.map(m => m.name).join(', ')}
          </Text>
        </View>
        <LinkBanner state={link.state} since={link.since} />

        <FlatList
          style={styles.flex}
          data={[...rows].reverse()}
          inverted
          keyExtractor={m => String(m.messageId)}
          renderItem={({ item }) => {
            const mine = item.sender === ME;
            const author = mine ? null : byId.get(item.sender);
            return (
              <View style={[styles.line, mine && styles.lineMine]}>
                {!mine && (
                  <ProfileAvatar
                    avatar={
                      author
                        ? ProfileService.avatarOf(author)
                        : { icon: 0, color: 7 }
                    }
                    size={30}
                  />
                )}
                <View style={[styles.bubble, mine ? styles.out : styles.in]}>
                  {!mine && (
                    <Text style={styles.author}>
                      {author?.name ?? 'Membre'}
                    </Text>
                  )}
                  <Text style={mine ? styles.outText : ui.body}>
                    {item.body}
                  </Text>
                  <Text style={[styles.meta, mine && styles.outText]}>
                    {timeLabel(item.createdAt)}
                    {item.delivery
                      ? ` · livré à ${item.delivery.delivered}/${item.delivery.total}`
                      : ''}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        <View style={ui.row}>
          <TextInput
            style={[ui.input, styles.flex]}
            value={draft}
            onChangeText={t => bytes(t) <= MAX_GROUP_TEXT && setDraft(t)}
            placeholder="Message au groupe"
            placeholderTextColor={colors.placeholder}
            keyboardAppearance={scheme}
            multiline
          />
          <PrimaryButton
            title="Envoyer"
            onPress={send}
            disabled={!draft.trim()}
          />
        </View>
        {used > MAX_GROUP_TEXT - 30 && (
          <Text style={ui.muted}>
            {MAX_GROUP_TEXT - used} caractères restants
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    members: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexWrap: 'wrap',
    },
    line: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 6,
      marginVertical: 3,
    },
    lineMine: { justifyContent: 'flex-end' },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.bubble,
      maxWidth: '78%',
    },
    out: { backgroundColor: c.primary },
    in: { backgroundColor: c.surface },
    outText: { color: c.onPrimary, fontSize: 15 },
    author: {
      color: c.accent,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 2,
    },
    meta: { fontSize: 11, marginTop: 4, opacity: 0.75, color: c.text },
  });
