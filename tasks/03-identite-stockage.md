# 03 · Identité et stockage sécurisé

Objectif : identité Wavepod générée et gardée sur le téléphone, base locale chiffrée.

## Sous-tâches

- [ ] **[code]** Générer la paire X25519 et Ed25519, puis dériver l'identifiant de contact (hash de la clé publique).
- [ ] **[code]** Stocker la clé privée via `react-native-keychain` (accès après le premier déverrouillage, sans sauvegarde iCloud).
- [ ] **[code]** Ouvrir la base `op-sqlite` avec SQLCipher, avec une clé de base aléatoire stockée dans le Keychain ou le Keystore.
- [ ] **[code]** Écrire le schéma initial (`identity`, `contacts`, `messages`, `outbox`, `dedup`) et un système de migrations.
- [ ] **[code]** Remplacer les clés en dur du prototype par l'identité réelle.
- [ ] **[code]** Tests : base illisible sans la clé, nouvelle identité après réinstallation.

## Critère de fin

Clé privée jamais lisible hors du stockage sécurisé. Base illisible sans la clé. Tests verts.
