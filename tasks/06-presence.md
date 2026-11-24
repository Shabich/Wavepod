# 06 · Présence

Objectif : « vu il y a X min », balise optionnelle et mode discret.

## Sous-tâches

- [ ] **[code]** Mettre à jour le « vu » par tout paquet du contact (message, accusé, balise, NodeInfo, `last_heard`).
- [ ] **[code]** Écrire la balise Wavepod chiffrée : intervalle de 15 à 30 min avec gigue aléatoire, sans position.
- [ ] **[code]** Étudier le jeton rotatif pour ne pas lier la balise à l'identité aux yeux des tiers.
- [ ] **[code]** Écrire le mode discret, qui coupe toute émission spontanée (balise, sonde).
- [ ] **[code]** Ajouter la réserve d'antenne : compteur du temps d'émission sur l'heure glissante, avec indicateur dans l'interface.
- [ ] **[terrain]** Vérifier la fréquence réelle des balises par mesure du temps d'antenne.

## Critère de fin

Fréquence de balise respectée, mode discret sans aucune émission spontanée.
