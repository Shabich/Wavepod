/**
 * Contacts use cases: my card, adding a contact from a scanned/pasted link,
 * and keeping our module's NodeDB aware of every contact's module key.
 */
import type { WavepodIdentity } from '../crypto/identity';
import { safetyNumber } from '../crypto/identity';
import { contactId } from '../crypto/envelope';
import type { DeliveryEngine } from '../delivery/engine';
import { decodeSharedContact } from '../radio/meshtastic/framing';
import type { Contact, ContactsRepository } from '../storage/contacts';
import type { MetaRepository } from '../storage/meta';
import { CardError, decodeCard, encodeCard, type ContactCard } from './card';

/** What the service needs from the connected module. */
export interface ModuleContacts {
  ownSharedContact(): Uint8Array | null;
  addContact(sharedContact: Uint8Array): Promise<void>;
}

export interface ScannedContact {
  card: ContactCard;
  contactId: string;
  safetyNumber: string;
  /** Module node number from the card, if any. */
  nodeNum: number | null;
  moduleName: string | null;
  /** Already in the contacts (same key). */
  existing: Contact | null;
}

const DISPLAY_NAME = 'display_name';

export class ContactService {
  constructor(
    private readonly me: WavepodIdentity,
    private readonly contacts: ContactsRepository,
    private readonly meta: MetaRepository,
    private readonly engine: DeliveryEngine,
    private readonly module: () => ModuleContacts | null,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  async displayName(): Promise<string> {
    return (await this.meta.get(DISPLAY_NAME)) ?? '';
  }

  async setDisplayName(name: string) {
    await this.meta.set(DISPLAY_NAME, name.trim());
  }

  /** My QR link. Includes my module if one is connected and synced. */
  async myCardLink(): Promise<{ link: string; includesModule: boolean }> {
    const name = (await this.displayName()) || 'Wavepod';
    const meshContact = this.module()?.ownSharedContact() ?? null;
    const link = encodeCard(
      {
        boxPublicKey: this.me.box.publicKey,
        signPublicKey: this.me.sign.publicKey,
        name,
        meshContact,
      },
      this.me.sign.secretKey,
    );
    return { link, includesModule: meshContact !== null };
  }

  /** Parses and checks a link before showing the confirmation screen. */
  async inspect(link: string): Promise<ScannedContact> {
    const card = decodeCard(link);
    const id = contactId(card.boxPublicKey);
    if (id === this.me.contactId) throw new CardError('this is your own card');
    let nodeNum: number | null = null;
    let moduleName: string | null = null;
    if (card.meshContact) {
      try {
        const info = decodeSharedContact(card.meshContact);
        nodeNum = info.nodeNum;
        moduleName = info.longName || info.shortName || null;
      } catch {
        throw new CardError('corrupted module info');
      }
    }
    return {
      card,
      contactId: id,
      safetyNumber: safetyNumber(this.me.box.publicKey, card.boxPublicKey),
      nodeNum,
      moduleName,
      existing: await this.contacts.get(id),
    };
  }

  /**
   * Adds (or updates) the contact. Being able to scan means being side by side:
   * this counts as a presence signal, so queued messages can leave at once.
   */
  async add(scanned: ScannedContact, name?: string): Promise<Contact> {
    const { card } = scanned;
    const contact = await this.contacts.upsert({
      publicKey: card.boxPublicKey,
      signKey: card.signPublicKey,
      name: (name ?? card.name).trim() || card.name,
      nodeNum: scanned.nodeNum ?? undefined,
      meshContact: card.meshContact ?? undefined,
    });
    if (card.meshContact)
      await this.injectIntoModule(contact.name, card.meshContact);
    if (scanned.nodeNum !== null) {
      await this.engine.signal(contact.id, scanned.nodeNum);
    }
    return (await this.contacts.get(contact.id)) ?? contact;
  }

  async setVerified(id: string, verified: boolean) {
    await this.contacts.setVerified(id, verified);
  }

  safetyNumberWith(contact: Contact) {
    return safetyNumber(this.me.box.publicKey, contact.publicKey);
  }

  /**
   * After connecting a module (possibly a new one), re-inject every contact's
   * module key so PKI direct messages are possible. Returns how many were sent.
   */
  async syncModule(): Promise<number> {
    let count = 0;
    for (const c of await this.contacts.list()) {
      if (c.meshContact && (await this.injectIntoModule(c.name, c.meshContact)))
        count++;
    }
    return count;
  }

  private async injectIntoModule(name: string, meshContact: Uint8Array) {
    const m = this.module();
    if (!m) return false;
    try {
      await m.addContact(meshContact);
      return true;
    } catch (e) {
      this.log(`add_contact failed for ${name}: ${String(e)}`);
      return false;
    }
  }
}
