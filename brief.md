Tu démarres le projet Wavepod. Commence par produire la documentation de base (pas de code d'application pour l'instant), puis propose un plan de démarrage. Écris en français, ton clair et professionnel, sans emojis, titres en sentence case.

## Concept

Wavepod est une application mobile (iOS et Android) de messagerie texte privée et de "réseau social local" qui fonctionne sans internet, sans réseau cellulaire et sans satellite. Le téléphone se connecte en Bluetooth LE à un petit module LoRa du commerce (batterie, antenne et boîtier intégrés, sans soudure). Les messages voyagent par ondes radio sur la bande libre 868 MHz (Europe), en direct ou via le réseau maillé (mesh) formé par les modules. Le nom vient des ondes radio et du "pod", le groupe de dauphins : un réseau social du groupe à portée (famille, bande d'amis, camp, événement, équipe), pas un réseau mondial.

## Décisions déjà prises (à respecter, sauf contradiction technique que tu signales)

### Radio et matériel
- Couche radio : on utilise le firmware Meshtastic sur les modules, et l'application lui parle directement en BLE avec le protocole Meshtastic (protobuf). Pas de firmware maison.
- Pas de couche d'abstraction multi-protocole (HAL) pour le MVP. Prévois seulement une petite interface dans le code entre l'application et la radio (envoyer, recevoir, état de connexion), pour pouvoir ajouter plus tard MeshCore ou Reticulum sans tout réécrire. La HAL complète passe en "plus tard".
- Matériel de référence : Seeed SenseCAP T1000-E (format carte, IP65, BLE, GPS, antenne interne, 700 mAh, environ 2 jours d'autonomie annoncés, environ 40 USD). Module de comparaison pour la portée : RAK WisMesh Pocket (antenne SMA). Tous les modules sous Meshtastic doivent fonctionner, en version 868 MHz pour l'Europe.
- Texte uniquement. Pas d'appels ni de voix : le débit LoRa et le duty cycle (1 %, ou 10 % sur la sous-bande 869,4-869,65 MHz, à valider) l'interdisent. Pas de PMR446 ni de seconde radio (illégal sans matériel certifié, chiffrement limité). Un message vocal court (Codec2) reste une idée lointaine, hors périmètre.
- Les modules écoutent en continu. Le duty cycle ne limite que l'émission.

### Chiffrement (plus-value principale face à Meshtastic)
- Constat sur Meshtastic, à vérifier dans la documentation actuelle : le canal par défaut utilise une clé publique connue de tous ; les messages directs sont chiffrés par clé publique (X25519 + AES) depuis la version 2.5, mais sans confidentialité persistante ; la clé privée est stockée dans le module ; les en-têtes (expéditeur, destinataire, identifiant, sauts) sont en clair.
- Wavepod ajoute sa propre couche de chiffrement de bout en bout dans l'application : chaque message est chiffré et authentifié sur le téléphone avant d'être confié à Meshtastic, qui le transporte comme une donnée opaque. Les clés restent dans le Keychain iOS / Keystore Android et ne quittent jamais le téléphone. Promesse produit : "tes clés ne quittent jamais ton téléphone".
- Surcoût estimé : environ 30 octets par message (nonce et tag) sur environ 200 octets utiles par paquet. Vérifie la taille utile réelle et propose un format de message compact.
- Confidentialité persistante (renouvellement de clés) : à étudier pour plus tard, compte tenu du faible débit.
- Documente les métadonnées qui restent visibles malgré tout (en-têtes Meshtastic, balises de présence, positions).

### Contacts et identité
- Ajout de contact par QR code ("scanne pour m'ajouter"), contenant la clé publique Wavepod. Étudie la compatibilité avec le format de lien de contact Meshtastic (meshtastic.org/v/#...).
- Adresse d'un contact = identifiant dérivé de sa clé, jamais sa position.

### Réseau social local
- Fonctionnalités adaptées à LoRa : profils (pseudo, courte bio envoyée une fois, avatar généré ou stocké localement), contacts, conversations privées, groupes, statuts courts ("en randonnée", "besoin d'aide"), réactions compactes (un ou deux octets), "autour de moi" (personnes entendues récemment, distance si position partagée), check-in avec position.
- Hors périmètre : photos, vidéos, vocaux, fil public type Instagram ou X, commentaires en cascade, historique partagé pour les nouveaux arrivants.
- Chaque fonctionnalité a un budget d'antenne (taille, fréquence maximale par personne et par heure). Fais un tableau.

### Quota d'émission
- Ordre de grandeur : environ 55 messages courts par heure et par module en réglage LongFast à 1 % (environ 14 en SF12, environ 600 en SF7), à valider. Les accusés, balises, retries et relais consomment aussi du temps d'antenne, et le canal est partagé entre tous les nœuds à portée.

### Présence
- Balise périodique optionnelle (toutes les 15 à 30 minutes) qui permet d'afficher "vu il y a X minutes". C'est un "dernier signal radio", pas un "en ligne".
- Pas de position dans la balise par défaut, désactivable, avec un mode discret. Réutilise les paquets d'information de nœud de Meshtastic si c'est pertinent.

### Livraison fiable
- File d'envoi (outbox) côté application : identifiant unique de message, accusé de réception, déduplication côté destinataire, états (en attente, envoyé, livré, échoué), durée de vie maximale (par exemple 24 h), renvoi manuel possible.
- Règle d'envoi : on émet seulement si le destinataire a été vu récemment (fenêtre réglable, 20 à 30 minutes), avec quelques retries espacés. Sinon le message attend sans émettre, et la file de ce contact est vidée dès qu'on reçoit n'importe quel signal de lui.
- Sonde de secours toutes les 1 à 2 heures pour éviter l'interblocage. Gère la présence à sens unique : après échec des retries, le message retourne en attente, pas en échec définitif.
- Deux niveaux d'accusé : reçu par le module, reçu par l'application. "Lu" optionnel.
- Précise ce que Meshtastic fait déjà (accusé et retransmissions des messages directs) et ce que Wavepod ajoute.

### Routage
- Le routage est assuré par Meshtastic (inondation contrôlée avec limite de sauts, et routage par chemin appris pour les messages directs selon la version, à vérifier). Wavepod ne réimplémente pas le routage. Documente son fonctionnement, ses limites (saturation, fuite de métadonnées par les relais) et les réglages recommandés (nombre de sauts).

### Stockage et arrière-plan
- L'application stocke tout dans une base locale chiffrée. Les modules ne gardent pas d'historique, seulement une petite file temporaire.
- Les messages reçus pendant que le téléphone est déconnecté du module peuvent être perdus : étudie la connexion BLE en arrière-plan sur iOS et Android, les notifications, et affiche clairement les messages manqués ou non livrés.

### Positionnement et licences
- L'application officielle Meshtastic fait déjà messagerie, canaux, chiffrement, carte, QR codes. Fais une analyse concurrentielle : ce que Meshtastic fait, ce qui y est pénible pour un public non technique, et les plus-values de Wavepod (expérience grand public façon WhatsApp sans réglages radio, clés uniquement sur le téléphone, livraison fiable avec file et présence, réseau social local, vie privée par défaut, offre clé en main pour des usages ciblés).
- Meshtastic est sous licence GPL. Analyse ce que ça implique si Wavepod réutilise le protocole, les fichiers protobuf ou du code des applications, et les conséquences sur un éventuel modèle commercial. Marque les points qui demandent un avis juridique.

### Identité
- Logo autour d'un dauphin (pistes : dauphin dans une bulle de chat, dauphin avec trois points de saisie, dauphin émettant des ondes, icône ronde avec vagues). Couleur de base bleu océan (#1D6FA5).

## Livrables

1. WAVEPOD.md : document de référence, avec : résumé et slogan, vision et public cible, cas d'usage, périmètre (MVP et plus tard), architecture avec schéma Mermaid (application, couche chiffrement Wavepod, interface radio, BLE, module Meshtastic, mesh), chiffrement et modèle de menace, contacts, réseau social local et budget d'antenne par fonctionnalité, présence, livraison fiable (avec diagramme d'états), routage, stockage et arrière-plan, matériel compatible (tableau), limites légales (ISM 868 MHz, puissance, duty cycle), contraintes iOS et Android, positionnement face à Meshtastic, licences, feuille de route (MVP, v1, v2 avec critère de réussite par étape), risques et questions ouvertes, identité de marque.
2. CLAUDE.md : conventions du projet, décisions d'architecture ci-dessus, glossaire et règles de travail.
3. Un plan de démarrage en 8 tâches maximum, avec pour chacune l'objectif, les fichiers concernés et le critère de fin. La première tâche : prototype de bout en bout avec deux T1000-E et deux téléphones, un message texte chiffré par Wavepod, transporté par Meshtastic, avec accusé de réception.
4. La liste des choix technologiques à trancher avec moi (React Native, Flutter ou natif ; bibliothèque BLE ; bibliothèque de chiffrement ; base locale chiffrée), avec ta recommandation pour chacun.

## Contraintes

- Fonde-toi sur des valeurs réalistes pour LoRa et Meshtastic. Marque "À valider" tout chiffre ou comportement dont tu n'es pas sûr, et distingue clairement les choix de conception des hypothèses. Consulte la documentation Meshtastic actuelle quand c'est possible.
- Ne code pas l'application avant que je valide le plan.
- Écris les fichiers dans le dossier courant.

Termine en listant en 5 lignes maximum les hypothèses les plus fragiles du projet.
