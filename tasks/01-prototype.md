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

1. **Modules** : avec l'application Meshtastic ou le flasheur web, vérifier le firmware (2.6 ou plus, idéalement 2.8.x), régler la région `EU_868` et laisser le preset LongFast. Les deux modules doivent être sur le même canal principal.
2. **Installer l'application** : ouvrir `app/ios/Wavepod.xcworkspace` dans Xcode, choisir ton équipe de signature (onglet Signing), brancher l'iPhone, puis Run. Lancer `npm start` dans `app/` pour Metro, ou utiliser la configuration Release.
3. **Au lancement** : vérifier que l'écran affiche « autotest OK ». Choisir « Téléphone A » sur l'un, « Téléphone B » sur l'autre.
4. **Connexion** : « Chercher un module », toucher le T1000-E. Saisir le PIN BLE si iOS le demande (souvent `123456` sur le T1000-E, à confirmer).
5. **Destinataire** : une fois l'écran « prêt » affiché, toucher le nœud de l'autre module dans « Destinataire ». Le côté B le détecte tout seul au premier message reçu.
6. **Envoi** : statuts attendus « envoyé », puis « reçu par le module », puis « livré ». Le journal montre les identifiants, les accusés et les erreurs radio.
7. **Rapport** : noter pour chaque message le statut final, le SNR et le RSSI affichés côté réception, la distance et l'environnement. Me transmettre le journal en cas d'échec.

## Notes

- Constat de la simulation : si le module redémarre, l'adaptateur passe en « déconnecté » sans se reconnecter, et le message en cours reste « envoyé ». À traiter en tâches 05 (outbox) et 07 (reconnexion).

- Les clés de test A et B sont en dur et identiques sur tous les téléphones : sécurité nulle, pour le prototype seulement (remplacé en tâche 03).
- Port 256 (`PRIVATE_APP`) : réservé au développement, il faudra demander un numéro dédié à Meshtastic.
- Android SDK absent sur la machine de développement : le build Android n'a pas été testé.
- Vérifié sur simulateur iOS : build, chargement et autotest. Le BLE n'existe pas sur simulateur, la suite ne se teste que sur appareil.
