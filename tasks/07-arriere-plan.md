# 07 · Arrière-plan et messages manqués

Objectif : recevoir les messages écran verrouillé et signaler ce qui a pu être manqué.

## Sous-tâches

- [ ] **[code]** iOS : mode `bluetooth-central` et restauration d'état CoreBluetooth (identifiant de restauration).
- [ ] **[code]** Android : service au premier plan `connectedDevice`, permissions et notification permanente.
- [ ] **[code]** Envoyer les notifications locales à la réception d'un message.
- [ ] **[code]** Écrire la reconnexion automatique et le moniteur de connexion (`connectionMonitor.ts`).
- [ ] **[code]** Détecter les messages possiblement manqués (déconnexion longue, accusés manquants), avec un bandeau dans l'interface.
- [ ] **[code]** Écrire le guide in-app sur l'optimisation de batterie Android.
- [ ] **[terrain]** Écran verrouillé pendant 1 h, 10 messages, sur iOS et sur Android.
- [ ] **[code]** Documenter le comportement par plateforme dans `docs/arriere-plan.md`.

## Critère de fin

10 messages reçus écran verrouillé, tous notifiés ou signalés comme manqués, sur les deux plateformes.
