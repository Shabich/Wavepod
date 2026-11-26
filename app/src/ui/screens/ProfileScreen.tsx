import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  MAX_BIO,
  MAX_PROFILE_NAME,
  type Profile,
} from '../../profile/avatar';
import { Header, ProfileAvatar } from '../components';
import { useStyles, useTheme, type Colors } from '../theme';

const bytes = (t: string) => new TextEncoder().encode(t).length;

export function ProfileScreen({
  s,
  back,
}: {
  s: AppServices;
  back: () => void;
}) {
  const { ui, colors, scheme } = useTheme();
  const styles = useStyles(makeStyles);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    s.profile.get().then(p => {
      setProfile(p);
      setName(p.name);
      setBio(p.bio);
    });
  }, [s]);

  const save = useCallback(
    async (changes: Partial<Profile>) => {
      try {
        setError(null);
        setProfile(await s.profile.set(changes));
      } catch (e) {
        setError(
          String(e).includes('too long') ? 'Texte trop long.' : String(e),
        );
      }
    },
    [s],
  );

  if (!profile) return <View style={ui.screen} />;

  return (
    <ScrollView
      contentContainerStyle={ui.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Header title="Mon profil" onBack={back} />

      <View style={styles.preview}>
        <ProfileAvatar avatar={profile.avatar} size={96} />
        <Text style={ui.title}>{name.trim() || 'Ton pseudo'}</Text>
        {!!bio.trim() && (
          <Text style={[ui.muted, styles.center]}>{bio.trim()}</Text>
        )}
      </View>

      <Text style={ui.heading}>Pseudo</Text>
      <TextInput
        style={ui.input}
        value={name}
        onChangeText={t => bytes(t) <= MAX_PROFILE_NAME && setName(t)}
        onBlur={() => save({ name })}
        onSubmitEditing={() => save({ name })}
        placeholder="Comment tes contacts te voient"
        placeholderTextColor={colors.placeholder}
        keyboardAppearance={scheme}
        returnKeyType="done"
      />

      <Text style={ui.heading}>Bio</Text>
      <TextInput
        style={[ui.input, styles.bio]}
        value={bio}
        onChangeText={t => bytes(t) <= MAX_BIO && setBio(t)}
        onBlur={() => save({ bio })}
        placeholder="Optionnel : « guide en Vanoise », « dispo le soir »…"
        placeholderTextColor={colors.placeholder}
        keyboardAppearance={scheme}
        multiline
      />
      <Text style={ui.muted}>{MAX_BIO - bytes(bio)} caractères restants</Text>

      <Text style={ui.heading}>Icône</Text>
      <View style={styles.grid}>
        {AVATAR_ICONS.map((key, i) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Icône ${key}`}
            accessibilityState={{ selected: i === profile.avatar.icon }}
            onPress={() => save({ avatar: { ...profile.avatar, icon: i } })}
            style={[styles.cell, i === profile.avatar.icon && styles.selected]}
          >
            <ProfileAvatar
              avatar={{ icon: i, color: profile.avatar.color }}
              size={44}
            />
          </Pressable>
        ))}
      </View>

      <Text style={ui.heading}>Couleur</Text>
      <View style={styles.colors}>
        {AVATAR_COLORS.map((c, i) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`Couleur ${i + 1}`}
            accessibilityState={{ selected: i === profile.avatar.color }}
            onPress={() => save({ avatar: { ...profile.avatar, color: i } })}
            style={[
              styles.swatch,
              { backgroundColor: c },
              i === profile.avatar.color && styles.swatchOn,
            ]}
          />
        ))}
      </View>

      {error && <Text style={ui.error}>{error}</Text>}
      <Text style={ui.muted}>
        Ton profil est envoyé une fois à chacun de tes contacts, puis à chaque
        modification (un message de moins de 130 octets).
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    preview: { alignItems: 'center', gap: 8, paddingVertical: 8 },
    center: { textAlign: 'center' },
    bio: { minHeight: 64, textAlignVertical: 'top' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    cell: {
      padding: 3,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    selected: { borderColor: c.accent },
    colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    swatch: { width: 40, height: 40, borderRadius: 20 },
    swatchOn: { borderWidth: 3, borderColor: c.text },
  });
