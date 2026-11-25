# 04 · Contacts par QR code

Objectif : « scanne pour m'ajouter », avec vérification d'empreinte.

## Sous-tâches

- [ ] **[code]** Étudier le format `meshtastic.org/v/#...` (`SharedContact`) dans le code source et décider : compatible, double QR ou format Wavepod seul.
- [ ] **[code]** Rédiger `docs/qr-format.md` (version, clé publique, identifiant de nœud, pseudo, somme de contrôle, encodage base64url).
- [ ] **[code]** Écrire l'encodage et le décodage du QR, avec les tests de validation (QR altéré ou version inconnue refusés).
- [ ] **[code]** Écrire l'écran « Mon QR » et l'écran de scan (caméra).
- [ ] **[code]** Afficher l'empreinte courte et la marquer comme vérifiée.
- [ ] **[code]** Ajouter au QR l'identifiant de nœud et la clé publique Meshtastic du module, puis injecter cette clé dans le module du contact (`AdminMessage`). Sans elle, un vrai module refuse d'envoyer un message direct (voir `WAVEPOD.md`, constats firmware).
- [ ] **[code]** Remplacer les clés de test du prototype par l'identité réelle et les contacts (reporté de la tâche 03).
- [ ] **[terrain]** Faire l'ajout mutuel entre deux téléphones, chronométré.

## Critère de fin

Ajout mutuel en moins de 30 s, empreinte identique des deux côtés, QR invalide refusé.
