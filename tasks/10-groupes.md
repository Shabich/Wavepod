# 10 · Messages de groupe

Objectif : discuter à plusieurs avec un seul paquet radio par message, sans perdre de messages pour les absents.

## Conception décidée

- Une clé de groupe aléatoire, envoyée à chaque membre par message direct chiffré et fiable à la création du groupe (et à chaque ajout de membre).
- Chaque message de groupe part en **une seule diffusion**, chiffrée avec la clé du groupe.
- Chaque membre renvoie un petit accusé applicatif.
- Après un délai, les membres qui n'ont pas accusé réception reçoivent une **copie en message direct** par la file fiable (présence, relances, sonde, TTL).
- Affichage « livré à 3/4 ».

## Sous-tâches

- [ ] **[code]** Modèle : groupes, membres, clé, messages de groupe et accusés par membre (migration).
- [ ] **[code]** Création d'un groupe, invitation (clé par message direct), départ et retrait d'un membre (rotation de clé).
- [ ] **[code]** Envoi par diffusion, accusés par membre, renvoi individuel aux absents, déduplication.
- [ ] **[code]** Écrans : liste des groupes, création, conversation de groupe (auteur et avatar par message, « livré à n/m »).
- [ ] **[code]** Tests et simulation `meshtasticd` à 3 nœuds.
- [ ] **[terrain]** Groupe de 4 personnes, un membre hors de portée puis de retour.

## Limite connue

Dans un groupe à clé partagée, un membre peut se faire passer pour un autre membre (pas de signature par message, trop coûteuse en octets). À documenter.
