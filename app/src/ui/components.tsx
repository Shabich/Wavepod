import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, useStyles, useTheme, type Colors } from './theme';
import { durationLabel } from './format';
import { avatarIcon } from './avatarIcons';
import {
  AVATAR_COLORS,
  AVATAR_ICONS,
  clampAvatar,
  type Avatar,
} from '../profile/avatar';

const LOGO = {
  light: require('./assets/orque.png'),
  dark: require('./assets/orque-blanche.png'),
};

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
  const styles = useStyles(makeStyles);
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
  const { ui } = useTheme();
  const styles = useStyles(makeStyles);
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
  const { scheme } = useTheme();
  return (
    <Image
      source={LOGO[scheme]}
      style={{ width: size, height: size }}
      accessibilityLabel="Wavepod"
    />
  );
}

/** Profile avatar: the chosen icon, white, on the chosen color. */
export function ProfileAvatar({
  avatar,
  size = 44,
}: {
  avatar: Avatar;
  size?: number;
}) {
  const a = clampAvatar(avatar);
  const Icon = avatarIcon(a.icon);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Avatar ${AVATAR_ICONS[a.icon]}`}
      style={[
        avatarBase.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: AVATAR_COLORS[a.color],
        },
      ]}
    >
      <Icon color="#FFFFFF" size={size * 0.52} strokeWidth={2} />
    </View>
  );
}

const avatarBase = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    pressed: { backgroundColor: c.primaryPressed },
    secondaryPressed: { backgroundColor: c.surface },
    button: {
      backgroundColor: c.primary,
      borderRadius: radius.button,
      paddingVertical: 14,
      paddingHorizontal: 18,
      alignItems: 'center',
    },
    secondary: {
      backgroundColor: c.background,
      borderWidth: 1,
      borderColor: c.accent,
    },
    dimmed: { opacity: 0.45 },
    label: { color: c.onPrimary, fontSize: 16, fontWeight: '600' },
    secondaryLabel: { color: c.accent },
    header: { gap: 4 },
  });

/**
 * Shown while the module has been out of reach for more than a minute: outgoing
 * messages wait in the outbox, incoming ones sent meanwhile may be lost.
 */
export function LinkBanner({
  state,
  since,
}: {
  state: string;
  since: number | null;
}) {
  const { ui } = useTheme();
  const styles = useStyles(makeBannerStyles);
  if (state !== 'reconnecting' || since === null) return null;
  const down = Date.now() - since;
  if (down < 60_000) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={ui.heading}>
        Module hors de portée depuis {durationLabel(down)}
      </Text>
      <Text style={ui.muted}>
        Tes messages partiront dès son retour. Ceux qu’on t’envoie pendant la
        coupure peuvent être perdus : demande-les à nouveau si besoin.
      </Text>
    </View>
  );
}

const makeBannerStyles = (c: Colors) =>
  StyleSheet.create({
    banner: {
      backgroundColor: c.surface,
      borderLeftWidth: 4,
      borderLeftColor: c.danger,
      borderRadius: 12,
      padding: 12,
      gap: 4,
    },
  });
