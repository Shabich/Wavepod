# 01 · Prototype de bout en bout

Objectif : un message texte chiffré par Wavepod, transporté par Meshtastic entre deux T1000-E, déchiffré par le destinataire, avec un accusé applicatif.

## Sous-tâches

- [ ] **[code]** Initialiser l'application React Native (TypeScript) dans `app/`, avec lint, Jest et build iOS.
- [ ] **[code]** Générer le code TypeScript depuis les `.proto` Meshtastic (version épinglée) dans `app/src/radio/meshtastic/proto/`.
- [ ] **[code]** Écrire l'interface radio `RadioInterface` (`send`, `onReceive`, `connectionState`).
- [ ] **[code]** Écrire le codec binaire provisoire (version, type, indice de clé, identifiant, nonce, contenu, tag), avec ses tests.
- [ ] **[code]** Écrire l'enveloppe de chiffrement : X25519, HKDF, ChaCha20-Poly1305 via libsodium, avec ses tests (aller-retour, falsification refusée).
- [ ] **[code]** Écrire le traitement de la trame Meshtastic : construction des `ToRadio`, lecture des `FromRadio`, port privé, testé sans BLE.
- [ ] **[code]** Écrire le transport BLE (`react-native-ble-plx`) : scan, connexion, `want_config_id`, lecture de `FromRadio`, écriture de `ToRadio`.
- [ ] **[code]** Écrire l'écran de prototype : choix du module, clés de test en dur, envoi, journal des messages et accusés.
- [ ] **[terrain]** Installer sur deux iPhones (ou un iPhone et un Android), appairer deux T1000-E réglés en `EU_868`.
- [ ] **[terrain]** Envoyer 20 messages à 500 m en vue directe, et capturer depuis un troisième nœud pour vérifier qu'aucun texte n'apparaît en clair.

## Critère de fin

20 messages sur 20 livrés et déchiffrés, un accusé applicatif pour chacun, aucun texte en clair dans la capture.

## Notes

- La région se règle temporairement par l'application Meshtastic ou la CLI si l'écran de prototype ne le fait pas encore. La configuration automatique arrive en tâche 08.
- Android SDK absent sur la machine de développement : build iOS d'abord.
