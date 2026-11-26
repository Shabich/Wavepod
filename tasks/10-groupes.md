# 10 · Messages de groupe

Objectif : discuter à plusieurs avec un seul paquet radio par message, sans perdre de messages pour les absents.

## Conception décidée

- Une clé de groupe aléatoire, envoyée à chaque membre par message direct chiffré et fiable à la création du groupe (et à chaque ajout de membre).
- Chaque message de groupe part en **une seule diffusion**, chiffrée avec la clé du groupe.
- Chaque membre renvoie un petit accusé applicatif.
- Après un délai, les membres qui n'ont pas accusé réception reçoivent une **copie en message direct** par la file fiable (présence, relances, sonde, TTL).
- Affichage « livré à 3/4 ».

## Sous-tâches

- [x] **[code]** Modèle : groupes, membres, clé, messages de groupe et accusés par membre (migration 6). Les membres inconnus deviennent des contacts « cachés », absents de la liste mais joignables en direct.
- [x] **[code]** Création d'un groupe (jusqu'à 8 personnes) et invitation : clé, puis liste des membres par paquets de 3, en messages directs.
- [ ] **[code]** Départ et retrait d'un membre, avec rotation de clé. **Reporté.**
- [x] **[code]** Envoi par diffusion, accusés par membre (au seul nœud de l'expéditeur), copie directe après 2 min aux silencieux, accusé tardif qui annule la copie, déduplication, reprise après redémarrage.
- [x] **[code]** Écrans : groupes sur l'accueil, création, conversation de groupe (auteur et avatar par message, « livré à n/m »), notifications de groupe.
- [x] **[code]** Tests (12, dont un groupe de 3 téléphones simulés) et simulation `meshtasticd` (à 2 nœuds, la simulation n'en a que deux).
- [ ] **[terrain]** Groupe de 4 personnes, un membre hors de portée puis de retour.

## Limite connue

Dans un groupe à clé partagée, un membre peut se faire passer pour un autre membre (pas de signature par message, trop coûteuse en octets). À documenter.

## Vérifications

- 207 tests Jest verts. Les 12 tests de groupe couvrent :
  - le format ;
  - l'invitation et les contacts cachés ;
  - un seul paquet par message ;
  - le « 2/2 » ;
  - la copie à un absent ;
  - l'accusé tardif qui annule la copie ;
  - un membre qui écrit sans connaître les autres ;
  - les doublons ;
  - les limites ;
  - la reprise après redémarrage.
- `meshtasticd` (`tools/sim/group-check.ts`) : invitation reçue en 0,2 s, diffusion reçue, accusé revenu en 0,4 s, « livré 1/1 ».
- Simulateur iOS : conversation de groupe en clair et en sombre, section Groupes sur l'accueil.

## Limites actuelles

- Texte de groupe limité à 149 octets, pour que la copie directe tienne dans un paquet.
- Une liste de membres arrivée avant l'invitation est gardée en mémoire seulement. Si l'app redémarre entre les deux, ces membres restent inconnus jusqu'au prochain message (affichés « Membre »).
- Pas de retrait de membre ni de rotation de clé : quelqu'un qui quitte le groupe garde la clé.
- Pas de signature par message : un membre peut se faire passer pour un autre membre.

