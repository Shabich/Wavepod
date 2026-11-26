# Arrière-plan, reconnexion et messages manqués

## Reconnexion automatique (`app/src/app/moduleManager.ts`)

- Le dernier module est mémorisé dans la base chiffrée. Au démarrage, Wavepod s'y reconnecte de lui-même.
- Après une coupure inattendue (hors de portée, module éteint ou redémarré), il relance la connexion avec des délais croissants : 2 s, 5 s, 10 s, 30 s, puis toutes les 60 s.
- La surveillance s'arrête si l'utilisateur appuie sur « Déconnecter » (le module est alors oublié) ou s'il choisit un autre module.
- Le redémarrage voulu qui suit une configuration (tâche 08) n'est pas traité comme une coupure.
- **iOS** : une demande de connexion Bluetooth n'expire pas. Elle est gérée par le système et aboutit dès que le module réapparaît, sans balayage coûteux en batterie.
- **Android** : `autoConnect` produit le même effet.
- Vérifié contre `meshtasticd` (`tools/sim/reconnect-check.ts`) : nœud arrêté 15 s, coupure détectée immédiatement, reconnexion 3 s après la remise en route.

## iOS

- Mode d'arrière-plan `bluetooth-central` (`Info.plist`) et restauration d'état CoreBluetooth (`restoreStateIdentifier` de `react-native-ble-plx`). iOS peut réveiller ou relancer l'app quand le module envoie une notification BLE. Le code JavaScript a alors quelques secondes pour lire le module, enregistrer le message et afficher une notification.
- Si l'utilisateur ferme l'app en la balayant, iOS ne la relance pas en arrière-plan avant sa prochaine ouverture. Un conseil s'affiche dans l'écran Module.
- Les notifications sont locales (Notifee) : aucun serveur, aucun internet.

## Android

- Service au premier plan de type `connectedDevice` (obligatoire depuis Android 14), porté par la notification permanente « Connecté à WP-XXXX » tant qu'un module est suivi. Il s'arrête à la déconnexion manuelle.
- Permissions : `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` et `POST_NOTIFICATIONS` (Android 13+, demandée à la première connexion d'un module).
- Optimisations de batterie des constructeurs : un bouton de l'écran Module ouvre les réglages pour exclure Wavepod.
- Icône de notification monochrome (`drawable-*/ic_notification.png`).

## Notifications de messages (`app/src/app/notifications.ts`)

- Une notification par message reçu, sauf si l'app est au premier plan sur cette conversation.
- Le titre est le nom du contact et le texte le message (tronqué à 140 caractères). Sur iOS, l'utilisateur choisit dans les réglages si l'aperçu s'affiche sur l'écran verrouillé.
- Toucher la notification ouvre la conversation.
- La permission est demandée à la première connexion d'un module. L'écran Diagnostic a un bouton « Notification de test ».

## Messages manqués

- Pendant une déconnexion, le module garde les paquets destinés au téléphone dans une file limitée. Dans le firmware 2.8.2, elle compte **16 paquets sur nRF52840** (T1000-E, WisMesh Pocket), 8 sur l'ESP32 classique et 32 sur d'autres plateformes (`MAX_RX_TOPHONE`, `src/mesh/mesh-pb-constants.h`). Quand elle est pleine, les plus anciens sont perdus (« fromRadioQ full, drop oldest », observé en simulation). Cette file contient tous les paquets, pas seulement ceux de Wavepod : couper positions et télémétrie (tâche 08) la préserve.
- Côté envoi, rien n'est perdu : l'outbox garde les messages jusqu'au retour du module (tâche 05).
- Côté réception, au-delà d'une minute de coupure, un bandeau s'affiche sur l'accueil et dans la conversation : « Module hors de portée depuis X min : tes messages partiront dès son retour. Ceux qu'on t'envoie pendant la coupure peuvent être perdus. »
- Pour l'expéditeur, un message perdu de cette façon reste « reçu par son module » sans passer à « livré ». Il peut le renvoyer.

## Non vérifié

- La réception écran verrouillé pendant 1 h sur un vrai iPhone et un vrai Android (critère de la tâche).
- L'affichage effectif d'une notification après autorisation : sur simulateur, la demande système apparaît, ce qui prouve que le module natif répond, mais je n'ai pas pu toucher « Autoriser ».
- Tout le code Android, qui n'a jamais été compilé (SDK absent).
- Notifee 9.1.8 date de décembre 2024. Il compile sur iOS avec React Native 0.88, mais son évolution est à surveiller.
