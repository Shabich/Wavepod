# Plan de démarrage

À valider avant toute écriture de code d'application. Les chemins de fichiers sont indicatifs et dépendent des choix technologiques ci-dessous.

## Tâches

### 1. Prototype de bout en bout
- **Objectif** : deux T1000-E et deux téléphones. Un message texte chiffré par Wavepod, transporté par Meshtastic, déchiffré par le destinataire, avec un accusé applicatif en retour.
- **Fichiers** : `app/src/radio/RadioInterface.ts`, `app/src/radio/meshtastic/MeshtasticAdapter.ts`, `app/src/crypto/envelope.ts`, `app/src/screens/PrototypeScreen.tsx`.
- **Critère de fin** : 20 messages sur 20 livrés et déchiffrés à 500 m en vue directe. Accusé applicatif reçu pour chacun. Le texte n'apparaît jamais en clair dans les paquets capturés (vérifié avec l'application Meshtastic sur un troisième nœud). Clés en dur acceptées à ce stade.

### 2. Mesures radio et format de message
- **Objectif** : mesurer la taille utile réelle, le temps d'antenne, le duty cycle par défaut de `EU_868` et la portée du T1000-E face à la WisMesh Pocket. Figer la version 1 du format binaire.
- **Fichiers** : `docs/mesures-radio.md`, `docs/format-message.md`, `app/src/protocol/codec.ts` et ses tests.
- **Critère de fin** : toutes les valeurs « À valider » de la partie radio de `WAVEPOD.md` sont confirmées ou corrigées. Le codec passe ses tests (encodage, décodage, versions, tailles limites).

### 3. Identité et stockage sécurisé
- **Objectif** : générer la paire de clés sur le téléphone, la stocker dans le Keychain ou le Keystore, et ouvrir la base locale chiffrée.
- **Fichiers** : `app/src/crypto/identity.ts`, `app/src/storage/db.ts`, `app/src/storage/schema.sql`.
- **Critère de fin** : la clé privée n'est jamais lisible hors du stockage sécurisé. La base est illisible sans la clé (test avec un fichier copié). Réinstaller l'application sans sauvegarde crée bien une nouvelle identité.

### 4. Contacts par QR code
- **Objectif** : afficher et scanner le QR « scanne pour m'ajouter », vérifier l'empreinte, et étudier la compatibilité avec les liens `meshtastic.org/v/#...`.
- **Fichiers** : `app/src/contacts/qr.ts`, `app/src/screens/AddContactScreen.tsx`, `docs/qr-format.md`.
- **Critère de fin** : deux téléphones s'ajoutent mutuellement en moins de 30 s. L'empreinte est identique des deux côtés. Un QR invalide ou altéré est refusé.

### 5. Outbox et livraison fiable
- **Objectif** : implémenter la machine d'états, les accusés à deux niveaux, la déduplication, le TTL, la règle d'envoi conditionnée à la présence et la sonde de secours.
- **Fichiers** : `app/src/delivery/outbox.ts`, `app/src/delivery/dedup.ts` et leurs tests.
- **Critère de fin** : tests unitaires de tous les états et transitions du diagramme. Test terrain avec un destinataire hors de portée puis de retour : ses messages partent automatiquement en moins de 2 min, sans doublon.

### 6. Présence
- **Objectif** : balise optionnelle, « vu il y a X min » mis à jour par tout paquet du contact, mode discret.
- **Fichiers** : `app/src/presence/beacon.ts`, `app/src/presence/lastSeen.ts`.
- **Critère de fin** : la balise respecte sa fréquence (vérifié par mesure du temps d'antenne). Le mode discret coupe toute émission spontanée.

### 7. Arrière-plan et messages manqués
- **Objectif** : maintenir la connexion BLE en arrière-plan sur iOS et Android, envoyer les notifications locales, signaler les messages manqués ou non livrés.
- **Fichiers** : configuration native iOS (`Info.plist`, modes d'arrière-plan), service Android au premier plan, `app/src/radio/connectionMonitor.ts`.
- **Critère de fin** : écran verrouillé pendant 1 h, 10 messages reçus, tous notifiés ou signalés comme manqués. Comportement documenté pour chaque plateforme.

### 8. Configuration automatique du module et test MVP
- **Objectif** : préconfigurer le module à l'appairage (région, preset, canal privé, positions et télémétrie réduites, nom neutre), puis faire un test terrain du MVP.
- **Fichiers** : `app/src/radio/meshtastic/provisioning.ts`, `docs/test-terrain-mvp.md`.
- **Critère de fin** : un utilisateur non technique appaire un module neuf sans toucher à un réglage radio. Critère MVP de `WAVEPOD.md` atteint.

## Choix technologiques à trancher

| Choix | Options | Recommandation | Raison |
|---|---|---|---|
| Framework mobile | React Native, Flutter, natif (Swift et Kotlin) | **React Native (TypeScript)** avec un module natif si le BLE en arrière-plan l'exige | Un seul code, écosystème TypeScript pour protobuf et libsodium, paquets JS Meshtastic existants (GPL). Le natif est plus fiable pour l'arrière-plan mais double le travail. Flutter est une alternative équivalente si tu préfères Dart. |
| Bibliothèque BLE | `react-native-ble-plx`, `react-native-ble-manager`, module natif | **`react-native-ble-plx`** pour démarrer, avec restauration d'état iOS activée | Maintenue, prend en charge la restauration CoreBluetooth. À remplacer par un module natif si les tests de la tâche 7 échouent. |
| Chiffrement | libsodium (`react-native-libsodium`), `@noble/curves` et `@noble/ciphers`, API natives (CryptoKit, Tink) | ~~libsodium~~ → **`@noble/curves`, `@noble/ciphers`, `@noble/hashes`** (changé en tâche 01) | `react-native-libsodium` n'expose ni `crypto_scalarmult` (X25519 brut) ni ChaCha20-Poly1305 à nonce de 12 octets : seule XChaCha (nonce de 24 octets) est disponible, soit 12 octets de plus par message. Les bibliothèques noble sont auditées, en JavaScript pur, sans module natif, et testables dans Jest. Point à surveiller : les performances sur Hermes (autotest en 274 ms en mode debug sur simulateur). |
| Base locale chiffrée | SQLCipher via `op-sqlite`, Realm chiffré, WatermelonDB et SQLCipher | **`op-sqlite` avec SQLCipher**, clé dans le Keychain ou le Keystore via `react-native-keychain` | SQL simple pour l'outbox et la déduplication, chiffrement de la base entière, bonnes performances. |
| Protobuf | `@meshtastic/protobufs` (GPL), génération depuis les `.proto` avec `protobuf-es` | **Génération depuis les `.proto`**, version épinglée | Contrôle de la version du protocole. Licence GPL dans les deux cas (voir `WAVEPOD.md`). |
| Licence de Wavepod | GPL-3.0, propriétaire | **GPL-3.0** (en attente d'un avis juridique) | Compatible avec la réutilisation du protocole Meshtastic, ce qui supprime le risque principal. |
