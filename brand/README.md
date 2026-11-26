# Charte graphique Wavepod

Logo : une orque dans une bulle de conversation. Un « pod » est aussi le nom d'un groupe d'orques.

## Couleurs

Mesurées dans les fichiers du logo. Les jetons sont définis dans `app/src/ui/theme.tsx`. L'application suit le réglage clair ou sombre du téléphone.

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `background` | `#FFFFFF` | `#1B2340` (nuit) | Fond des écrans |
| `surface` | `#EEF1F9` (brume) | `#262F52` | Cartes, bulles reçues |
| `border` | `#D5DAEA` | `#3A4470` | Bordures des champs |
| `text` | `#1B2340` (nuit) | `#EEF1F9` (brume) | Titres et texte |
| `textMuted` | `#5A6178` (ardoise) | `#AEB5CC` | Texte secondaire |
| `primary` | `#4F64AA` | `#4F64AA` | Boutons, bulles envoyées, avatars |
| `primaryPressed` | `#384986` | `#3D5096` | Bouton appuyé |
| `accent` | `#4F64AA` | `#9DAEEB` | Liens, boutons secondaires |
| `accentStrong` | `#384986` | `#C3CDF5` | Badges |
| `success` / `danger` | `#067647` / `#B42318` | `#4ADE95` / `#FF8A80` | États |
| `qrForeground` / `qrBackground` | `#1B2340` / `#FFFFFF` | identiques | QR toujours sombre sur clair, pour la caméra |

Origine des couleurs du logo : indigo `#4F64AA` (fond de l'icône), indigo foncé `#384986` (œil de l'orque), nuit `#1B2340`, ardoise `#5A6178`, brume `#EEF1F9`.

Contrastes : tous les couples texte et fond utilisés respectent le niveau WCAG AA (4,5:1) dans les deux modes. C'est vérifié par `app/__tests__/theme.test.ts`.

Logo dans l'app : orque indigo en mode clair, orque blanche en mode sombre.

## Fichiers

- `orque-icone/` : icône finale (fond indigo) de 48 à 1024 px. Source des icônes iOS (`AppIcon`, 1024 px) et Android (`mipmap-*`).
- `orque-fonds/` : logo sur fonds nuit, ardoise, brume, blanc ou sans fond, en blanc ou en indigo.
  - `orque-bleue-sans-fond` sert de logo dans l'application en mode clair (`app/src/ui/assets/orque*.png`).
  - `sans-fond` (orque blanche) sert de logo en mode sombre (`orque-blanche*.png`), sur l'écran de lancement iOS et dans l'icône adaptative Android.

Les fichiers dérivés sont générés à partir de ces sources (redimensionnement, recadrage sur le contenu). À refaire si le logo change.

## Avatars de profil

Icônes de [Lucide](https://lucide.dev) (licence ISC), en blanc sur 8 couleurs : indigo `#4F64AA`, sarcelle `#0E7490`, vert `#15803D`, orange `#C2410C`, rouge `#B91C1C`, violet `#7E22CE`, rose `#BE185D` et ardoise `#5A6178`. Le contraste de l'icône blanche est d'au moins 4,5:1 sur chacune (`__tests__/profile.test.ts`). Les listes sont dans `app/src/profile/avatar.ts`. On ne fait qu'y ajouter des entrées, jamais les réordonner : seuls les numéros voyagent par radio.

