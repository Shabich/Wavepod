/**
 * App-wide services, created once the identity and database are loaded.
 * The delivery engine lives for the whole session on a RadioHub; modules are
 * attached to the hub as they connect.
 */
import { ContactService } from '../contacts/service';
import { DeliveryEngine, type EngineEvent } from '../delivery/engine';
import type { WavepodIdentity } from '../crypto/identity';
import { RadioHub } from '../radio/RadioHub';
import {
  cancelModuleConnection,
  connectToModule,
  initBle,
} from '../radio/meshtastic/bleLink';
import { MetaRepository } from '../storage/meta';
import { AppState } from 'react-native';
import { ModuleManager } from './moduleManager';
import { MessageNotifier, foregroundText } from './notifications';
import { NotifeeNotifier } from './notifeeNotifier';
import type { SqlDatabase } from '../storage/types';
import { realScheduler } from '../delivery/engine';
import { PresenceService, type PresenceSettings } from '../presence/service';

export interface AppServices {
  identity: WavepodIdentity;
  db: SqlDatabase;
  hub: RadioHub;
  engine: DeliveryEngine;
  contacts: ContactService;
  modules: ModuleManager;
  connectModule(deviceId: string, name: string): Promise<void>;
  disconnectModule(): Promise<void>;
  moduleName(): string | null;
  /** The conversation on screen gets no notification while the app is active. */
  setOpenChat(contactId: string | null): void;
  /** Diagnostic: asks for permission and shows a sample notification. */
  testNotification(): Promise<boolean>;
  presence: PresenceService;
  log: string[];
  onLog(l: () => void): () => void;
}

export function createServices(
  identity: WavepodIdentity,
  db: SqlDatabase,
): AppServices {
  const hub = new RadioHub();
  const presenceSettings: PresenceSettings = {
    discreet: false,
    intervalMin: 20,
  };
  const engine = new DeliveryEngine({
    radio: hub,
    me: identity.box,
    db,
    allowProbe: () => !presenceSettings.discreet,
  });
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
  initBle(addLog);
  const modules = new ModuleManager({
    connectLink: connectToModule,
    cancelConnect: cancelModuleConnection,
    hub,
    meta: new MetaRepository(db),
    log: addLog,
  });

  hub.onConnectionState(state => {
    addLog(`module ${state}`);
    if (state === 'ready') {
      contacts
        .syncModule()
        .then(n => n > 0 && addLog(`${n} contact(s) synced to the module`));
    }
  });
  engine.start();
  const presence = new PresenceService({
    me: identity,
    radio: hub,
    engine,
    contacts: engine.contacts,
    meta: new MetaRepository(db),
    settings: presenceSettings,
    scheduler: realScheduler,
    log: addLog,
  });
  presence.start().catch(e => addLog(`presence start failed: ${String(e)}`));

  const notifier = new NotifeeNotifier();
  const messageNotifier = new MessageNotifier({
    engine,
    contacts: engine.contacts,
    messages: engine.messages,
    notifier,
    appState: () => AppState.currentState ?? 'active',
    log: addLog,
  });
  messageNotifier.start();
  let permissionAsked = false;

  modules.onStateChange(st => {
    addLog(`link ${st}`);
    notifier
      .setForeground(foregroundText(st, modules.moduleName))
      .catch(e => addLog(`foreground service: ${String(e)}`));
    // Ask for notifications when they start to make sense: a module is connected.
    if (st === 'connected' && !permissionAsked) {
      permissionAsked = true;
      notifier
        .requestPermission()
        .then(ok => addLog(`notifications ${ok ? 'allowed' : 'denied'}`))
        .catch(e => addLog(`notification permission: ${String(e)}`));
    }
  });
  modules
    .resumeLast()
    .then(found => found && addLog('reconnecting to the last module'))
    .catch(e => addLog(`resume failed: ${String(e)}`));

  return {
    identity,
    db,
    hub,
    engine,
    contacts,
    modules,
    log,
    onLog(l) {
      logListeners.add(l);
      return () => logListeners.delete(l);
    },
    moduleName: () => modules.moduleName,
    connectModule: (deviceId, name) => modules.connect(deviceId, name),
    disconnectModule: () => modules.disconnect(),
    setOpenChat: id => messageNotifier.setOpenChat(id),
    presence,
    async testNotification() {
      const ok = await notifier.requestPermission();
      if (ok) {
        await notifier.showMessage(
          'test',
          'Wavepod',
          'Notification de test : tu seras prévenu des nouveaux messages.',
        );
      }
      return ok;
    },
  };
}
