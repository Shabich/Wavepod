# 11 · Position et cartes hors ligne

Objectif : partager sa position avec un contact ou un groupe et la voir sur une carte, sans réseau.

## Conception décidée

- Cartes par région : l'utilisateur choisit une région dans un catalogue et la télécharge avant de partir (Wi‑Fi). Fichiers PMTiles extraits d'OpenStreetMap (Protomaps), affichés par MapLibre React Native v11, 100 % hors ligne. Mention « © OpenStreetMap » obligatoire (ODbL).
- Taille indicative au zoom 14 : 270 à 400 Mo par ancienne région (chiffres MapTiler), 30 à 50 Mo par ville. France entière estimée à 5 à 8 Go, trop lourde pour un téléchargement complet.
- Position prise sur le GPS du téléphone (le GPS du module reste coupé). Message chiffré d'environ 15 octets utiles (latitude et longitude au 1/100 000 de degré, précision, heure).

## Sous-tâches

- [ ] **[décision]** Hébergement des fichiers de régions (stockage cloud et CDN) et production des extractions avec `pmtiles extract`.
- [ ] **[code]** Message « position » (type dédié), partage ponctuel depuis une conversation, affichage dans la conversation.
- [ ] **[code]** Écran carte : positions des contacts et la sienne, hors ligne, attribution OSM.
- [ ] **[code]** Catalogue de régions, téléchargement avec progression, reprise, suppression, espace disque.
- [ ] **[code]** Style de carte embarqué (polices et pictogrammes locaux, aux couleurs de la charte, clair et sombre).
- [ ] **[terrain]** Partager une position en randonnée et la retrouver sur la carte sans réseau.
