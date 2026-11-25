/**
 * Prototype screen: pick a role, connect to a module, pick the peer node, then chat
 * through the delivery engine (persistent outbox, retries, two-level acks).
 * Test identities A/B stay until QR contacts exist (task 04).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { DeliveryEngine } from '../delivery/engine';
import type { StoredMessage, MessageStatus } from '../storage/delivery';
import type { SqlDatabase } from '../storage/types';
import { MAX_PLAINTEXT_LENGTH } from '../protocol/codec';
import { runSelfTest } from '../prototype/selfTest';
import { testIdentity, type Role } from '../prototype/testIdentities';
import { runStorageSelfTest } from '../storage/selfTest';
import type { WavepodIdentity } from '../crypto/identity';

const OCEAN = '#1D6FA5';

const STATUS_LABEL: Record<MessageStatus, string> = {
  pending: 'en attente',
  sent: 'envoyé',
  moduleAck: 'reçu par le module',
  delivered: 'livré',
  read: 'lu',
  failed: 'échec',
  received: '',
};

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
const time = (t: number) => new Date(t).toISOString().slice(11, 19);

interface Props {
  identity?: WavepodIdentity;
  db?: SqlDatabase;
}

export function PrototypeScreen({ identity, db }: Props) {
  const [role, setRole] = useState<Role | null>(null);
  const [selfTest] = useState(runSelfTest);
  const [storageTest, setStorageTest] = useState('stockage : test…');
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [draft, setDraft] = useState('');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerNode, setPeerNode] = useState<number | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [nodesVersion, setNodesVersion] = useState(0);
  const adapterRef = useRef<MeshtasticAdapter | null>(null);
  const engineRef = useRef<DeliveryEngine | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!identity) return;
    runStorageSelfTest().then(r => setStorageTest(r.detail));
  }, [identity]);

  useEffect(
    () => () => {
      stopScanRef.current?.();
      engineRef.current?.stop();
      void adapterRef.current?.stop();
    },
    [],
  );

  const refreshMessages = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !peerId) return;
    setMessages(await engine.messages.listForContact(peerId));
  }, [peerId]);

  useEffect(() => {
    refreshMessages();
  }, [refreshMessages]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    return engine.onEvent(e => {
      if (e.kind === 'log') {
        setLog(prev =>
          [`${time(Date.now())} ${e.line}`, ...prev].slice(0, 200),
        );
      } else {
        refreshMessages();
      }
    });
  }, [refreshMessages, state]);

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
      if (!role || !db) return;
      stopScanRef.current?.();
      setScanning(false);
      setState('connecting');
      try {
        const link = await connectToModule(device.id);
        const adapter = new MeshtasticAdapter(link);
        adapter.onConnectionState(setState);
        adapter.onNode(() => setNodesVersion(v => v + 1));
        const engine = new DeliveryEngine({
          radio: adapter,
          me: testIdentity(role),
          db,
        });
        const peerRole: Role = role === 'A' ? 'B' : 'A';
        const peer = await engine.contacts.upsert({
          publicKey: testIdentity(peerRole).publicKey,
          name: `Téléphone ${peerRole}`,
        });
        adapterRef.current = adapter;
        engineRef.current = engine;
        setPeerId(peer.id);
        setPeerNode(peer.nodeNum);
        engine.start();
        await adapter.start();
      } catch (e) {
        setError(String(e));
        setState('disconnected');
      }
    },
    [role, db],
  );

  const choosePeerNode = useCallback(
    async (num: number) => {
      const engine = engineRef.current;
      if (!engine || !peerId) return;
      setPeerNode(num);
      // Choosing the node means "they are here": counts as a presence signal.
      await engine.signal(peerId, num);
    },
    [peerId],
  );

  const send = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !peerId || !draft.trim()) return;
    try {
      await engine.sendText(peerId, draft.trim());
      setDraft('');
    } catch (e) {
      setError(String(e));
    }
  }, [draft, peerId]);

  const messageActions = (m: StoredMessage) => {
    const engine = engineRef.current;
    if (!engine || m.direction !== 'out' || !peerId) return;
    if (m.status === 'delivered' || m.status === 'read') return;
    Alert.alert('Message non livré', m.body, [
      { text: 'Renvoyer', onPress: () => engine.resend(peerId, m.messageId) },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => engine.cancel(peerId, m.messageId),
      },
      { text: 'Fermer', style: 'cancel' },
    ]);
  };

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

  if (
    !engineRef.current ||
    state === 'connecting' ||
    (state === 'disconnected' && !adapter)
  ) {
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
    <View style={styles.screen} key={nodesVersion}>
      <Text style={styles.title}>
        Rôle {role} ·{' '}
        {state === 'ready'
          ? 'prêt'
          : state === 'disconnected'
          ? 'module déconnecté'
          : 'synchronisation…'}
      </Text>
      <Text style={styles.muted}>
        Nœud {adapter?.localNode !== undefined ? hex(adapter.localNode) : '?'} ·
        firmware {adapter?.firmwareVersion ?? '?'}
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.section}>Nœud du destinataire</Text>
      <ScrollView horizontal style={styles.peers}>
        {peers.map(n => (
          <Pressable
            key={n.num}
            style={[styles.chip, peerNode === n.num && styles.chipActive]}
            onPress={() => choosePeerNode(n.num)}
          >
            <Text
              style={peerNode === n.num ? styles.chipTextActive : undefined}
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
        data={[...messages].reverse()}
        keyExtractor={m => `${m.direction}-${m.messageId}`}
        inverted
        renderItem={({ item }) => (
          <Pressable
            onPress={() => messageActions(item)}
            style={[
              styles.bubble,
              item.direction === 'out' ? styles.out : styles.in,
            ]}
          >
            <Text style={item.direction === 'out' ? styles.outText : undefined}>
              {item.body}
            </Text>
            <Text
              style={[styles.meta, item.direction === 'out' && styles.outText]}
            >
              {time(item.createdAt)}
              {item.direction === 'out'
                ? ` · ${STATUS_LABEL[item.status]}${
                    item.error ? ` (${item.error})` : ''
                  }`
                : ''}
            </Text>
          </Pressable>
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
          disabled={peerNode === null}
          color={OCEAN}
        />
      </View>

      <Text style={styles.section}>Journal</Text>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
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
