/**
 * Handlers that must exist before the first React render (index.js).
 */
import { Platform } from 'react-native';
import { registerForegroundService } from './notifeeNotifier';

export function registerEarlyHandlers() {
  registerForegroundService();
  if (Platform.OS === 'android') {
    // Presses on notifications while the app is in background: opening the app is
    // enough, the navigator then reads the initial notification.
    const notifee =
      require('@notifee/react-native') as typeof import('@notifee/react-native');
    notifee.default.onBackgroundEvent(async () => undefined);
  }
}
