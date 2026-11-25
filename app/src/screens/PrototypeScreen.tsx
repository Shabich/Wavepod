/**
 * Task 01 prototype screen: pick a role, connect to a module, pick the peer node,
 * send encrypted texts and watch radio and app acks.
 */
import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  Button,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MeshtasticAdapter } from '../radio/meshtastic/MeshtasticAdapter';
import {
  connectToModule,
  requestBlePermissions,
  scanForModules,
  type FoundDevice,
} from '../radio/meshtastic/bleLink';
import type { ConnectionState } from '../radio/RadioInterface';
import {
  PrototypeSession,
  type Role,
  type ChatMessage,
} from '../prototype/PrototypeSession';
import { contactId } from '../crypto/envelope';
import { MAX_PLAINTEXT_LENGTH } from '../protocol/codec';
import { runSelfTest } from '../prototype/selfTest';
import { runStorageSelfTest } from '../storage/selfTest';
import type { WavepodIdentity } from '../crypto/identity';

const OCEAN = '#1D6FA5';

const STATUS_LABEL: Record<NonNullable<ChatMessage['status']>, string> = {
  sending: 'envoi…',
  sent: 'envoyé',
  moduleAck: 'reçu par le module',
  delivered: 'livré',
  failed: 'échec',
};

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

export function PrototypeScreen({ identity }: { identity?: WavepodIdentity }) {
  const [role, setRole] = useState<Role | null>(null);
  const [selfTest] = useState(runSelfTest);
  const [storageTest, setStorageTest] = useState<string>('stockage : test…');

  useEffect(() => {
    if (!identity) return;
    runStorageSelfTest().then(r => setStorageTest(r.detail));
  }, [identity]);
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [draft, setDraft] = useState('');
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const adapterRef = useRef<MeshtasticAdapter | null>(null);
  const sessionRef = useRef<PrototypeSession | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stopScanRef.current?.();
      sessionRef.current?.dispose();
      void adapterRef.current?.stop();
    },
    [],
  );

  const startScan = useCallback(async () => {
    setError(null);
    if (!(await requestBlePermissions())) {
      setError('Permissions Bluetooth refusées');
      return;
    }
    setDevices([]);
    setScanning(true);
    stopScanRef.current = scanForModules(
      d =>
        setDevices(prev =>
          prev.some(p => p.id === d.id) ? prev : [...prev, d],
        ),
      e => {
        setError(e.message);
        setScanning(false);
      },
    );
  }, []);

  const connect = useCallback(
    async (device: FoundDevice) => {
      if (!role) return;
      stopScanRef.current?.();
      setScanning(false);
      setState('connecting');
      try {
        const link = await connectToModule(device.id);
        const adapter = new MeshtasticAdapter(link);
        adapter.onConnectionState(setState);
        adapter.onNode(() => rerender());
        const session = new PrototypeSession(adapter, role);
        session.onChange(rerender);
        adapterRef.current = adapter;
        sessionRef.current = session;
        await adapter.start();
      } catch (e) {
        setError(String(e));
        setState('disconnected');
      }
    },
    [role],
  );

  const send = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !draft.trim()) return;
    try {
      await session.sendText(draft.trim());
      setDraft('');
    } catch (e) {
      setError(String(e));
    }
  }, [draft]);

  const session = sessionRef.current;
  const adapter = adapterRef.current;

  if (!role) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Wavepod · prototype</Text>
        <Text style={selfTest.ok ? styles.muted : styles.error}>
          {selfTest.detail}
        </Text>
        {identity && (
          <>
            <Text style={styles.muted}>{storageTest}</Text>
            <Text style={styles.muted}>
              Ton identité : {identity.contactId}
            </Text>
          </>
        )}
        <Text style={styles.muted}>Choisis le rôle de ce téléphone</Text>
        <View style={styles.row}>
          <RoleButton label="Téléphone A" onPress={() => setRole('A')} />
          <RoleButton label="Téléphone B" onPress={() => setRole('B')} />
        </View>
      </View>
    );
  }

  if (!session || state === 'disconnected' || state === 'connecting') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>
          Rôle {role} · {state === 'connecting' ? 'connexion…' : 'module'}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          title={scanning ? 'Recherche…' : 'Chercher un module'}
          onPress={startScan}
          color={OCEAN}
        />
        <FlatList
          data={devices}
          keyExtractor={d => d.id}
          renderItem={({ item }) => (
            <Pressable style={styles.item} onPress={() => connect(item)}>
              <Text style={styles.itemTitle}>{item.name}</Text>
              <Text style={styles.muted}>RSSI {item.rssi ?? '?'}</Text>
            </Pressable>
          )}
        />
      </View>
    );
  }

  const peers = adapter
    ? [...adapter.nodes.values()].filter(n => n.num !== adapter.localNode)
    : [];

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>
        Rôle {role} · {state === 'ready' ? 'prêt' : 'synchronisation…'}
      </Text>
      <Text style={styles.muted}>
        Nœud {adapter?.localNode !== undefined ? hex(adapter.localNode) : '?'} ·
        firmware {adapter?.firmwareVersion ?? '?'} · id{' '}
        {contactId(session.me.publicKey)}
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.section}>Destinataire</Text>
      <ScrollView horizontal style={styles.peers}>
        {peers.map(n => (
          <Pressable
            key={n.num}
            style={[
              styles.chip,
              session.peerNode === n.num && styles.chipActive,
            ]}
            onPress={() => {
              session.peerNode = n.num;
              rerender();
            }}
          >
            <Text
              style={
                session.peerNode === n.num ? styles.chipTextActive : undefined
              }
            >
              {n.shortName || hex(n.num)} {n.longName ? `· ${n.longName}` : ''}
            </Text>
          </Pressable>
        ))}
        {peers.length === 0 && (
          <Text style={styles.muted}>Aucun autre nœud connu</Text>
        )}
      </ScrollView>

      <FlatList
        style={styles.messages}
        data={[...session.messages].reverse()}
        keyExtractor={m => `${m.direction}-${m.messageId}`}
        inverted
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.direction === 'out' ? styles.out : styles.in,
            ]}
          >
            <Text style={item.direction === 'out' ? styles.outText : undefined}>
              {item.text}
            </Text>
            <Text
              style={[styles.meta, item.direction === 'out' && styles.outText]}
            >
              {item.direction === 'out'
                ? `${STATUS_LABEL[item.status ?? 'sending']}${
                    item.error ? ` · ${item.error}` : ''
                  }`
                : `SNR ${item.rxSnr ?? '?'} · RSSI ${
                    item.rxRssi ?? '?'
                  } · sauts ${item.hops ?? '?'}`}
            </Text>
          </View>
        )}
      />

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          maxLength={MAX_PLAINTEXT_LENGTH}
        />
        <Button
          title="Envoyer"
          onPress={send}
          disabled={state !== 'ready' || session.peerNode === undefined}
          color={OCEAN}
        />
      </View>

      <Text style={styles.section}>Journal</Text>
      <ScrollView style={styles.log}>
        {session.log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function RoleButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.roleButton} onPress={onPress}>
      <Text style={styles.roleText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 20, fontWeight: '600', color: OCEAN },
  muted: { color: '#666', fontSize: 12 },
  error: { color: '#b00020' },
  section: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  item: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  itemTitle: { fontSize: 16 },
  peers: { flexGrow: 0 },
  chip: {
    borderWidth: 1,
    borderColor: OCEAN,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipActive: { backgroundColor: OCEAN },
  chipTextActive: { color: 'white' },
  messages: { flex: 1 },
  bubble: { padding: 8, borderRadius: 12, marginVertical: 4, maxWidth: '80%' },
  out: { alignSelf: 'flex-end', backgroundColor: OCEAN },
  in: { alignSelf: 'flex-start', backgroundColor: '#e6eef4' },
  outText: { color: 'white' },
  meta: { fontSize: 11, marginTop: 4, opacity: 0.8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
  },
  log: { maxHeight: 140 },
  logLine: { fontFamily: 'Menlo', fontSize: 10, color: '#444' },
  roleButton: {
    backgroundColor: OCEAN,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
  },
  roleText: { color: 'white', fontWeight: '600' },
});
