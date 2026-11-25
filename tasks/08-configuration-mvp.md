# 08 · Configuration du module et test MVP

Objectif : appairer un module neuf sans aucun réglage radio, puis valider le MVP sur le terrain.

## Sous-tâches

- [x] **[code]** Lire la configuration existante pendant la synchronisation (sections LoRa, appareil, position, Bluetooth, télémétrie et fiche du propriétaire), la sauvegarder dans la base chiffrée avant le premier changement, et signaler un module configuré pour un autre usage (région, rôle, réglages radio, nom personnalisés).
- [x] **[code]** Appliquer la configuration Wavepod en une seule transaction d'administration (`begin_edit_settings` … `commit_edit_settings`), donc un seul redémarrage. Ensuite, attendre la coupure, se reconnecter et resynchroniser (`src/radio/meshtastic/provisioning.ts`, `src/app/moduleManager.ts`).
- [x] **[code]** Restaurer la configuration d'origine sur demande. La sauvegarde n'est prise qu'une fois par module, donc reconfigurer ne l'écrase jamais.
- [x] **[code]** Vérifier la version minimale du firmware (2.6.0) : en dessous, la configuration est refusée et un message demande la mise à jour.
- [x] **[code]** Écrire le parcours d'accueil : carte « Pour commencer » (pseudo, module configuré, premier contact), qui disparaît une fois les trois étapes faites. Les permissions sont demandées au moment où elles servent (Bluetooth au scan, caméra au QR).
- [x] **[code]** Étudier le PIN BLE du T1000-E : dans le firmware, un module sans écran est en PIN fixe (`FIXED_PIN`, valeur par défaut du firmware, souvent 123456). Décision : ne pas le modifier, car sans écran un PIN changé et oublié bloquerait l'appairage. Le PIN ne protège pas le contenu des messages.
- [ ] **[terrain]** Faire appairer un module neuf par un utilisateur non technique.
- [ ] **[terrain]** Test MVP : 4 personnes, une journée de randonnée, avec rapport dans `docs/test-terrain-mvp.md`.

## Critère de fin

Appairage sans réglage radio réussi. Plus de 95 % des messages livrés dans le TTL, aucun message perdu sans indication.

## Configuration appliquée

| Réglage | Valeur | Remarque |
|---|---|---|
| Région | `EU_868` | Un module neuf est en `UNSET` et n'émet pas |
| Profil radio | LongFast (preset) | Réglages radio personnalisés signalés puis remplacés |
| Sauts | 3 | |
| Émission | activée | |
| Rôle | `CLIENT` | `CLIENT_MUTE` est conservé s'il est déjà choisi |
| Annonce NodeInfo | au plus toutes les 3 h | Un intervalle plus long est conservé |
| Position et GPS | désactivés | |
| Télémétrie | non diffusée (24 h, capteurs coupés) | |
| Nom du module | `WP-XXXX` / `XXXX` (fin du numéro de nœud) | |
| Canal | inchangé (canal par défaut) | Voir la décision ci-dessous |
| PIN Bluetooth | inchangé | Voir ci-dessus |

Chaque section est reconstruite à partir des valeurs du module : seuls les champs ci-dessus changent, le reste est conservé (puissance d'émission, clé PKI du module…). Un module déjà configuré ne reçoit aucune transaction.

## Décision : pas de canal privé pour l'instant

Le contenu Wavepod est déjà chiffré de bout en bout, et les messages directs passent par le PKI Meshtastic. Un canal privé par groupe empêcherait le relais par les autres modules Meshtastic du secteur, et compliquerait les contacts entre groupes. Hypothèse à vérifier sur le terrain : le relais par les nœuds publics est-il utile, et que voient-ils ? (Métadonnées, voir `WAVEPOD.md`.)

## Vérifications

- 118 tests Jest verts : 14 sur le plan de configuration (module neuf, non-régression, conservation des réglages, avertissements, versions de firmware, sauvegarde et restauration) et 4 sur le gestionnaire de module, avec un faux firmware qui redémarre (une transaction, reconnexion, sauvegarde unique, firmware trop ancien, rien à refaire).
- Contre `meshtasticd` 2.7.26, avec des nœuds neufs en région `UNSET` (`npm run sim:start -- --raw`, puis `npx tsx tools/sim/provision-check.ts`) :
  - configuration en une transaction ;
  - redémarrage et reconnexion en 4,2 s ;
  - plus rien à changer ensuite ;
  - messagerie entre les deux nœuds configurés par Wavepod : 10 sur 10.
- Simulateur iOS : accueil avec « Pour commencer » et écran Module sans module, par captures.
- Non vérifié : la carte de configuration avec un vrai module en Bluetooth, et le délai de redémarrage du T1000-E (le délai d'attente est de 20 s et la reconnexion est tentée pendant 90 s).
