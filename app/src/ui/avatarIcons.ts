/**
 * Lucide components for AVATAR_ICONS, in the same order (index = avatar icon id).
 * Explicit imports keep the bundle to the icons actually used.
 */
import {
  Anchor,
  Bike,
  Bird,
  Cat,
  Cloud,
  Compass,
  Dog,
  Feather,
  Fish,
  Flame,
  Flower2,
  Footprints,
  Heart,
  Leaf,
  Moon,
  Mountain,
  MountainSnow,
  Music,
  Rabbit,
  Sailboat,
  Shell,
  Snowflake,
  Squirrel,
  Star,
  Sun,
  Tent,
  TreePine,
  Turtle,
  Waves,
  Zap,
} from 'lucide-react-native';
import { AVATAR_ICONS } from '../profile/avatar';

type IconComponent = typeof Fish;

const BY_NAME: Record<(typeof AVATAR_ICONS)[number], IconComponent> = {
  fish: Fish,
  shell: Shell,
  waves: Waves,
  mountain: Mountain,
  'mountain-snow': MountainSnow,
  'tree-pine': TreePine,
  tent: Tent,
  compass: Compass,
  sun: Sun,
  moon: Moon,
  star: Star,
  anchor: Anchor,
  sailboat: Sailboat,
  bike: Bike,
  footprints: Footprints,
  flame: Flame,
  snowflake: Snowflake,
  leaf: Leaf,
  feather: Feather,
  bird: Bird,
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  cat: Cat,
  dog: Dog,
  'flower-2': Flower2,
  cloud: Cloud,
  zap: Zap,
  heart: Heart,
  music: Music,
};

export function avatarIcon(id: number): IconComponent {
  return BY_NAME[AVATAR_ICONS[id] ?? AVATAR_ICONS[0]];
}
