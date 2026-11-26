# 09 · Profil et avatars

Objectif : chaque utilisateur a un profil (pseudo, avatar, courte bio) que ses contacts voient, sans surcharger la radio.

## Sous-tâches

- [x] **[code]** Jeu d'avatars : 30 icônes Lucide (licence ISC) et 8 couleurs de fond lisibles (contraste ≥ 4,5:1 avec l'icône blanche). Seuls les numéros voyagent (2 octets). Les listes ne sont jamais réordonnées, seulement complétées.
- [x] **[code]** Avatar par défaut dérivé de l'identifiant du contact (stable, différent d'un contact à l'autre).
- [x] **[code]** Message « profil » chiffré et fiable (type 5), invisible dans la conversation : avatar, pseudo (≤ 40 octets), bio (≤ 80 octets). Envoyé à chaque contact à l'ajout, puis à chaque modification.
- [x] **[code]** Réception : mise à jour de l'avatar, de la bio et du pseudo (sauf si le contact a été renommé localement).
- [x] **[code]** Écran Profil : aperçu, pseudo, bio, grille d'icônes, couleurs. Accès par son propre avatar sur l'accueil.
- [x] **[code]** Avatars dans la liste des contacts et l'en-tête de la conversation.
- [ ] **[terrain]** Changer d'avatar et vérifier la mise à jour chez un contact.

## Critère de fin

Un changement de profil apparaît chez tous les contacts, en un seul petit message chacun.

## Vérifications

- 195 tests Jest verts, dont 13 sur le profil :
  - format : aller-retour avec accents et emoji, limites, corruption, numéros inconnus d'une version plus récente ;
  - contraste des 8 couleurs ;
  - avatar par défaut ;
  - service sur deux téléphones simulés : rien avant le choix d'un pseudo, un seul message par modification, renommage local respecté, nom suivi sinon.
- Simulateur iOS : écran Profil (grille de 30 icônes, 8 couleurs) en sombre, accueil avec son avatar et ceux des contacts. La version Release fonctionne sans Metro.
- Le pseudo choisi dans « Mon QR » passe aussi par le profil, donc il est transmis aux contacts.
- Un profil fait au plus 125 octets, soit moins de 160 octets chiffrés.
- Comme tout message, il attend dans la file si le contact n'est pas à portée.

