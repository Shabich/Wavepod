import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, ui } from './theme';

const LOGO = require('./assets/orque.png');

export function PrimaryButton({
  title,
  onPress,
  disabled,
  kind = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        kind === 'secondary' && styles.secondary,
        pressed &&
          (kind === 'secondary' ? styles.secondaryPressed : styles.pressed),
        disabled && styles.dimmed,
      ]}
    >
      <Text
        style={[styles.label, kind === 'secondary' && styles.secondaryLabel]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Header({
  title,
  onBack,
}: {
  title: string;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={12}>
          <Text style={ui.back}>‹ Retour</Text>
        </Pressable>
      )}
      <Text style={ui.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

/** Orca logo, square, sized in points. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <Image
      source={LOGO}
      style={{ width: size, height: size }}
      accessibilityLabel="Wavepod"
    />
  );
}

/** Round initial for a contact. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.white, fontWeight: '700' },
  pressed: { backgroundColor: colors.primaryDark },
  secondaryPressed: { backgroundColor: colors.mist },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dimmed: { opacity: 0.45 },
  label: { color: colors.white, fontSize: 16, fontWeight: '600' },
  secondaryLabel: { color: colors.primary },
  header: { gap: 4 },
});
