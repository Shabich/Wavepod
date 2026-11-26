import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import type { Contact } from '../../storage/contacts';
import type { MessageStatus, StoredMessage } from '../../storage/delivery';
import { MAX_PLAINTEXT_LENGTH } from '../../protocol/codec';
import {
  Header,
  LinkBanner,
  PrimaryButton,
  ProfileAvatar,
} from '../components';
import { ProfileService } from '../../profile/service';
import { lastSeenLabel, timeLabel } from '../format';
import { useEngineTick, useLink } from '../hooks';
import { radius, useStyles, useTheme, type Colors } from '../theme';

const STATUS: Record<MessageStatus, string> = {
  pending: 'en attente',
  sent: 'envoyé',
  moduleAck: 'reçu par son module',
  delivered: 'livré',
  read: 'lu',
  failed: 'non livré',
  received: '',
};

const bytes = (t: string) => new TextEncoder().encode(t).length;

export function ChatScreen({
  s,
  contactId,
  back,
}: {
  s: AppServices;
  contactId: string;
  back: () => void;
}) {
  const { colors, scheme, ui } = useTheme();
  const styles = useStyles(makeStyles);
  const tick = useEngineTick(s, contactId);
  const link = useLink(s);

  useEffect(() => {
    s.setOpenChat(contactId);
    return () => s.setOpenChat(null);
  }, [s, contactId]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [showSafety, setShowSafety] = useState(false);

  useEffect(() => {
    s.engine.contacts.get(contactId).then(setContact);
    s.engine.messages.listForContact(contactId).then(setMessages);
  }, [s, contactId, tick]);

  if (!contact) return <View style={ui.screen} />;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await s.engine.sendText(contactId, text);
      setDraft('');
    } catch (e) {
      Alert.alert('Message non envoyé', String(e));
    }
  };

  const actions = (m: StoredMessage) => {
    if (
      m.direction !== 'out' ||
      m.status === 'delivered' ||
      m.status === 'read'
    )
      return;
    Alert.alert('Message pas encore livré', m.body, [
      {
        text: 'Renvoyer maintenant',
        onPress: () => s.engine.resend(contactId, m.messageId),
      },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => s.engine.cancel(contactId, m.messageId),
      },
      { text: 'Fermer', style: 'cancel' },
    ]);
  };

  const used = bytes(draft);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={ui.screen}>
        <Pressable onPress={() => setShowSafety(v => !v)}>
          <Header
            title={`${contact.name}${contact.verified ? ' ✓' : ''}`}
            onBack={back}
          />
          <View style={styles.who}>
            <ProfileAvatar
              avatar={ProfileService.avatarOf(contact)}
              size={40}
            />
            <View style={styles.flex}>
              <Text style={ui.muted}>{lastSeenLabel(contact.lastSeenAt)}</Text>
              {!!contact.bio && (
                <Text style={ui.muted} numberOfLines={2}>
                  {contact.bio}
                </Text>
              )}
            </View>
          </View>
        </Pressable>

        <LinkBanner state={link.state} since={link.since} />

        {showSafety && (
          <View style={ui.card}>
            <Text style={ui.muted}>Empreinte de sécurité</Text>
            <Text style={ui.safety}>
              {s.contacts.safetyNumberWith(contact)}
            </Text>
            <Text style={ui.muted}>
              Comparez-la sur vos deux téléphones, côte à côte.
            </Text>
            <PrimaryButton
              title={
                contact.verified
                  ? 'Retirer la vérification'
                  : 'Marquer comme vérifiée'
              }
              kind="secondary"
              onPress={async () => {
                await s.contacts.setVerified(contact.id, !contact.verified);
                setContact(await s.engine.contacts.get(contact.id));
              }}
            />
          </View>
        )}

        <FlatList
          style={styles.flex}
          data={[...messages].reverse()}
          inverted
          keyExtractor={m => `${m.direction}-${m.messageId}`}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => actions(item)}
              style={[
                styles.bubble,
                item.direction === 'out' ? styles.out : styles.in,
              ]}
            >
              <Text style={item.direction === 'out' ? styles.outText : ui.body}>
                {item.body}
              </Text>
              <Text
                style={[
                  styles.meta,
                  item.direction === 'out' && styles.outText,
                ]}
              >
                {timeLabel(item.createdAt)}
                {item.direction === 'out' ? ` · ${STATUS[item.status]}` : ''}
              </Text>
            </Pressable>
          )}
        />

        <View style={ui.row}>
          <TextInput
            placeholderTextColor={colors.placeholder}
            keyboardAppearance={scheme}
            style={[ui.input, styles.flex]}
            value={draft}
            onChangeText={t => bytes(t) <= MAX_PLAINTEXT_LENGTH && setDraft(t)}
            placeholder="Message"
            multiline
          />
          <PrimaryButton
            title="Envoyer"
            onPress={send}
            disabled={!draft.trim()}
          />
        </View>
        {used > MAX_PLAINTEXT_LENGTH - 30 && (
          <Text style={ui.muted}>
            {MAX_PLAINTEXT_LENGTH - used} caractères restants
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    who: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
    flex: { flex: 1 },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.bubble,
      marginVertical: 3,
      maxWidth: '80%',
    },
    out: { alignSelf: 'flex-end', backgroundColor: c.primary },
    in: { alignSelf: 'flex-start', backgroundColor: c.surface },
    outText: { color: c.onPrimary, fontSize: 15 },
    meta: { fontSize: 11, marginTop: 4, opacity: 0.75 },
  });
