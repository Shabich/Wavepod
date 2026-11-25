/**
 * App-wide services, created once the identity and database are loaded.
 * The delivery engine lives for the whole session on a RadioHub; modules are
 * attached to the hub as they connect.
 */
import { ContactService } from '../contacts/service';
import { DeliveryEngine, type EngineEvent } from '../delivery/engine';
import type { WavepodIdentity } from '../crypto/identity';
import { RadioHub } from '../radio/RadioHub';
import { MeshtasticAdapter } from '../radio/meshtastic/MeshtasticAdapter';
import { connectToModule } from '../radio/meshtastic/bleLink';
import { MetaRepository } from '../storage/meta';
import type { SqlDatabase } from '../storage/types';

export interface AppServices {
  identity: WavepodIdentity;
  db: SqlDatabase;
  hub: RadioHub;
  engine: DeliveryEngine;
  contacts: ContactService;
  connectModule(deviceId: string, name: string): Promise<void>;
  disconnectModule(): Promise<void>;
  moduleName(): string | null;
  log: string[];
  onLog(l: () => void): () => void;
}

export function createServices(
  identity: WavepodIdentity,
  db: SqlDatabase,
): AppServices {
  const hub = new RadioHub();
  const engine = new DeliveryEngine({ radio: hub, me: identity.box, db });
  const log: string[] = [];
  const logListeners = new Set<() => void>();
  const addLog = (line: string) => {
    log.unshift(`${new Date().toISOString().slice(11, 19)} ${line}`);
    if (log.length > 300) log.pop();
    logListeners.forEach(l => l());
  };
  engine.onEvent((e: EngineEvent) => {
    if (e.kind === 'log') addLog(e.line);
  });
  const contacts = new ContactService(
    identity,
    engine.contacts,
    new MetaRepository(db),
    engine,
    () => (hub.adapter?.connectionState === 'ready' ? hub.adapter : null),
    addLog,
  );
  let currentName: string | null = null;

  hub.onConnectionState(state => {
    addLog(`module ${state}`);
    if (state === 'ready') {
      contacts
        .syncModule()
        .then(n => n > 0 && addLog(`${n} contact(s) synced to the module`));
    }
  });
  engine.start();

  return {
    identity,
    db,
    hub,
    engine,
    contacts,
    log,
    onLog(l) {
      logListeners.add(l);
      return () => logListeners.delete(l);
    },
    moduleName: () => currentName,
    async connectModule(deviceId, name) {
      await hub.adapter?.stop().catch(() => undefined);
      hub.detach();
      const link = await connectToModule(deviceId);
      const adapter = new MeshtasticAdapter(link);
      currentName = name;
      hub.attach(adapter);
      await adapter.start();
    },
    async disconnectModule() {
      const adapter = hub.adapter;
      hub.detach();
      currentName = null;
      await adapter?.stop().catch(() => undefined);
    },
  };
}
