#!/usr/bin/env bash
# Starts two simulated Meshtastic nodes (meshtasticd --sim) linked by UDP multicast
# on a private Docker network, and configures them for Wavepod tests.
# Node A: localhost:4403 · Node B: localhost:4404
set -euo pipefail

IMAGE="${MESHTASTICD_IMAGE:-meshtastic/meshtasticd:latest}"
NET=wpsim

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

start() {
  local name=$1 port=$2 mac=$3
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network "$NET" --restart unless-stopped \
    -p "$port:4403" --entrypoint meshtasticd "$IMAGE" --sim -d /tmp/fs -h "$mac" >/dev/null
}

start wp-node-a 4403 AA:BB:CC:00:00:01
start wp-node-b 4404 AA:BB:CC:00:00:02
sleep 4

# Region EU_868 (a fresh node does not transmit with region UNSET) and UDP mesh between containers.
# Uses the official Meshtastic Python CLI: pip install meshtastic
for port in 4403 4404; do
  meshtastic --host "localhost:$port" --set lora.region EU_868 --set network.enabled_protocols 1 >/dev/null
done

# The config change triggers a reboot a few seconds later: wait for Docker to
# restart each container, then for its API to answer again.
for name in wp-node-a wp-node-b; do
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.RestartCount}}' "$name")" -ge 1 ] && break
    sleep 1
  done
done
for port in 4403 4404; do
  for _ in $(seq 1 30); do
    meshtastic --host "localhost:$port" --info >/dev/null 2>&1 && break
    sleep 2
  done
done
# Let the nodes exchange NodeInfo over UDP.
sleep 5
echo "Nodes ready: A localhost:4403, B localhost:4404 ($(docker exec wp-node-a meshtasticd --version 2>/dev/null | tail -1))"
