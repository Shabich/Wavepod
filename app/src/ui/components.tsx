import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OCEAN, ui } from './theme';

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
        (pressed || disabled) && styles.dimmed,
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

const styles = StyleSheet.create({
  button: {
    backgroundColor: OCEAN,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: OCEAN,
  },
  dimmed: { opacity: 0.5 },
  label: { color: 'white', fontSize: 16, fontWeight: '600' },
  secondaryLabel: { color: OCEAN },
  header: { gap: 4 },
});
