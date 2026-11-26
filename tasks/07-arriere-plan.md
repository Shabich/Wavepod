# 07 · Arrière-plan et messages manqués

Objectif : recevoir les messages écran verrouillé et signaler ce qui a pu être manqué. Détails dans `docs/arriere-plan.md`.

## Sous-tâches

- [x] **[code]** iOS : mode `bluetooth-central` et restauration d'état CoreBluetooth.
- [x] **[code]** Android : service au premier plan `connectedDevice` (Notifee), permissions et notification permanente.
- [x] **[code]** Envoyer les notifications locales à la réception d'un message (sauf pour la conversation ouverte), et ouvrir la conversation au toucher.
- [x] **[code]** Écrire la reconnexion automatique : dernier module mémorisé, reprise au démarrage, délais croissants, arrêt sur déconnexion manuelle, pas d'interférence avec la configuration.
- [x] **[code]** Signaler les messages possiblement manqués : bandeau après une minute de coupure, « Reconnexion au module… » sur l'accueil.
- [x] **[code]** Écrire les conseils dans l'écran Module : réglages de batterie sur Android, ne pas balayer l'app sur iOS.
- [ ] **[terrain]** Écran verrouillé pendant 1 h, 10 messages, sur iOS et sur Android.
- [x] **[code]** Documenter le comportement par plateforme dans `docs/arriere-plan.md`.

## Critère de fin

10 messages reçus écran verrouillé, tous notifiés ou signalés comme manqués, sur les deux plateformes.

## Vérifications

- 161 tests Jest verts, dont 4 nouveaux sur la surveillance de connexion (reconnexion, arrêt sur déconnexion, reprise au démarrage, redémarrage de configuration) et 11 sur les notifications.
- `meshtasticd` : reconnexion automatique 3 s après la remise en route d'un nœud arrêté (`tools/sim/reconnect-check.ts`).
- Simulateur iOS : build avec Notifee, demande d'autorisation des notifications affichée, restauration BLE appelée au démarrage.
- Non vérifié : voir la fin de `docs/arriere-plan.md`.
