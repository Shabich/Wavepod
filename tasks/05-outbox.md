# 05 · Outbox et livraison fiable

Objectif : la machine d'états de livraison décrite dans `WAVEPOD.md`.

## Sous-tâches

- [ ] **[code]** Écrire la machine d'états pure (sans I/O) : en attente, envoi, envoyé module, reçu module, livré, lu, retry, échoué.
- [ ] **[code]** Écrire la règle d'envoi conditionnée à la présence (fenêtre réglable), les retries espacés et le retour en attente.
- [ ] **[code]** Écrire la sonde de secours toutes les 1 à 2 h et le vidage de la file sur tout signal du contact.
- [ ] **[code]** Gérer le TTL (24 h par défaut), le renvoi manuel et l'annulation.
- [ ] **[code]** Écrire la déduplication côté destinataire (expéditeur, identifiant), avec purge après le TTL.
- [ ] **[code]** Brancher les accusés à deux niveaux : accusé de routage Meshtastic et accusé applicatif Wavepod.
- [ ] **[code]** Persister l'outbox dans la base et la reprendre au redémarrage.
- [ ] **[code]** Afficher les états dans l'interface de conversation.
- [ ] **[code]** Tests : chaque transition, horloge simulée, doublons, redémarrage.
- [ ] **[terrain]** Test avec un destinataire hors de portée puis de retour.

## Critère de fin

Tests de toutes les transitions verts. Au retour du destinataire, ses messages partent en moins de 2 min, sans doublon.
