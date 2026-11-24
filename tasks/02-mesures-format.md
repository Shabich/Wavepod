# 02 · Mesures radio et format de message

Objectif : remplacer les « À valider » radio de `WAVEPOD.md` par des valeurs vérifiées, et figer la version 1 du format binaire.

## Sous-tâches

- [ ] **[code]** Vérifier dans le code du firmware la taille max du `payload` de `Data` et le surcoût de l'encapsulation.
- [ ] **[code]** Vérifier dans le code du firmware la sous-bande, la puissance et le duty cycle par défaut de `EU_868`.
- [ ] **[code]** Écrire un calculateur de temps d'antenne (formule LoRa) dans `app/src/radio/airtime.ts`, avec ses tests.
- [ ] **[code]** Rédiger `docs/format-message.md` (format v1 : champs, tailles, données associées, fragmentation).
- [ ] **[code]** Mettre à jour le codec en v1, avec tests de tailles limites et de compatibilité de version.
- [ ] **[terrain]** Mesurer le temps d'antenne réel (`air_util_tx`) pour 3 tailles de message.
- [ ] **[terrain]** Mesurer la portée du T1000-E face à la WisMesh Pocket (vue directe, urbain, forêt). Noter RSSI et SNR.
- [ ] **[code]** Consigner les résultats dans `docs/mesures-radio.md` et corriger `WAVEPOD.md`.

## Critère de fin

Plus aucun « À valider » dans les parties radio de `WAVEPOD.md`. Codec v1 testé.
