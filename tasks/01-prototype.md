# 01 · Prototype de bout en bout

Objectif : un message texte chiffré par Wavepod, transporté par Meshtastic entre deux T1000-E, déchiffré par le destinataire, avec un accusé applicatif.

## Sous-tâches

- [x] **[code]** Initialiser l'application React Native 0.88 (TypeScript) dans `app/`, avec lint, Jest et build iOS.
- [x] **[code]** Générer le code TypeScript depuis les `.proto` Meshtastic v2.8.3 dans `app/src/radio/meshtastic/proto/`.
- [x] **[code]** Écrire l'interface radio `RadioInterface` (`send`, `onReceive`, `connectionState`, plus `onAck` pour l'accusé module).
- [x] **[code]** Écrire le codec binaire (31 octets de surcoût), avec ses tests.
- [x] **[code]** Écrire l'enveloppe de chiffrement : X25519, HKDF, ChaCha20-Poly1305 (`@noble/*`), avec ses tests.
- [x] **[code]** Écrire le traitement de la trame Meshtastic (`ToRadio` et `FromRadio`, port 256), testé sans BLE.
- [x] **[code]** Écrire le transport BLE (`react-native-ble-plx`) : scan, connexion, `want_config_id`, lecture et écriture.
- [x] **[code]** Écrire l'écran de prototype, avec un autotest au démarrage (chiffrement et protobuf sous Hermes).
- [x] **[code]** Simulation : 20 messages sur 20 livrés et déchiffrés entre deux nœuds `meshtasticd` (firmware 2.7.26), via TCP (`app/tools/sim/`).
- [ ] **[terrain]** Installer sur deux iPhones (ou un iPhone et un Android), appairer deux T1000-E réglés en `EU_868`.
- [ ] **[terrain]** Envoyer 20 messages à 500 m en vue directe, et capturer depuis un troisième nœud pour vérifier qu'aucun texte n'apparaît en clair.

## Critère de fin

20 messages sur 20 livrés et déchiffrés, un accusé applicatif pour chacun, aucun texte en clair dans la capture.

## Mode d'emploi du test terrain

Mis à jour après la tâche 04 : les rôles A et B et les clés de test n'existent plus.

1. **Modules** : avec l'application Meshtastic ou le flasheur web, vérifier le firmware (2.6 ou plus, idéalement 2.8.x), régler la région `EU_868` et laisser le preset LongFast. Les deux modules doivent être sur le même canal principal. La configuration automatique arrive en tâche 08.
2. **Installer l'application** : ouvrir `app/ios/Wavepod.xcworkspace` dans Xcode, choisir ton équipe de signature (onglet Signing), brancher l'iPhone, puis Run. Lancer `npm start` dans `app/` pour Metro, ou utiliser la configuration Release.
3. **Module** : sur l'accueil, toucher le bandeau « Aucun module connecté », puis « Chercher un module », puis le T1000-E. Saisir le PIN BLE si iOS le demande (souvent `123456` sur le T1000-E, à confirmer). Le point passe au vert quand le module est prêt.
4. **Contacts** : sur chaque téléphone, « Mon QR » et saisir un pseudo. Le téléphone A scanne le QR de B (« Ajouter »), puis B scanne celui de A. Vérifier que l'empreinte affichée est identique sur les deux téléphones. Chronométrer l'ajout mutuel (critère de la tâche 04 : moins de 30 s).
5. **Envoi** : ouvrir la conversation. Statuts attendus : « envoyé », puis « reçu par son module », puis « livré ». Toucher un message non livré propose « Renvoyer maintenant » ou « Supprimer ». Le journal technique est dans « Diagnostic », en bas de l'accueil.
6. **Coupure (tâche 05)** : éteindre un module, envoyer 3 messages depuis l'autre téléphone, rallumer le module et le reconnecter (la reconnexion automatique arrive en tâche 07), puis écrire un message depuis ce téléphone. Les 3 messages doivent arriver en moins de 2 min, sans doublon.
7. **Rapport** : noter pour chaque message le statut final, la distance et l'environnement. Me transmettre le journal de « Diagnostic » en cas d'échec.

## Notes

- Constat de la simulation : si le module redémarre, l'adaptateur passe en « déconnecté » sans se reconnecter, et le message en cours reste « envoyé ». À traiter en tâches 05 (outbox) et 07 (reconnexion).
- Les clés de test A et B ont été remplacées par l'identité réelle et les contacts par QR (tâche 04).
- Port 256 (`PRIVATE_APP`) : réservé au développement, il faudra demander un numéro dédié à Meshtastic.
- Android SDK absent sur la machine de développement : le build Android n'a pas été testé.
- Vérifié sur simulateur iOS : build, chargement et autotest. Le BLE n'existe pas sur simulateur, la suite ne se teste que sur appareil.
