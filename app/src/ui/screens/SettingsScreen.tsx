import React, { useEffect, useReducer } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { AppServices } from '../../app/services';
import { BEACON_INTERVALS_MIN } from '../../presence/service';
import { EU868_DUTY_CYCLE } from '../../radio/airtime';
import { Header } from '../components';
import { durationLabel } from '../format';
import { useStyles, useTheme, type Colors } from '../theme';

export function SettingsScreen({
  s,
  back,
}: {
  s: AppServices;
  back: () => void;
}) {
  const { ui, colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [, refresh] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, []);

  const p = s.presence;
  const { discreet, intervalMin } = p.settings;
  const now = Date.now();
  const share = s.hub.airtime.usedShare();
  const budgetS = Math.round(3600 * EU868_DUTY_CYCLE);

  return (
    <ScrollView contentContainerStyle={ui.screen}>
      <Header title="Réglages" onBack={back} />

      <View style={ui.card}>
        <Text style={ui.heading}>Présence</Text>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={ui.body}>Mode discret</Text>
            <Text style={ui.muted}>
              Aucune émission spontanée : ni balise, ni relance automatique. Tes
              contacts ne te verront qu’à ton prochain message.
            </Text>
          </View>
          <Switch
            value={discreet}
            onValueChange={async v => {
              await p.setDiscreet(v);
              refresh();
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
            accessibilityLabel="Mode discret"
          />
        </View>

        <Text style={[ui.body, discreet && styles.disabled]}>
          Balise de présence
        </Text>
        <Text style={ui.muted}>
          Un court signal radio qui permet à tes contacts de voir « vu il y a X
          min ». Il ne contient ni ta position ni ton nom.
        </Text>
        <View style={styles.segments}>
          {BEACON_INTERVALS_MIN.map(m => (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{
                selected: m === intervalMin,
                disabled: discreet,
              }}
              disabled={discreet}
              onPress={async () => {
                await p.setInterval(m);
                refresh();
              }}
              style={[
                styles.segment,
                m === intervalMin && styles.segmentOn,
                discreet && styles.disabled,
              ]}
            >
              <Text style={m === intervalMin ? styles.segmentTextOn : ui.body}>
                {m} min
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={ui.muted}>
          {discreet
            ? 'Balise coupée.'
            : `Dernière balise : ${
                p.lastBeaconAt
                  ? `il y a ${durationLabel(now - p.lastBeaconAt)}`
                  : 'aucune'
              }${
                p.nextBeaconAt
                  ? ` · prochaine dans ${durationLabel(
                      Math.max(0, p.nextBeaconAt - now),
                    )}`
                  : ' · module non connecté'
              }`}
        </Text>
      </View>

      <View style={ui.card}>
        <Text style={ui.heading}>Réserve d’antenne</Text>
        <Text style={ui.muted}>
          En Europe, un module ne peut émettre que{' '}
          {Math.round(EU868_DUTY_CYCLE * 100)} % du temps ({budgetS} s par
          heure). Émissions de ce téléphone sur la dernière heure :
        </Text>
        <View style={styles.bar}>
          <View
            style={[
              styles.fill,
              {
                width: `${Math.min(100, share * 100)}%`,
                backgroundColor: share > 0.8 ? colors.danger : colors.primary,
              },
            ]}
          />
        </View>
        <Text style={ui.body}>
          {(s.hub.airtime.usedMs() / 1000).toFixed(1)} s utilisées (
          {Math.round(share * 100)} %) · {s.hub.airtime.count()} émission(s)
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    flex: { flex: 1, gap: 2 },
    disabled: { opacity: 0.45 },
    segments: { flexDirection: 'row', gap: 8, marginVertical: 4 },
    segment: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
    },
    segmentOn: { backgroundColor: c.primary, borderColor: c.primary },
    segmentTextOn: { color: c.onPrimary, fontWeight: '600', fontSize: 15 },
    bar: {
      height: 10,
      borderRadius: 5,
      backgroundColor: c.background,
      overflow: 'hidden',
    },
    fill: { height: 10, borderRadius: 5 },
  });
