# CLAUDE.md

Instructions pour travailler sur Wavepod. Le document de référence est `WAVEPOD.md`, le brief d'origine est `brief.md` et le plan de démarrage est `PLAN.md`.

## État du projet

- Plan et choix technologiques validés le 2026-11-24 : React Native (TypeScript), `react-native-ble-plx`, `op-sqlite` avec SQLCipher, protobuf généré depuis les `.proto` Meshtastic. Pour le chiffrement, `@noble/*` remplace libsodium (voir `PLAN.md`).
- Application dans `app/`. Commandes : `npm test`, `npm run typecheck`, `npm run lint`, `npm run proto` (régénère le code protobuf depuis `app/proto/`).
- Les `.proto` Meshtastic sont copiés dans `app/proto/` (version dans `app/proto/VERSION`). Ne pas modifier le code généré dans `src/radio/meshtastic/proto/`.
- `src/polyfills` doit rester le premier import de `index.js` (aléa crypto, `TextDecoder` absent de Hermes).
- Tâches détaillées dans `tasks/`, suivi de l'avancement dans `tasks/README.md`.

## Git

- Une branche par tâche (`task-01-prototype`…), fusionnée dans `main` une fois le critère de fin atteint.
- Messages de commit : quelques mots simples en anglais (« Add message codec »). Pas de préfixe (`feat:`, `fix:`…), pas de ligne d'attribution.
- Pas de push : le porteur du projet s'en charge.

## Conventions

- Documentation en français, ton clair et professionnel, sans emojis, titres en sentence case.
- Code, identifiants, commentaires de code et messages de commit en anglais.
- Distinguer partout : **décision** (choix arrêté), **hypothèse** (comportement externe supposé), **À valider** (non vérifié).
- Tout chiffre radio (taille utile, temps d'antenne, duty cycle, portée) est marqué « À valider » tant qu'il n'a pas été mesuré ou vérifié dans la documentation ou le code Meshtastic à jour.
- Ne jamais inventer un comportement de Meshtastic. Le vérifier dans la documentation ou le code source, ou le signaler.

## Décisions d'architecture

1. **Radio** : firmware Meshtastic sur les modules, sans firmware maison. L'application parle au module en BLE avec le protocole Meshtastic (protobuf).
2. **Interface radio minimale** : `send`, `onReceive`, `connectionState`. Seul l'adaptateur Meshtastic importe du protobuf. Pas de HAL multi-protocole avant la v2.
3. **Matériel de référence** : Seeed SenseCAP T1000-E, avec la RAK WisMesh Pocket en comparaison. Tout module Meshtastic 868 MHz doit fonctionner.
4. **Texte uniquement** : pas de voix, d'appels, de médias, de PMR446 ni de seconde radio.
5. **Chiffrement Wavepod de bout en bout** dans l'application, avant remise à Meshtastic. Meshtastic transporte un blob opaque sur un port privé.
6. **Les clés ne quittent jamais le téléphone** (Keychain iOS, Keystore Android). Aucune clé Wavepod sur le module, dans les logs ou dans un export non chiffré.
7. **Identité** : l'adresse d'un contact est dérivée de sa clé publique, jamais de sa position. L'identifiant de nœud Meshtastic n'est qu'un indice de routage.
8. **Contacts** par QR code contenant la clé publique Wavepod.
9. **Routage délégué à Meshtastic** : ne pas réimplémenter le mesh.
10. **Livraison fiable côté application** : outbox persistante, identifiant unique, déduplication, accusés à deux niveaux, TTL de 24 h, envoi conditionné à la présence, sonde de secours, retour en attente après échec des retries.
11. **Présence** : balise optionnelle toutes les 15 à 30 min, sans position par défaut, avec un mode discret. Affichage « vu il y a X min », jamais « en ligne ».
12. **Budget d'antenne** : chaque fonctionnalité respecte une taille et une fréquence maximales (tableau dans `WAVEPOD.md`). Toute nouvelle fonctionnalité qui émet doit y être ajoutée.
13. **Stockage** : base locale chiffrée. Pas d'historique sur les modules.
14. **Vie privée par défaut** : positions coupées, noms de module neutres, télémétrie Meshtastic réduite.
15. **Pas d'application Meshtastic requise** : Wavepod appaire, configure (`AdminMessage`) et synchronise lui-même le module. Il vérifie la version minimale du firmware à chaque connexion.

## Règles de travail

- Avant d'ajouter un type de paquet, chiffrer sa taille et sa fréquence, et mettre à jour le budget d'antenne.
- Toute modification du format binaire des messages incrémente le champ version et garde une compatibilité de lecture.
- Aucune dépendance cryptographique maison : bibliothèques auditées uniquement (libsodium ou équivalent).
- Tests unitaires obligatoires pour : format de message, chiffrement et déchiffrement, déduplication, machine d'états de l'outbox.
- Tester sur matériel réel (2 modules, 2 téléphones) toute modification de la couche radio.
- Vérifier la licence de toute dépendance ou de tout fichier repris de Meshtastic (GPL-3.0) avant de l'intégrer.
- Ne pas committer de clés, de captures de trames réelles avec identifiants ni de fichiers de configuration de modules personnels.

## Glossaire

| Terme | Définition |
|---|---|
| LoRa | Modulation radio longue portée et bas débit |
| Meshtastic | Firmware et protocole open source de mesh LoRa |
| Module ou nœud | Appareil LoRa sous Meshtastic (par exemple un T1000-E) |
| Mesh | Réseau maillé où les nœuds relaient les messages |
| BLE | Bluetooth Low Energy, lien entre le téléphone et le module |
| Duty cycle | Part maximale du temps d'émission autorisée (1 % ou 10 % selon la sous-bande) |
| Temps d'antenne (airtime) | Durée d'émission d'un paquet |
| SF | Spreading factor : plus il est élevé, plus la portée est grande et le débit faible |
| Preset | Profil radio Meshtastic (LongFast, MediumFast…) |
| Hop limit | Nombre maximal de relais d'un paquet |
| Next hop | Routage Meshtastic des messages directs par relais appris |
| NodeInfo | Paquet Meshtastic qui annonce un nœud (nom, matériel, clé publique) |
| Outbox | File d'envoi persistante de l'application |
| Accusé module | Accusé Meshtastic : le module destinataire a reçu le paquet |
| Accusé applicatif | Accusé Wavepod : l'application destinataire a reçu et déchiffré le message |
| Balise | Paquet Wavepod périodique de présence |
| TTL | Durée de vie maximale d'un message en attente |
| AEAD | Chiffrement authentifié (ChaCha20-Poly1305, AES-GCM…) |
| Pod | Groupe de personnes à portée radio, l'unité sociale de Wavepod |
