# 08 · Configuration du module et test MVP

Objectif : appairer un module neuf sans aucun réglage radio, puis valider le MVP sur le terrain.

## Sous-tâches

- [ ] **[code]** Lire la configuration existante, la sauvegarder et prévenir si le module était déjà configuré.
- [ ] **[code]** Appliquer la configuration Wavepod par `AdminMessage` (tableau de `WAVEPOD.md`).
- [ ] **[code]** Créer le canal privé du pod (clé aléatoire) et le partager par QR.
- [ ] **[code]** Vérifier la version minimale du firmware à la connexion.
- [ ] **[code]** Écrire le parcours d'accueil : permissions, identité, appairage, premier contact.
- [ ] **[code]** Étudier le PIN BLE du T1000-E (PIN fixe ou PIN choisi par Wavepod).
- [ ] **[terrain]** Faire appairer un module neuf par un utilisateur non technique.
- [ ] **[terrain]** Test MVP : 4 personnes, une journée de randonnée, avec rapport dans `docs/test-terrain-mvp.md`.

## Critère de fin

Appairage sans réglage radio réussi. Plus de 95 % des messages livrés dans le TTL, aucun message perdu sans indication.
