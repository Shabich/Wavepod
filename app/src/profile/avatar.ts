/**
 * Profile avatars and the compact Profile message body.
 *
 * Only indexes travel over the radio. NEVER reorder or remove entries in these
 * lists: append only, or existing contacts would change avatar.
 */
import { sha256 } from '@noble/hashes/sha2.js';

/** Lucide icon names (ISC license). Index = avatar icon id. */
export const AVATAR_ICONS = [
  'fish',
  'shell',
  'waves',
  'mountain',
  'mountain-snow',
  'tree-pine',
  'tent',
  'compass',
  'sun',
  'moon',
  'star',
  'anchor',
  'sailboat',
  'bike',
  'footprints',
  'flame',
  'snowflake',
  'leaf',
  'feather',
  'bird',
  'rabbit',
  'turtle',
  'squirrel',
  'cat',
  'dog',
  'flower-2',
  'cloud',
  'zap',
  'heart',
  'music',
] as const;

/**
 * Avatar backgrounds; white icons on each reach at least 4.5:1 (checked in tests).
 * Index = avatar color id.
 */
export const AVATAR_COLORS = [
  '#4F64AA', // indigo (brand)
  '#0E7490', // teal
  '#15803D', // green
  '#C2410C', // orange
  '#B91C1C', // red
  '#7E22CE', // purple
  '#BE185D', // pink
  '#5A6178', // slate (brand)
] as const;

export interface Avatar {
  icon: number;
  color: number;
}

export function clampAvatar(a: Avatar): Avatar {
  return {
    icon: a.icon >= 0 && a.icon < AVATAR_ICONS.length ? a.icon : 0,
    color: a.color >= 0 && a.color < AVATAR_COLORS.length ? a.color : 0,
  };
}

/** Stable default avatar for someone who never sent a profile. */
export function defaultAvatar(id: string): Avatar {
  const h = sha256(new TextEncoder().encode(id));
  return {
    icon: h[0] % AVATAR_ICONS.length,
    color: h[1] % AVATAR_COLORS.length,
  };
}

// ---------------------------------------------------------------- Profile message

export const PROFILE_VERSION = 1;
export const MAX_PROFILE_NAME = 40;
export const MAX_BIO = 80;

export interface Profile {
  avatar: Avatar;
  name: string;
  bio: string;
}

export class ProfileError extends Error {}

const enc = new TextEncoder();

/** [version][icon][color][nameLen][name…][bioLen][bio…] */
export function encodeProfile(p: Profile): Uint8Array {
  const name = enc.encode(p.name.trim());
  const bio = enc.encode(p.bio.trim());
  if (name.length === 0) throw new ProfileError('name is empty');
  if (name.length > MAX_PROFILE_NAME) throw new ProfileError('name too long');
  if (bio.length > MAX_BIO) throw new ProfileError('bio too long');
  const a = clampAvatar(p.avatar);
  const out = new Uint8Array(5 + name.length + bio.length);
  out[0] = PROFILE_VERSION;
  out[1] = a.icon;
  out[2] = a.color;
  out[3] = name.length;
  out.set(name, 4);
  out[4 + name.length] = bio.length;
  out.set(bio, 5 + name.length);
  return out;
}

export function decodeProfile(bytes: Uint8Array): Profile {
  if (bytes.length < 5 || bytes[0] !== PROFILE_VERSION) {
    throw new ProfileError('unsupported profile');
  }
  const nameLen = bytes[3];
  const bioAt = 4 + nameLen;
  if (nameLen === 0 || nameLen > MAX_PROFILE_NAME || bioAt >= bytes.length) {
    throw new ProfileError('corrupted profile');
  }
  const bioLen = bytes[bioAt];
  if (bioLen > MAX_BIO || bytes.length !== bioAt + 1 + bioLen) {
    throw new ProfileError('corrupted profile');
  }
  const dec = new TextDecoder('utf-8', { fatal: true });
  try {
    return {
      // Unknown ids from a newer app version fall back to the first entries.
      avatar: clampAvatar({ icon: bytes[1], color: bytes[2] }),
      name: dec.decode(bytes.slice(4, bioAt)),
      bio: dec.decode(bytes.slice(bioAt + 1)),
    };
  } catch {
    throw new ProfileError('corrupted profile');
  }
}
