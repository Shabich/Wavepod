# Charte graphique Wavepod

Logo : une orque dans une bulle de conversation. Un « pod » est aussi le nom d'un groupe d'orques.

## Couleurs

Mesurées dans les fichiers du logo. Jetons définis dans `app/src/ui/theme.ts`.

| Jeton | Couleur | Origine | Usage |
|---|---|---|---|
| `primary` | `#4F64AA` | Fond de l'icône | Boutons, bulles envoyées, liens, avatars |
| `primaryDark` | `#384986` | Œil de l'orque | Bouton appuyé, badges |
| `night` | `#1B2340` | Fond « nuit » | Titres et texte |
| `slate` | `#5A6178` | Fond « ardoise » | Texte secondaire |
| `mist` | `#EEF1F9` | Fond « brume » | Cartes, bulles reçues |
| `border` | `#D5DAEA` | Dérivé de brume | Bordures des champs |
| `success` / `danger` | `#067647` / `#B42318` | Hors logo | États (module prêt, erreurs) |

Contrastes (WCAG) : blanc sur `primary` 5,6, `slate` sur blanc 6,2, `slate` sur `mist` 5,4, `night` sur `mist` 13,7. Tous les couples de texte respectent le niveau AA.

## Fichiers

- `orque-icone/` : icône finale (fond indigo) de 48 à 1024 px. Source des icônes iOS (`AppIcon`, 1024 px) et Android (`mipmap-*`).
- `orque-fonds/` : logo sur fonds nuit, ardoise, brume, blanc ou sans fond, en blanc ou en indigo.
  - `orque-bleue-sans-fond` sert de logo dans l'application (`app/src/ui/assets/orque*.png`).
  - `sans-fond` (orque blanche) sert pour l'écran de lancement iOS et pour l'icône adaptative Android.

Les fichiers dérivés sont générés à partir de ces sources (redimensionnement, recadrage sur le contenu). À refaire si le logo change.
