# 06 · Présence

Objectif : « vu il y a X min », balise optionnelle et mode discret.

## Sous-tâches

- [x] **[code]** Mettre à jour le « vu » par tout signal du contact :
  - messages et accusés, authentifiés (moteur de livraison) ;
  - balise, authentifiée ;
  - n'importe quel paquet entendu de son module, et le `last_heard` remonté par le module à la synchronisation : simple indice, non authentifié, filtré à 30 s.
- [x] **[code]** Écrire la balise : diffusion unique de 9 octets, toutes les 15, 20 ou 30 min (au choix, 20 par défaut) à ±25 % près, plus une première balise 5 à 30 s après la connexion du module. Sans position, sans nom (`src/presence/beacon.ts`, `src/presence/service.ts`).
- [x] **[code]** Jeton rotatif : HMAC-SHA256(clé de balise, fenêtre de 15 min), tronqué à 8 octets. La clé de balise, dérivée de la graine, est envoyée à chaque contact une fois, dans un message « bonjour » chiffré et fiable (type 3). Un tiers ne peut ni falsifier une balise, ni relier une balise à une identité Wavepod. Limite : l'en-tête Meshtastic montre en clair le nœud émetteur.
- [x] **[code]** Écrire le mode discret, qui coupe toute émission spontanée (balise et sonde de secours). L'app répond quand même à un contact qui se manifeste, ce qui n'est pas spontané.
- [x] **[code]** Ajouter la réserve d'antenne : temps d'émission LoRa (formule Semtech, LongFast) sur l'heure glissante, rapporté aux 10 % autorisés, affiché dans « Réglages ».
- [ ] **[terrain]** Vérifier la fréquence réelle des balises par mesure du temps d'antenne.

## Critère de fin

Fréquence de balise respectée, mode discret sans aucune émission spontanée.

## Vérifications

- 182 tests Jest verts :
  - 10 sur le temps d'antenne et la balise (valeur de référence SF7 : 41,2 ms, dérive d'horloge, falsification) ;
  - 11 sur le service de présence (échange de clés, cadence sur 3 h, mode discret 5 h sans émission, reprise, « vu » par balise ou par paquet entendu, balise inconnue, radio déconnectée, réglages).
- `meshtasticd` (`tools/sim/presence-check.ts`) : clés échangées en 0,2 s, première balise à +14 s reconnue par l'autre nœud, « vu » mis à jour.
- Simulateur iOS : écran Réglages en clair et en sombre.

## Temps d'antenne (LongFast, calculés)

| Paquet | À l'antenne | Durée |
|---|---|---|
| Balise | 31 octets | 0,48 s |
| Message de 15 caractères (direct, PKI) | 80 octets | 0,85 s |
| Message de 100 octets | 134 octets | 1,26 s |
| Message maximal (200 octets) | 234 octets | 2,0 s |

Une balise toutes les 20 min coûte environ 1,4 s par heure, soit 0,4 % du budget de 360 s.
