# 03 · Identité et stockage sécurisé

Objectif : identité Wavepod générée et gardée sur le téléphone, base locale chiffrée.

## Sous-tâches

- [x] **[code]** Générer l'identité : une graine de 32 octets, d'où sont dérivées par HKDF une paire X25519 et une paire Ed25519. Identifiant de contact dérivé de la clé X25519. Empreinte de vérification de 12 chiffres (`src/crypto/identity.ts`).
- [x] **[code]** Stocker la graine via `react-native-keychain` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` : lisible en arrière-plan, jamais synchronisée ni restaurée sur un autre appareil).
- [x] **[code]** Ouvrir la base `op-sqlite` avec SQLCipher, avec une clé aléatoire de 32 octets stockée dans le trousseau (`src/storage/native.ts`).
- [x] **[code]** Écrire le schéma initial (`meta`, `contacts`, `messages`, `outbox`, `dedup`) et les migrations par `PRAGMA user_version` (`src/storage/migrations.ts`).
- [x] **[code]** Écrire le dépôt de contacts (`src/storage/contacts.ts`).
- [x] **[code]** Démarrage : création ou chargement de l'identité, cas d'erreur (clés perdues, base illisible) avec réinitialisation confirmée par l'utilisateur (`src/storage/bootstrap.ts`, `src/app/AppRoot.tsx`).
- [x] **[code]** Tests : création, rechargement, réinstallation, clés manquantes, mauvaise clé, graine incohérente, migrations, contacts.
- [ ] **[code]** Remplacer les clés en dur du prototype par l'identité réelle. **Reporté à la tâche 04** : sans QR code, le téléphone ne peut pas obtenir la clé publique de l'autre.

## Critère de fin

Clé privée jamais lisible hors du stockage sécurisé. Base illisible sans la clé. Tests verts.

## Vérifications

- 67 tests Jest verts (SQLite de Node pour les tests : le chiffrement SQLCipher lui-même ne se teste que sur appareil).
- Sur simulateur iOS :
  - autotest de stockage « base chiffrée OK » : une base écrite avec une clé ne s'ouvre pas avec une autre ;
  - même identité après redémarrage de l'application ;
  - nouvelle identité après désinstallation et réinstallation.

## Points d'attention

- **Trousseau iOS** : il survit à la désinstallation. C'est l'absence de base qui signale une réinstallation : les anciens secrets sont alors effacés.
- **Sauvegardes** : sauvegarde Android désactivée (`allowBackup="false"`). Sur iOS, une base restaurée par iCloud sur un autre appareil n'aura pas ses clés (`THIS_DEVICE_ONLY`) : l'application proposera de repartir de zéro. À décider : exclure la base des sauvegardes iCloud.
- **Bug op-sqlite 19.0.6** : le processus avorte quand Hermes libère un objet base de données fermé (`std::terminate` dans `~WorkerThread`, observé le 2026-11-25). Contournement dans `native.ts` : chaque objet ouvert est conservé jusqu'à la fin de l'application. À signaler en amont, et à retirer une fois corrigé.
- **Transactions** : elles sont sérialisées entre elles, mais une requête hors transaction lancée par un autre flux peut s'y intercaler. À revoir quand l'outbox (tâche 05) écrira en parallèle.
- Android non compilé (SDK absent).
