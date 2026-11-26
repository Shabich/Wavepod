# 09 · Profil et avatars

Objectif : chaque utilisateur a un profil (pseudo, avatar, courte bio) que ses contacts voient, sans surcharger la radio.

## Sous-tâches

- [ ] **[code]** Jeu d'avatars : 30 icônes Lucide (licence ISC) et 8 couleurs de fond lisibles (contraste ≥ 4,5:1 avec l'icône blanche). Seuls les numéros voyagent (2 octets). Les listes ne sont jamais réordonnées, seulement complétées.
- [ ] **[code]** Avatar par défaut dérivé de l'identifiant du contact (stable, différent d'un contact à l'autre).
- [ ] **[code]** Message « profil » chiffré et fiable (type 5), invisible dans la conversation : avatar, pseudo (≤ 40 octets), bio (≤ 80 octets). Envoyé à chaque contact à l'ajout, puis à chaque modification.
- [ ] **[code]** Réception : mise à jour de l'avatar, de la bio et du pseudo (sauf si le contact a été renommé localement).
- [ ] **[code]** Écran Profil : aperçu, pseudo, bio, grille d'icônes, couleurs. Accès par son propre avatar sur l'accueil.
- [ ] **[code]** Avatars dans la liste des contacts et l'en-tête de la conversation.
- [ ] **[terrain]** Changer d'avatar et vérifier la mise à jour chez un contact.

## Critère de fin

Un changement de profil apparaît chez tous les contacts, en un seul petit message chacun.
