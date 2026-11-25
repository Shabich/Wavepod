#!/usr/bin/env bash
docker rm -f wp-node-a wp-node-b >/dev/null 2>&1 || true
docker network rm wpsim >/dev/null 2>&1 || true
echo "Nodes stopped"
