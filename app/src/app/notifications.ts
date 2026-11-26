/**
 * Local notifications (no server, no internet): a notification for each incoming
 * message the user is not already looking at, and on Android an ongoing
 * notification that keeps a foreground service alive while a module is followed.
 */
import type { DeliveryEngine } from '../delivery/engine';
import type { ContactsRepository } from '../storage/contacts';
import type { MessagesRepository } from '../storage/delivery';
import type { LinkState } from './moduleManager';

/** Platform side (Notifee in the app, a fake in tests). */
export interface Notifier {
  requestPermission(): Promise<boolean>;
  showMessage(contactId: string, title: string, body: string): Promise<void>;
  /** Android foreground service while a module is followed; no-op on iOS. */
  setForeground(text: string | null): Promise<void>;
}

export type AppActivity = 'active' | 'background' | 'inactive' | string;

export interface MessageNotifierDeps {
  engine: DeliveryEngine;
  contacts: ContactsRepository;
  messages: MessagesRepository;
  notifier: Notifier;
  appState: () => AppActivity;
  log?: (line: string) => void;
}

const MAX_BODY = 140;

export class MessageNotifier {
  /** Conversation currently on screen (no notification for it while active). */
  private openChat: string | null = null;
  private stop: (() => void) | null = null;

  constructor(private readonly d: MessageNotifierDeps) {}

  start() {
    this.stop = this.d.engine.onEvent(e => {
      if (e.kind === 'message' && e.direction === 'in') {
        this.onIncoming(e.contactId, e.messageId).catch(err =>
          this.d.log?.(`notification failed: ${String(err)}`),
        );
      }
    });
  }

  dispose() {
    this.stop?.();
  }

  setOpenChat(contactId: string | null) {
    this.openChat = contactId;
  }

  private async onIncoming(contactId: string, messageId: number) {
    if (!shouldNotify(this.d.appState(), this.openChat, contactId)) return;
    const [contact, message] = await Promise.all([
      this.d.contacts.get(contactId),
      this.d.messages.get(contactId, 'in', messageId),
    ]);
    if (!contact || !message) return;
    const body =
      message.body.length > MAX_BODY
        ? `${message.body.slice(0, MAX_BODY - 1)}…`
        : message.body;
    await this.d.notifier.showMessage(contactId, contact.name, body);
  }
}

export function shouldNotify(
  appState: AppActivity,
  openChat: string | null,
  contactId: string,
): boolean {
  return appState !== 'active' || openChat !== contactId;
}

/** Text of the Android ongoing notification for a link state; null = stop the service. */
export function foregroundText(
  state: LinkState,
  moduleName: string | null,
): string | null {
  const name = moduleName ?? 'ton module';
  switch (state) {
    case 'connected':
      return `Connecté à ${name} : tu recevras tes messages.`;
    case 'connecting':
    case 'reconnecting':
      return `Recherche de ${name}…`;
    default:
      return null;
  }
}
