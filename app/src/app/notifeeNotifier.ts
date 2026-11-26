/**
 * Notifier implemented with Notifee. Required lazily (native module).
 * Android: channel "messages" (high importance) and channel "module" (low importance,
 * ongoing notification that runs the foreground service with type connectedDevice).
 */
import { Platform } from 'react-native';
import type { Notifier } from './notifications';

const MESSAGES = 'messages';
const MODULE = 'module';
const FOREGROUND_ID = 'wavepod-module';

function notifee() {
  return require('@notifee/react-native') as typeof import('@notifee/react-native');
}

let channelsReady: Promise<void> | null = null;

function ensureChannels() {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelsReady) {
    const n = notifee();
    channelsReady = n.default
      .createChannels([
        {
          id: MESSAGES,
          name: 'Messages',
          importance: n.AndroidImportance.HIGH,
        },
        {
          id: MODULE,
          name: 'Connexion au module',
          importance: n.AndroidImportance.LOW,
        },
      ])
      .then(() => undefined);
  }
  return channelsReady;
}

/**
 * Must run at startup, before AppRegistry: Notifee needs the foreground service
 * task registered early. The task never resolves; the service lives until
 * stopForegroundService().
 */
export function registerForegroundService() {
  if (Platform.OS !== 'android') return;
  notifee().default.registerForegroundService(
    () => new Promise(() => undefined),
  );
}

export class NotifeeNotifier implements Notifier {
  private foregroundShown = false;

  async requestPermission(): Promise<boolean> {
    const n = notifee();
    const settings = await n.default.requestPermission();
    return settings.authorizationStatus >= n.AuthorizationStatus.AUTHORIZED;
  }

  async showMessage(contactId: string, title: string, body: string) {
    await ensureChannels();
    const n = notifee();
    await n.default.displayNotification({
      title,
      body,
      data: { contactId },
      android: {
        channelId: MESSAGES,
        smallIcon: 'ic_notification',
        pressAction: { id: 'default' },
      },
      ios: { threadId: contactId },
    });
  }

  async setForeground(text: string | null) {
    if (Platform.OS !== 'android') return;
    const n = notifee();
    if (text === null) {
      if (this.foregroundShown) {
        await n.default.stopForegroundService();
        this.foregroundShown = false;
      }
      return;
    }
    await ensureChannels();
    await n.default.displayNotification({
      id: FOREGROUND_ID,
      title: 'Wavepod',
      body: text,
      android: {
        channelId: MODULE,
        smallIcon: 'ic_notification',
        asForegroundService: true,
        foregroundServiceTypes: [
          n.AndroidForegroundServiceType
            .FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
        ],
        ongoing: true,
        onlyAlertOnce: true,
        pressAction: { id: 'default' },
      },
    });
    this.foregroundShown = true;
  }
}

/** Contact to open when the app was launched or resumed from a message notification. */
export async function initialNotificationContact(): Promise<string | null> {
  const initial = await notifee().default.getInitialNotification();
  const id = initial?.notification.data?.contactId;
  return typeof id === 'string' ? id : null;
}

export function onNotificationPressed(open: (contactId: string) => void) {
  const n = notifee();
  return n.default.onForegroundEvent(({ type, detail }) => {
    const id = detail.notification?.data?.contactId;
    if (type === n.EventType.PRESS && typeof id === 'string') open(id);
  });
}
