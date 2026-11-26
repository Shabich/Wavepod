/**
 * Our profile (avatar, name, bio) and the profiles of our contacts.
 * Each change bumps a version; every contact that has not received the current
 * version gets one Profile message through the reliable outbox.
 */
import type { DeliveryEngine } from '../delivery/engine';
import { MessageType } from '../protocol/codec';
import type { ContactsRepository } from '../storage/contacts';
import type { MetaRepository } from '../storage/meta';
import type { Unsubscribe } from '../radio/RadioInterface';
import {
  clampAvatar,
  decodeProfile,
  defaultAvatar,
  encodeProfile,
  type Avatar,
  type Profile,
} from './avatar';

const NAME = 'display_name'; // shared with ContactService
const ICON = 'profile_icon';
const COLOR = 'profile_color';
const BIO = 'profile_bio';
const VERSION = 'profile_version';

export interface ProfileDeps {
  myId: string;
  engine: DeliveryEngine;
  contacts: ContactsRepository;
  meta: MetaRepository;
  now?: () => number;
  log?: (line: string) => void;
}

export class ProfileService {
  private stop: Unsubscribe | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly d: ProfileDeps) {}

  async start() {
    this.stop = this.d.engine.onEvent(e => {
      if (e.kind === 'profile') {
        this.serial(() => this.onProfile(e.contactId, e.body));
      } else if (e.kind === 'contact') {
        this.serial(() => this.sendPending());
      }
    });
    await this.serial(() => this.sendPending());
  }

  dispose() {
    this.stop?.();
  }

  onChange(l: () => void): Unsubscribe {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  idle() {
    return this.queue.then(() => undefined);
  }

  async get(): Promise<Profile> {
    const [name, icon, color, bio] = await Promise.all([
      this.d.meta.get(NAME),
      this.d.meta.get(ICON),
      this.d.meta.get(COLOR),
      this.d.meta.get(BIO),
    ]);
    const avatar =
      icon === null
        ? defaultAvatar(this.d.myId)
        : clampAvatar({ icon: Number(icon), color: Number(color ?? 0) });
    return { name: name ?? '', bio: bio ?? '', avatar };
  }

  /** Saves our profile (validated) and queues it for every contact. */
  async set(changes: Partial<Profile>): Promise<Profile> {
    const next = { ...(await this.get()), ...changes };
    next.name = next.name.trim();
    next.bio = next.bio.trim();
    // Validates lengths (throws ProfileError); a name is needed to share it.
    encodeProfile({ ...next, name: next.name || 'x' });
    await this.d.meta.set(NAME, next.name);
    await this.d.meta.set(BIO, next.bio);
    await this.d.meta.set(ICON, String(next.avatar.icon));
    await this.d.meta.set(COLOR, String(next.avatar.color));
    await this.d.meta.set(VERSION, String(this.now()));
    this.listeners.forEach(l => l());
    await this.serial(() => this.sendPending());
    return next;
  }

  /** Avatar to display for a contact: its own choice, or a stable default. */
  static avatarOf(c: { id: string; avatar: Avatar | null }): Avatar {
    return c.avatar ?? defaultAvatar(c.id);
  }

  // ---------------------------------------------------------------- internals

  private now() {
    return (this.d.now ?? Date.now)();
  }

  private serial<T>(fn: () => Promise<T>) {
    const run = this.queue.then(fn);
    this.queue = run.catch(e => this.d.log?.(`profile error: ${String(e)}`));
    return run;
  }

  private async onProfile(contactId: string, body: Uint8Array) {
    try {
      const p = decodeProfile(body);
      await this.d.contacts.applyProfile(contactId, p);
      this.listeners.forEach(l => l());
    } catch (e) {
      this.d.log?.(`bad profile from ${contactId}: ${String(e)}`);
    }
  }

  private async sendPending() {
    const profile = await this.get();
    if (!profile.name) return; // nothing to share before a name is chosen
    let version = Number(await this.d.meta.get(VERSION));
    if (!version) {
      version = this.now();
      await this.d.meta.set(VERSION, String(version));
    }
    const body = encodeProfile(profile);
    for (const c of await this.d.contacts.list()) {
      if ((c.profileSentVersion ?? 0) >= version) continue;
      await this.d.contacts.markProfileSent(c.id, version);
      await this.d.engine.sendControl(c.id, MessageType.Profile, body);
    }
  }
}
