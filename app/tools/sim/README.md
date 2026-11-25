# Simulation sans module (meshtasticd)

Fait tourner la pile Wavepod (codec, chiffrement, adaptateur Meshtastic, session) contre le vrai firmware Meshtastic, exécuté en logiciel dans Docker. Le lien passe par TCP au lieu du Bluetooth.

## Prérequis

- Docker Desktop démarré.
- CLI Meshtastic : `pip install meshtastic` (dans un environnement virtuel, avec la commande `meshtastic` dans le `PATH`).

## Utilisation

```sh
npm run sim:start        # deux nœuds : A sur localhost:4403, B sur localhost:4404
npm run sim:test -- 20   # A envoie 20 messages à B, attend les accusés applicatifs
npm run sim:stop
```

Code de sortie 0 si tous les messages sont livrés et déchiffrés.

## Fonctionnement

- `meshtasticd --sim` : firmware Meshtastic natif avec une radio simulée.
- Les deux conteneurs échangent les paquets par multicast UDP (`network.enabled_protocols = UDP_BROADCAST`) sur un réseau Docker privé.
- Le script règle la région `EU_868` (un nœud neuf en région `UNSET` n'émet pas), puis attend le redémarrage qui suit la configuration.
- `tcpLink.ts` implémente l'interface `BleLink` sur TCP (trames `0x94 0xC3` + longueur). L'adaptateur Meshtastic est le même que sur téléphone.

## Ce que la simulation couvre

- Le protocole réel du firmware : `want_config_id`, synchronisation, `ToRadio` et `FromRadio`, port 256, accusés de routage.
- Le chiffrement Wavepod de bout en bout, les accusés applicatifs et la déduplication.

## Ce qu'elle ne couvre pas

- Le Bluetooth : appairage, PIN, MTU, reconnexion, arrière-plan.
- La radio : portée, collisions, temps d'antenne, duty cycle.
- **Le chiffrement Meshtastic par clé publique (PKI)** : en mode `--sim`, le firmware l'ignore et envoie les messages directs avec la clé du canal (voir `Router.cpp`, `force_simradio`). Le cas « clé publique du destinataire inconnue » ne peut donc pas être testé ici.
- Les versions de firmware : l'image `latest` embarque la 2.7.26, plus ancienne que les protobufs 2.8.3 de l'application. Une autre image se choisit avec `MESHTASTICD_IMAGE=...`.
