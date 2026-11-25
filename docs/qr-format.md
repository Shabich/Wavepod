# Format du QR de contact

Version 1. Implémentation : `app/src/contacts/card.ts`.

## Lien

`wavepod://add#<base64url>`. Ce lien ouvre l'application s'il est partagé par un autre canal : schéma `wavepod` déclaré sur iOS et Android.

## Contenu binaire

| Décalage | Taille | Champ |
|---|---|---|
| 0 | 1 | Version (1) |
| 1 | 32 | Clé publique X25519 (messages) |
| 33 | 32 | Clé publique Ed25519 (signe la carte) |
| 65 | 1 | Longueur n du pseudo (1 à 40 octets) |
| 66 | n | Pseudo, UTF-8 |
| 66+n | 1 | Longueur m de la fiche Meshtastic (0 si aucun module connecté) |
| 67+n | m | `SharedContact` Meshtastic (protobuf) : numéro de nœud et fiche `User` du module, avec sa clé publique PKI |
| 67+n+m | 64 | Signature Ed25519 de tout ce qui précède |

Taille typique avec module : 316 caractères, soit un QR de version 13 à 15 en correction M.

## Choix

- **Format propre à Wavepod, qui embarque le `SharedContact` Meshtastic.** Les applications Meshtastic utilisent `https://meshtastic.org/v/#<base64url(SharedContact)>` (vérifié dans le code de Meshtastic-Android, `SharedContact.kt`). Wavepod reprend exactement ces octets, pour les injecter tels quels dans le module avec `AdminMessage.add_contact`.
- **Piste écartée** : ajouter les données Wavepod après un `?` dans le lien Meshtastic, ce que l'application Android ignore. Elle repose sur un comportement de parsing non documenté, qui peut différer sur iOS ou le web.
- **Signature** : elle empêche de modifier une partie de la carte (remplacer la clé ou le module en gardant le reste). Elle ne prouve pas l'identité de l'auteur : c'est le rôle de l'empreinte de sécurité, à comparer côte à côte.
- **Empreinte de sécurité** : 12 chiffres tirés de SHA-256 des deux clés X25519 triées, identiques sur les deux téléphones (`safetyNumber` dans `crypto/identity.ts`).

## Ce que fait le scan

1. Vérification de la version, des longueurs et de la signature. Une carte altérée, tronquée ou d'une version inconnue est refusée.
2. Refus de sa propre carte.
3. Enregistrement du contact (identifiant dérivé de sa clé X25519, nœud Meshtastic, fiche Meshtastic).
4. Injection de la fiche dans notre module (`add_contact`), pour que le firmware connaisse la clé PKI du destinataire. Sans elle, un vrai module refuse d'envoyer un message direct. La fiche de chaque contact est réinjectée à chaque connexion d'un module, utile en cas de changement de module.
5. Signal de présence : scanner suppose d'être côte à côte, donc les messages en attente peuvent partir tout de suite.

L'ajout est mutuel : chacun scanne le QR de l'autre.

## Limites connues

- Si un contact change de module, sa nouvelle clé PKI n'arrive dans notre module que par ses NodeInfo, ou par un nouveau scan.
- Le pseudo vient de la carte. Il peut être modifié localement lors de l'ajout.
