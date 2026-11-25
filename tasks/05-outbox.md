# 05 · Outbox et livraison fiable

Objectif : la machine d'états de livraison décrite dans `WAVEPOD.md`.

## Sous-tâches

- [x] **[code]** Écrire la décision d'envoi pure (`src/delivery/schedule.ts`) : envoyer, attendre jusqu'à une date, ou expirer.
- [x] **[code]** Écrire la règle d'envoi conditionnée à la présence (fenêtre de 25 min), la série d'essais (0 s, +30 s, +2 min, +5 min) et le retour en attente (`src/delivery/policy.ts`).
- [x] **[code]** Écrire la sonde de secours toutes les 90 min (message le plus ancien seulement) et le vidage de la file sur tout signal du contact.
- [x] **[code]** Gérer le TTL (24 h), le renvoi manuel (nouveau TTL, série immédiate) et l'annulation.
- [x] **[code]** Écrire la déduplication côté destinataire (contact, identifiant), avec purge après 48 h. Chaque copie reçue est quand même acquittée.
- [x] **[code]** Brancher les accusés à deux niveaux : accusé de routage Meshtastic (« reçu par le module ») et accusé applicatif Wavepod (« livré »). Un événement tardif ne fait jamais régresser un statut.
- [x] **[code]** Persister l'outbox dans la base (migration 2) et la reprendre au redémarrage.
- [x] **[code]** Afficher les états dans l'écran du prototype : en attente, envoyé, reçu par le module, livré, échec. Toucher un message non livré propose « Renvoyer » ou « Supprimer ».
- [x] **[code]** Tests : 11 tests de la décision et 16 tests du moteur, avec horloge simulée (série d'essais, sonde, coupure et retour, ordre, espacement, TTL, renvoi, annulation, doublons, statut tardif, radio déconnectée, redémarrage, expéditeur inconnu).
- [x] **[code]** Simulation `meshtasticd` : `npm run sim:test -- 20 --outage` (nœud B arrêté pendant l'envoi, puis relancé).
- [ ] **[terrain]** Test avec un destinataire hors de portée puis de retour.

## Critère de fin

Tests de toutes les transitions verts. Au retour du destinataire, ses messages partent en moins de 2 min, sans doublon.

**Résultat en simulation** : 20 sur 20 livrés. Pendant la coupure, les 3 messages restent « envoyé », sans échec. Au retour de B, ils sont livrés en 0,8 à 1,2 s, et B les reçoit une seule fois chacun (deux exécutions). La simulation utilise des délais raccourcis (essais à +2 s et +4 s).

## Règles précisées pendant l'implémentation

- Un signal du contact relance seulement les messages en attente, c'est-à-dire jamais essayés ou dont la série est terminée. Une série en cours garde son calendrier. Sinon, l'accusé du module pour un message déclencherait aussitôt un renvoi de ce même message.
- Une sonde réussie est un signal : elle vide le reste de la file.
- L'accusé du module destinataire compte comme un signal de présence.
- Une seule émission par passage, espacée de 3 s.
- Radio déconnectée : aucun essai n'est consommé, seule l'expiration reste programmée. L'envoi reprend dès que la radio est prête.
- Toutes les opérations du moteur passent par une file série. Un accusé reçu avant la fin de `radio.send()` est donc traité après l'enregistrement de l'essai, ce qui règle la course trouvée en tâche 01.
- Choisir le nœud du destinataire dans le prototype compte comme un signal de présence. À remplacer par le scan du QR (tâche 04) et la balise (tâche 06).

## Reste à faire ailleurs

- Reconnexion automatique au module (tâche 07) : le moteur reprend seul quand la radio repasse à « prête », mais personne ne relance encore la connexion.
- « Lu » : statut prévu dans le schéma, non émis (optionnel, désactivé par défaut).
- Regrouper plusieurs accusés applicatifs dans un paquet : le format le permet déjà, mais le moteur en envoie un par message.
