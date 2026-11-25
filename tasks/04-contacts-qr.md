# 04 · Contacts par QR code

Objectif : « scanne pour m'ajouter », avec vérification d'empreinte.

## Sous-tâches

- [x] **[code]** Étudier le format `meshtastic.org/v/#...` (`SharedContact`). Décision : format Wavepod qui embarque le `SharedContact` Meshtastic (voir `docs/qr-format.md`).
- [x] **[code]** Rédiger `docs/qr-format.md`.
- [x] **[code]** Écrire l'encodage et le décodage, signés en Ed25519, avec les tests (aller-retour, octet modifié, mauvaise signature, troncature, version inconnue, pseudo vide ou trop long).
- [x] **[code]** Écrire les écrans « Mon QR » (pseudo, QR, partage du lien) et « Ajouter un contact » (caméra sur iOS, collage de lien partout, liens `wavepod://` ouverts depuis une autre app).
- [x] **[code]** Afficher l'empreinte de 12 chiffres à l'ajout et dans la conversation, avec le marquage « vérifiée ».
- [x] **[code]** Mettre dans le QR la fiche Meshtastic du module et l'injecter dans le module du contact (`AdminMessage.add_contact`), puis la réinjecter à chaque connexion de module. Vérifié contre `meshtasticd` : le nœud et sa clé PKI apparaissent dans la base de nœuds (`tools/sim/add-contact-check.ts`).
- [x] **[code]** Remplacer les clés de test du prototype par l'identité réelle et les contacts. L'écran du prototype est supprimé, remplacé par : accueil (module et contacts), module, Mon QR, ajout, conversation, diagnostic.
- [ ] **[code]** Lecture du QR par la caméra sur Android : VisionCamera 5 n'a pas de lecteur intégré sur Android, il faut le module ML Kit (`react-native-vision-camera-barcode-scanner`). À faire quand le SDK Android sera installé. En attendant : collage du lien.
- [ ] **[terrain]** Faire l'ajout mutuel entre deux téléphones, chronométré.

## Critère de fin

Ajout mutuel en moins de 30 s, empreinte identique des deux côtés, QR invalide refusé.

## Vérifications

- 100 tests Jest verts (carte, `add_contact`, service de contacts).
- Simulation `meshtasticd` : échange de cartes réel entre A et B, empreinte identique des deux côtés, puis 10 messages sur 10 livrés et scénario de coupure réussi.
- Simulateur iOS, par captures (macOS refuse l'automatisation des touches, donc les écrans ont été ouverts par une route temporaire non commitée) :
  - accueil ;
  - Mon QR avec le QR rendu et l'avertissement « connecte ton module » ;
  - confirmation d'ajout (nom, empreinte, module) ;
  - conversation avec un message « en attente » ;
  - repli « aucune caméra disponible ».
- Non vérifié : la lecture caméra réelle (il faut un iPhone), le bouton « Partager », et les touches dans l'interface.

## Corrigé en route

- Sur le simulateur, la caméra plantait l'écran d'ajout (pas d'accéléromètre). L'écran vérifie maintenant qu'une caméra existe avant de l'afficher, le lecteur est isolé dans un garde-fou d'erreur, et la caméra n'est pas lancée quand un lien est fourni.

## Dépendances ajoutées (versions épinglées, publiées depuis au moins deux semaines)

`react-native-vision-camera` 5.2.4, `react-native-nitro-modules` 0.37.2, `react-native-nitro-image` 0.15.2, `react-native-svg` 15.16.1, `react-native-qrcode-svg` 6.3.54.
